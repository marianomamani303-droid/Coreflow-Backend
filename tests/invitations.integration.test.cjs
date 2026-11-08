const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes, createHash } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { before, after, test, mock } = require('node:test')
const mysql = require('mysql2/promise')

process.env.DB_NAME = `coreflow_invitations_integration_test_${randomBytes(8).toString('hex')}`
// Todas las entregas se sustituyen antes de realizar solicitudes HTTP.
process.env.SMTP_HOST = ''
const { app } = require('../dist/app.js')
const { env } = require('../dist/config/env.js')
const { pool, closeDatabase } = require('../dist/config/database.js')
const { mailer } = require('../dist/shared/mail.js')
let server, origin, owner, admin, employee, outsider, companyId, otherId, mailMock
const messages = []
let sequence = 0

async function request(
  path,
  method = 'POST',
  body,
  cookie = owner?.cookie,
  headers = {},
) {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CoreFlow-Request': '1',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function register(email) {
  const response = await request(
    '/api/auth/register',
    'POST',
    {
      fullName: 'Invitation Test',
      email,
      password: 'Strong-password-2026',
    },
    '',
  )
  assert.equal(response.status, 201)
  return {
    ...(await response.json()).user,
    cookie: response.headers.get('set-cookie').split(';')[0],
  }
}
const path = (id = companyId) => `/api/companies/${id}/invitations`
async function create(overrides = {}, session = admin?.cookie) {
  const email = `invited-${++sequence}@example.com`
  const response = await request(
    path(),
    'POST',
    {
      email,
      role: 'employee',
      department: 'Ventas',
      jobTitle: 'Asesor',
      ...overrides,
    },
    session,
  )
  assert.equal(response.status, 201)
  const { invitation } = await response.json()
  const message = messages.findLast((item) => item.email === invitation.email)
  return { invitation, token: message?.token }
}
async function ageAttempt(id) {
  await pool.execute(
    'UPDATE company_invitations SET last_send_attempt_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 2 MINUTE) WHERE id = ?',
    [id],
  )
}
async function verify(token, user) {
  const response = await request(
    '/api/invitations/verify-email',
    'POST',
    { token },
    user.cookie,
  )
  assert.equal(response.status, 200)
}

before(async () => {
  const setup = spawnSync(
    process.execPath,
    [resolve(__dirname, '../scripts/database.cjs')],
    { env: process.env, encoding: 'utf8' },
  )
  assert.equal(setup.status, 0, setup.stderr)
  mailMock = mock.method(mailer, 'sendInvitation', async (message) => {
    messages.push(message)
  })
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
  owner = await register('invite-owner@example.com')
  admin = await register('invite-admin@example.com')
  employee = await register('invite-employee@example.com')
  outsider = await register('invite-outsider@example.com')
  companyId = (
    await (await request('/api/companies', 'POST', { name: 'Equipo Real' })).json()
  ).company.id
  otherId = (
    await (await request('/api/companies', 'POST', { name: 'Otra Empresa' })).json()
  ).company.id
  await pool.execute(
    "INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'admin'), (?, ?, 'employee')",
    [companyId, admin.id, companyId, employee.id],
  )
})
after(async () => {
  mailMock?.mock.restore()
  if (server) await new Promise((resolve) => server.close(resolve))
  await closeDatabase()
  if (/^coreflow_invitations_integration_test_[a-f0-9]{16}$/.test(env.database.name)) {
    const connection = await mysql.createConnection({
      host: env.database.host,
      port: env.database.port,
      user: env.database.user,
      password: env.database.password,
    })
    try {
      await connection.query('DROP DATABASE IF EXISTS ??', [env.database.name])
    } finally {
      await connection.end()
    }
  }
})

test('sesion, permisos por empresa y CSRF protegen las invitaciones', async () => {
  assert.equal((await request(path(), 'POST', {}, '')).status, 401)
  assert.equal((await request(path(), 'GET', undefined, employee.cookie)).status, 403)
  assert.equal((await request(path(), 'GET', undefined, outsider.cookie)).status, 404)
  assert.equal((await request(path(otherId), 'GET', undefined, admin.cookie)).status, 404)
  assert.equal(
    (await request(path(), 'POST', {}, owner.cookie, { 'X-CoreFlow-Request': '' }))
      .status,
    403,
  )
  assert.equal(
    (
      await request(path(), 'POST', {}, owner.cookie, {
        Origin: 'https://foreign.example',
      })
    ).status,
    403,
  )
  for (const action of ['accept', 'verify-email', 'decline']) {
    assert.equal(
      (await request(`/api/invitations/${action}`, 'POST', {}, '')).status,
      401,
    )
  }
})

test('valida tipos, correo, rol, longitudes y rechaza suplantacion', async () => {
  const input = { email: 'new@example.com', role: 'employee' }
  for (const body of [
    null,
    [],
    { ...input, role: 'owner' },
    { ...input, email: 'invalid' },
    { ...input, department: 'x'.repeat(81) },
    { ...input, jobTitle: 'x'.repeat(101) },
    { ...input, invitedBy: owner.id },
    { ...input, token: 'client-token' },
  ]) {
    assert.equal((await request(path(), 'POST', body)).status, 400)
  }
  assert.equal(
    (await request('/api/companies/1%20OR%201/invitations', 'POST', input)).status,
    400,
  )
  assert.equal(
    (await request(path(), 'POST', { ...input, role: 'admin' }, admin.cookie)).status,
    403,
  )
  assert.equal(
    (await request('/api/invitations/preview', 'POST', { token: 'bad' }, '')).status,
    400,
  )
})

test('crea invitacion normalizada por 48 horas, solo guarda hash y no concede acceso', async () => {
  const before = messages.length
  const { invitation, token } = await create({ email: ' NEW-PERSON@EXAMPLE.COM ' })
  assert.equal(invitation.email, 'new-person@example.com')
  assert.equal(invitation.deliveryStatus, 'sent')
  assert.equal(invitation.sendAttempts, 1)
  assert.equal(invitation.sending, false)
  assert.equal(messages.length, before + 1)
  assert.ok(
    Math.abs(new Date(invitation.expiresAt).getTime() - Date.now() - 48 * 3600000) < 5000,
  )
  assert.equal('token' in invitation, false)
  const [rows] = await pool.execute(
    'SELECT token_hash, invited_by FROM company_invitations WHERE id = ?',
    [invitation.id],
  )
  assert.deepEqual(rows[0].token_hash, createHash('sha256').update(token).digest())
  assert.equal(String(rows[0].invited_by), admin.id)
  const preview = await request('/api/invitations/preview', 'POST', { token }, '')
  assert.equal(preview.status, 200)
  const data = await preview.json()
  assert.equal(data.invitation.companyName, 'Equipo Real')
  assert.equal(data.invitation.department, 'Ventas')
  assert.equal(data.invitation.jobTitle, 'Asesor')
  assert.equal(preview.headers.get('cache-control'), 'no-store')
})

test('duplicados simultaneos envian una sola vez y las membresias existentes no se reinvitan', async () => {
  const body = { email: 'race-invite@example.com', role: 'employee' }
  const before = messages.length
  const results = await Promise.all([
    request(path(), 'POST', body, admin.cookie),
    request(path(), 'POST', body, admin.cookie),
  ])
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409])
  assert.equal(messages.length, before + 1)
  assert.equal(
    (
      await request(
        path(),
        'POST',
        { email: employee.email, role: 'employee' },
        admin.cookie,
      )
    ).status,
    409,
  )
})

test('aceptar requiere correo coincidente y verificado; alta y consumo son atomicos', async () => {
  const user = await register('accept-new@example.com')
  const { invitation, token } = await create({ email: user.email })
  assert.equal(
    (await request('/api/invitations/verify-email', 'POST', { token }, outsider.cookie))
      .status,
    403,
  )
  assert.equal(
    (await request('/api/invitations/accept', 'POST', { token }, user.cookie)).status,
    403,
  )
  await verify(token, user)
  const accepted = await request(
    '/api/invitations/accept',
    'POST',
    { token },
    user.cookie,
  )
  assert.equal(accepted.status, 200)
  assert.equal((await accepted.json()).companyId, companyId)
  const [members] = await pool.execute(
    'SELECT role, department, job_title, status FROM company_memberships WHERE company_id = ? AND user_id = ?',
    [companyId, user.id],
  )
  assert.deepEqual(
    { ...members[0] },
    { role: 'employee', department: 'Ventas', job_title: 'Asesor', status: 'active' },
  )
  const [rows] = await pool.execute(
    'SELECT status, accepted_by, accepted_at FROM company_invitations WHERE id = ?',
    [invitation.id],
  )
  assert.equal(rows[0].status, 'accepted')
  assert.equal(String(rows[0].accepted_by), user.id)
  assert.ok(rows[0].accepted_at)
  assert.equal(
    (await request('/api/invitations/accept', 'POST', { token }, user.cookie)).status,
    410,
  )
  assert.equal(
    (await request('/api/invitations/preview', 'POST', { token }, '')).status,
    410,
  )
})

test('solo el propietario invita administradores y se asigna el rol autorizado', async () => {
  const user = await register('accept-admin@example.com')
  const { invitation, token } = await create(
    { email: user.email, role: 'admin' },
    owner.cookie,
  )
  assert.equal(
    (await request(`${path()}/${invitation.id}/revoke`, 'POST', {}, admin.cookie)).status,
    403,
  )
  assert.equal(
    (await request(`${path()}/${invitation.id}/resend`, 'POST', {}, admin.cookie)).status,
    403,
  )
  await verify(token, user)
  assert.equal(
    (await request('/api/invitations/accept', 'POST', { token }, user.cookie)).status,
    200,
  )
  const [rows] = await pool.execute(
    'SELECT role FROM company_memberships WHERE company_id = ? AND user_id = ?',
    [companyId, user.id],
  )
  assert.equal(rows[0].role, 'admin')
})

test('dos aceptaciones simultaneas crean una sola membresia', async () => {
  const user = await register('accept-race@example.com')
  const { token } = await create({ email: user.email })
  await verify(token, user)
  const responses = await Promise.all([
    request('/api/invitations/accept', 'POST', { token }, user.cookie),
    request('/api/invitations/accept', 'POST', { token }, user.cookie),
  ])
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 410])
})

test('un fallo SQL revierte membresia y estado de aceptacion', async () => {
  const user = await register('accept-rollback@example.com')
  const { invitation, token } = await create({ email: user.email })
  await verify(token, user)
  await pool.query(
    "CREATE TRIGGER reject_invitation_accept BEFORE UPDATE ON company_invitations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Intentional failure'",
  )
  try {
    assert.equal(
      (await request('/api/invitations/accept', 'POST', { token }, user.cookie)).status,
      500,
    )
    const [members] = await pool.execute(
      'SELECT user_id FROM company_memberships WHERE company_id = ? AND user_id = ?',
      [companyId, user.id],
    )
    assert.equal(members.length, 0)
    const [rows] = await pool.execute(
      'SELECT status FROM company_invitations WHERE id = ?',
      [invitation.id],
    )
    assert.equal(rows[0].status, 'pending')
  } finally {
    await pool.query('DROP TRIGGER reject_invitation_accept')
  }
})

test('revocar y rechazar invalidan el enlace sin agregar miembros', async () => {
  const revoked = await create()
  assert.equal(
    (await request(`${path(otherId)}/${revoked.invitation.id}/revoke`, 'POST', {}))
      .status,
    404,
  )
  assert.equal(
    (await request(`${path()}/${revoked.invitation.id}/revoke`, 'POST', {})).status,
    200,
  )
  assert.equal(
    (await request('/api/invitations/preview', 'POST', { token: revoked.token }, ''))
      .status,
    410,
  )
  const user = await register('decline@example.com')
  const declined = await create({ email: user.email })
  assert.equal(
    (
      await request(
        '/api/invitations/decline',
        'POST',
        { token: declined.token },
        user.cookie,
      )
    ).status,
    200,
  )
  assert.equal(
    (
      await request(
        '/api/invitations/accept',
        'POST',
        { token: declined.token },
        user.cookie,
      )
    ).status,
    410,
  )
})

test('vencimiento efectivo libera nuevas invitaciones y mantiene el historial', async () => {
  const old = await create()
  await pool.execute(
    'UPDATE company_invitations SET created_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 3 DAY), expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 DAY) WHERE id = ?',
    [old.invitation.id],
  )
  assert.equal(
    (await request('/api/invitations/preview', 'POST', { token: old.token }, '')).status,
    410,
  )
  assert.equal(
    (await request(`${path()}/${old.invitation.id}/resend`, 'POST', {}, admin.cookie))
      .status,
    409,
  )
  const listing = await request(
    `${path()}?status=expired`,
    'GET',
    undefined,
    admin.cookie,
  )
  assert.equal(
    (await listing.json()).invitations.some((i) => i.id === old.invitation.id),
    true,
  )
  const fresh = await create({ email: old.invitation.email })
  assert.notEqual(fresh.invitation.id, old.invitation.id)
})

test('reenviar rota token, aplica cooldown y serializa envios concurrentes', async () => {
  const old = await create()
  assert.equal(
    (await request(`${path()}/${old.invitation.id}/resend`, 'POST', {}, admin.cookie))
      .status,
    429,
  )
  await ageAttempt(old.invitation.id)
  const before = messages.length
  const responses = await Promise.all([
    request(`${path()}/${old.invitation.id}/resend`, 'POST', {}, admin.cookie),
    request(`${path()}/${old.invitation.id}/resend`, 'POST', {}, admin.cookie),
  ])
  assert.equal(responses.filter((r) => r.status === 200).length, 1)
  assert.ok(responses.some((r) => [409, 429].includes(r.status)))
  assert.equal(messages.length, before + 1)
  assert.equal(
    (await request('/api/invitations/preview', 'POST', { token: old.token }, '')).status,
    404,
  )
})

test('fallos SMTP se registran sin exponer respuestas ni secretos', async () => {
  mailMock.mock.mockImplementationOnce(async () => {
    throw Object.assign(new Error('secret-token-and-password'), { code: 'EAUTH' })
  })
  const failed = await create()
  assert.equal(failed.invitation.deliveryStatus, 'failed')
  assert.equal(failed.invitation.lastSendError, 'EAUTH')
  assert.equal(failed.invitation.sendAttempts, 1)
  assert.equal(failed.invitation.sending, false)
  await pool.execute('UPDATE company_invitations SET send_attempts = 5 WHERE id = ?', [
    failed.invitation.id,
  ])
  await ageAttempt(failed.invitation.id)
  assert.equal(
    (await request(`${path()}/${failed.invitation.id}/resend`, 'POST', {}, admin.cookie))
      .status,
    409,
  )
})

test('reintenta una conexion fallida, pero no un timeout despues de DATA', async () => {
  mailMock.mock.mockImplementationOnce(async () => {
    throw Object.assign(new Error('connection'), { code: 'ECONNECTION', command: 'CONN' })
  })
  const recovered = await create()
  assert.equal(recovered.invitation.deliveryStatus, 'sent')
  assert.equal(recovered.invitation.sendAttempts, 2)
  mailMock.mock.mockImplementationOnce(async () => {
    throw Object.assign(new Error('uncertain delivery'), {
      code: 'ETIMEDOUT',
      command: 'DATA',
    })
  })
  const uncertain = await create()
  assert.equal(uncertain.invitation.deliveryStatus, 'failed')
  assert.equal(uncertain.invitation.sendAttempts, 1)
})

test('un remitente suspendido o degradado invalida sus invitaciones', async () => {
  const pending = await create()
  await ageAttempt(pending.invitation.id)
  assert.equal(
    (await request(`${path()}/${pending.invitation.id}/resend`, 'POST', {}, owner.cookie))
      .status,
    200,
  )
  const [sender] = await pool.execute(
    'SELECT invited_by FROM company_invitations WHERE id = ?',
    [pending.invitation.id],
  )
  assert.equal(String(sender[0].invited_by), admin.id)
  const currentToken = messages.findLast(
    (message) => message.email === pending.invitation.email,
  ).token
  await pool.execute(
    "UPDATE company_memberships SET status = 'suspended' WHERE company_id = ? AND user_id = ?",
    [companyId, admin.id],
  )
  try {
    assert.equal(
      (await request('/api/invitations/preview', 'POST', { token: currentToken }, ''))
        .status,
      410,
    )
  } finally {
    await pool.execute(
      "UPDATE company_memberships SET status = 'active' WHERE company_id = ? AND user_id = ?",
      [companyId, admin.id],
    )
  }
  await pool.execute(
    "UPDATE company_memberships SET role = 'employee' WHERE company_id = ? AND user_id = ?",
    [companyId, admin.id],
  )
  try {
    assert.equal(
      (await request('/api/invitations/preview', 'POST', { token: currentToken }, ''))
        .status,
      410,
    )
  } finally {
    await pool.execute(
      "UPDATE company_memberships SET role = 'admin' WHERE company_id = ? AND user_id = ?",
      [companyId, admin.id],
    )
  }
})

test('una membresia creada mientras se invita no se sobrescribe ni se reactiva', async () => {
  const user = await register('membership-race@example.com')
  const pending = await create({ email: user.email })
  await verify(pending.token, user)
  await pool.execute(
    "INSERT INTO company_memberships (company_id, user_id, role, status) VALUES (?, ?, 'employee', 'suspended')",
    [companyId, user.id],
  )
  assert.equal(
    (
      await request(
        '/api/invitations/accept',
        'POST',
        { token: pending.token },
        user.cookie,
      )
    ).status,
    409,
  )
})

test('doce listados concurrentes no agotan el pool reteniendo conexiones', async () => {
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => request(path(), 'GET', undefined, admin.cookie)),
  )
  assert.ok(responses.every((response) => response.status === 200))
})

test('empresa archivada y cuenta receptora desactivada bloquean el acceso', async () => {
  const user = await register('disabled-recipient@example.com')
  const pending = await create({ email: user.email })
  await pool.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [user.id])
  assert.equal(
    (
      await request(
        '/api/invitations/verify-email',
        'POST',
        { token: pending.token },
        user.cookie,
      )
    ).status,
    401,
  )
  await pool.execute("UPDATE companies SET status = 'archived' WHERE id = ?", [companyId])
  try {
    assert.equal(
      (await request('/api/invitations/preview', 'POST', { token: pending.token }, ''))
        .status,
      404,
    )
  } finally {
    await pool.execute("UPDATE companies SET status = 'active' WHERE id = ?", [companyId])
  }
})

test('conteo de miembros excluye cuentas globales desactivadas', async () => {
  const user = await register('disabled-member@example.com')
  const before = (await (await request(`/api/companies/${companyId}`, 'GET')).json())
    .company.memberCount
  await pool.execute(
    "INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'employee')",
    [companyId, user.id],
  )
  await pool.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [user.id])
  const after = (await (await request(`/api/companies/${companyId}`, 'GET')).json())
    .company.memberCount
  assert.equal(after, before)
})
