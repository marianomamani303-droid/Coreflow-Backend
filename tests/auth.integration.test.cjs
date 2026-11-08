const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { before, after, test } = require('node:test')
const mysql = require('mysql2/promise')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

// Base aislada: nunca escribe ni elimina filas de coreflow.
process.env.DB_NAME = `coreflow_auth_test_${randomBytes(8).toString('hex')}`
const { env } = require('../dist/config/env.js')
const { app } = require('../dist/app.js')
const { pool, closeDatabase } = require('../dist/config/database.js')
let server
let baseUrl
let created = false
let cookie
let userId

async function request(path, body, session = cookie, extra = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CoreFlow-Request': '1',
      ...(session ? { Cookie: session } : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

before(async () => {
  const setup = spawnSync(
    process.execPath,
    [resolve(__dirname, '../scripts/database.cjs')],
    {
      env: process.env,
      encoding: 'utf8',
    },
  )
  assert.equal(setup.status, 0, setup.stderr)
  created = true
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  await closeDatabase()
  if (created && /^coreflow_auth_test_[a-f0-9]{16}$/.test(env.database.name)) {
    const admin = await mysql.createConnection({
      host: env.database.host,
      port: env.database.port,
      user: env.database.user,
      password: env.database.password,
    })
    await admin.query('DROP DATABASE ??', [env.database.name])
    await admin.end()
  }
})

test('registro conserva nombre, normaliza correo, hashea y abre una sesión HttpOnly', async () => {
  const response = await request(
    '/api/auth/register',
    {
      fullName: '  Ada   Lovelace  ',
      email: ' ADA@example.com ',
      password: 'Strong-password-2026',
    },
    '',
  )
  assert.equal(response.status, 201)
  const result = await response.json()
  assert.deepEqual(Object.keys(result.user).sort(), ['email', 'fullName', 'id'])
  assert.equal(result.user.fullName, 'Ada Lovelace')
  assert.equal(result.user.email, 'ada@example.com')
  assert.equal(typeof result.user.id, 'string')
  userId = result.user.id
  const header = response.headers.get('set-cookie')
  assert.ok(
    header.includes('HttpOnly') &&
      header.includes('SameSite=Lax') &&
      header.includes('Path=/'),
  )
  assert.ok(header.includes(`Max-Age=${env.auth.sessionSeconds}`))
  cookie = header.split(';')[0]
  const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [
    userId,
  ])
  assert.ok(await bcrypt.compare('Strong-password-2026', rows[0].password_hash))
  const me = await request('/api/auth/me')
  assert.equal(me.status, 200)
  assert.deepEqual((await me.json()).user, result.user)
})

test('correo duplicado y carreras de registro devuelven 409', async () => {
  const duplicate = await request('/api/auth/register', {
    fullName: 'Another Person',
    email: 'ada@example.com',
    password: 'Strong-password-2026',
  })
  assert.equal(duplicate.status, 409)
  const body = {
    fullName: 'Race Test',
    email: 'race@example.com',
    password: 'Strong-password-2026',
  }
  const responses = await Promise.all([
    request('/api/auth/register', body),
    request('/api/auth/register', body),
  ])
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409])
})

test('valida objetos, fullName, correo, contraseña y el límite real de bytes de bcrypt', async () => {
  const valid = {
    fullName: 'Valid Person',
    email: 'valid@example.com',
    password: 'Strong-password-2026',
  }
  for (const body of [
    [],
    {},
    { ...valid, fullName: ' ' },
    { ...valid, email: [] },
    { ...valid, password: 'short' },
    { ...valid, password: 'á'.repeat(37) },
  ]) {
    const response = await request('/api/auth/register', body)
    assert.equal(response.status, 400)
  }
})

test('login devuelve el mismo 401 para correo inexistente y contraseña incorrecta', async () => {
  const wrong = await request(
    '/api/auth/login',
    { email: 'ada@example.com', password: 'wrong' },
    '',
  )
  const absent = await request(
    '/api/auth/login',
    { email: 'absent@example.com', password: 'wrong' },
    '',
  )
  assert.equal(wrong.status, 401)
  assert.equal(absent.status, 401)
  assert.deepEqual(await wrong.json(), await absent.json())
})

test('login crea otra cookie y /me recupera la sesión sin devolver token ni hash', async () => {
  const response = await request(
    '/api/auth/login',
    { email: 'ada@example.com', password: 'Strong-password-2026' },
    '',
  )
  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(await response.json()), ['user'])
  cookie = response.headers.get('set-cookie').split(';')[0]
  const me = await request('/api/auth/me')
  assert.equal(me.status, 200)
  assert.equal((await me.json()).user.id, userId)
})

test('requireAuth rechaza cookie ausente, token inválido, expirado o sin expiración', async () => {
  const expired = jwt.sign({ userId }, env.auth.secret, {
    algorithm: 'HS256',
    subject: userId,
    issuer: 'coreflow',
    audience: 'coreflow-web',
    expiresIn: -1,
  })
  const noExpiry = jwt.sign({ userId }, env.auth.secret, {
    algorithm: 'HS256',
    subject: userId,
    issuer: 'coreflow',
    audience: 'coreflow-web',
  })
  for (const session of [
    '',
    'access_token=bad-token',
    `access_token=${expired}`,
    `access_token=${noExpiry}`,
  ]) {
    const response = await request('/api/auth/me', undefined, session)
    assert.equal(response.status, 401)
  }
})

test('un usuario desactivado pierde acceso aunque su JWT siga vigente', async () => {
  await pool.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [userId])
  assert.equal((await request('/api/auth/me')).status, 401)
  await pool.execute("UPDATE users SET status = 'active' WHERE id = ?", [userId])
})

test('mutaciones rechazan origen ajeno y exigen cabecera no simple', async () => {
  assert.equal(
    (await request('/api/auth/logout', {}, cookie, { Origin: 'https://evil.example' }))
      .status,
    403,
  )
  const response = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' })
  assert.equal(response.status, 403)
})

test('logout elimina la cookie con los mismos atributos y una sesión ausente devuelve 401', async () => {
  const response = await request('/api/auth/logout', {})
  assert.equal(response.status, 204)
  const header = response.headers.get('set-cookie')
  assert.ok(
    header.startsWith('access_token=;') &&
      header.includes('HttpOnly') &&
      header.includes('Path=/'),
  )
  assert.equal((await request('/api/auth/me', undefined, '')).status, 401)
})

let companyId
let secondCompanyId
let otherSession
let otherUserId

test('Companies exige sesión y un usuario nuevo no tiene empresas', async () => {
  assert.equal((await request('/api/companies', undefined, '')).status, 401)
  assert.equal((await request('/api/companies', { name: 'No session' }, '')).status, 401)
  const login = await request(
    '/api/auth/login',
    { email: 'ada@example.com', password: 'Strong-password-2026' },
    '',
  )
  cookie = login.headers.get('set-cookie').split(';')[0]
  const list = await request('/api/companies')
  assert.equal(list.status, 200)
  assert.deepEqual(await list.json(), { companies: [] })
})

test('crear una empresa crea una membresía owner en la misma transacción', async () => {
  const response = await request('/api/companies', {
    name: '  North Studio ',
    sector: 'Design',
    role: 'employee',
    userId: '999999',
  })
  assert.equal(response.status, 201)
  const { company } = await response.json()
  companyId = company.id
  assert.equal(company.name, 'North Studio')
  assert.equal(company.role, 'owner')
  assert.equal(company.memberCount, 1)
  const [rows] = await pool.execute(
    'SELECT user_id, role FROM company_memberships WHERE company_id = ?',
    [companyId],
  )
  assert.equal(rows.length, 1)
  assert.equal(String(rows[0].user_id), userId)
  assert.equal(rows[0].role, 'owner')
})

test('un usuario crea varias empresas y sólo lista las propias', async () => {
  const second = await request('/api/companies', { name: 'Second Business' })
  secondCompanyId = (await second.json()).company.id
  const list = await request('/api/companies')
  assert.equal((await list.json()).companies.length, 2)
  const other = await request(
    '/api/auth/register',
    {
      fullName: 'Other User',
      email: 'other@example.com',
      password: 'Strong-password-2026',
    },
    '',
  )
  otherSession = other.headers.get('set-cookie').split(';')[0]
  otherUserId = (await other.json()).user.id
  assert.deepEqual(
    (await (await request('/api/companies', undefined, otherSession)).json()).companies,
    [],
  )
  assert.equal(
    (await request(`/api/companies/${companyId}`, undefined, otherSession)).status,
    404,
  )
})

test('los roles pertenecen a cada membresía: owner, admin y employee', async () => {
  const otherCompany = await request(
    '/api/companies',
    { name: 'Other Business' },
    otherSession,
  )
  const otherCompanyId = (await otherCompany.json()).company.id
  await pool.execute(
    "INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'admin')",
    [companyId, otherUserId],
  )
  const adminView = await request(`/api/companies/${companyId}`, undefined, otherSession)
  assert.equal((await adminView.json()).company.role, 'admin')
  const otherOwn = await request(
    `/api/companies/${otherCompanyId}`,
    undefined,
    otherSession,
  )
  assert.equal((await otherOwn.json()).company.role, 'owner')

  const employee = await request(
    '/api/auth/register',
    {
      fullName: 'Employee User',
      email: 'employee@example.com',
      password: 'Strong-password-2026',
    },
    '',
  )
  const employeeSession = employee.headers.get('set-cookie').split(';')[0]
  const employeeId = (await employee.json()).user.id
  await pool.execute(
    "INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'employee')",
    [companyId, employeeId],
  )
  const employeeView = await request(
    `/api/companies/${companyId}`,
    undefined,
    employeeSession,
  )
  assert.equal((await employeeView.json()).company.role, 'employee')
  assert.equal(
    (await request(`/api/companies/${secondCompanyId}`, undefined, employeeSession))
      .status,
    404,
  )
})

test('las membresías suspendidas y las empresas archivadas no dan acceso', async () => {
  await pool.execute(
    "UPDATE company_memberships SET status = 'suspended' WHERE company_id = ? AND user_id = ?",
    [companyId, userId],
  )
  assert.equal((await request(`/api/companies/${companyId}`)).status, 404)
  await pool.execute(
    "UPDATE company_memberships SET status = 'active' WHERE company_id = ? AND user_id = ?",
    [companyId, userId],
  )
  await pool.execute("UPDATE companies SET status = 'archived' WHERE id = ?", [companyId])
  assert.equal((await request(`/api/companies/${companyId}`)).status, 404)
  await pool.execute("UPDATE companies SET status = 'active' WHERE id = ?", [companyId])
})

test('Companies valida entradas y nunca interpola identificadores SQL del cliente', async () => {
  for (const body of [[], {}, { name: ' ' }, { name: 'Valid', sector: [] }]) {
    assert.equal((await request('/api/companies', body)).status, 400)
  }
  assert.equal((await request('/api/companies/not-a-number')).status, 400)
  assert.equal((await request('/api/companies/999999999999999999999999999')).status, 400)
  assert.equal((await request('/api/companies/999999999')).status, 404)
})

test('si falla la membresía, la transacción no deja una empresa huérfana', async () => {
  const {
    createCompanyForUser,
  } = require('../dist/features/companies/companies.service.js')
  const [before] = await pool.query('SELECT COUNT(*) AS count FROM companies')
  await assert.rejects(
    createCompanyForUser('999999999', { name: 'Rollback Test', sector: null }),
  )
  const [after] = await pool.query('SELECT COUNT(*) AS count FROM companies')
  assert.equal(after[0].count, before[0].count)
})
