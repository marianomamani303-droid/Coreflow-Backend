const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { mkdir } = require('node:fs/promises')
const mysql = require('mysql2/promise')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { startInbox, messageToken } = require('./helpers/smtp.cjs')

async function main() {
  const inbox = await startInbox()
  const origin = 'http://127.0.0.1:5181'
  process.env.DB_NAME = `coreflow_invitations_browser_test_${randomBytes(8).toString('hex')}`
  process.env.CORS_ORIGINS = origin
  process.env.PUBLIC_APP_URL = origin
  process.env.SMTP_HOST = '127.0.0.1'
  process.env.SMTP_PORT = String(inbox.port)
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_REQUIRE_TLS = 'false'
  process.env.SMTP_USER = ''
  process.env.SMTP_PASSWORD = ''
  process.env.MAIL_FROM = 'coreflow@example.com'
  const { app } = require('../dist/app.js')
  const { env } = require('../dist/config/env.js')
  const { pool, closeDatabase } = require('../dist/config/database.js')
  let server,
    vite,
    browser,
    created = false
  const errors = []
  try {
    const setup = spawnSync(
      process.execPath,
      [resolve(__dirname, '../scripts/database.cjs')],
      { env: process.env, encoding: 'utf8' },
    )
    assert.equal(setup.status, 0, setup.stderr)
    created = true
    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const frontend = resolve(__dirname, '../../mi-proyecto')
    const { createServer } = await import(
      pathToFileURL(resolve(frontend, 'node_modules/vite/dist/node/index.js')).href
    )
    vite = await createServer({
      root: frontend,
      configFile: resolve(frontend, 'vite.config.ts'),
      server: {
        host: '127.0.0.1',
        port: 5181,
        strictPort: true,
        proxy: {
          '/api': {
            target: `http://127.0.0.1:${server.address().port}`,
            changeOrigin: false,
          },
        },
      },
    })
    await vite.listen()
    browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_CHANNEL
        ? { channel: process.env.PLAYWRIGHT_CHANNEL }
        : process.platform === 'win32'
          ? { channel: 'msedge' }
          : {}),
      headless: true,
    })
    const owner = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    owner.setDefaultTimeout(15000)
    owner.on('pageerror', (error) => errors.push(error.message))
    const headers = { 'X-CoreFlow-Request': '1' }
    const password = 'Strong-password-2026'
    const registered = await owner.request.post(`${origin}/api/auth/register`, {
      headers,
      data: { fullName: 'Owner Browser', email: 'owner-browser@example.com', password },
    })
    assert.equal(registered.status(), 201)
    const company = (
      await (
        await owner.request.post(`${origin}/api/companies`, {
          headers,
          data: { name: 'Equipo Browser' },
        })
      ).json()
    ).company
    const teamUrl = `${origin}/app/empresa/${company.id}/empleados`
    await owner.goto(teamUrl)
    async function compose(email) {
      await owner.getByRole('button', { name: 'Invitar por correo', exact: true }).click()
      const dialog = owner.getByRole('dialog')
      await dialog.getByLabel('Correo electrónico').fill(email)
      await dialog.getByLabel('Departamento').fill('Ventas')
      await dialog.getByLabel('Puesto').fill('Asesor')
      await dialog.getByRole('button', { name: 'Enviar invitación', exact: true }).click()
      await dialog.getByText('Invitación enviada.', { exact: false }).waitFor()
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
      return messageToken(inbox.messages.at(-1))
    }
    const oldToken = await compose('new-browser@example.com')
    assert.ok(oldToken)
    const [rows] = await pool.execute(
      'SELECT id FROM company_invitations WHERE email = ?',
      ['new-browser@example.com'],
    )
    await pool.execute(
      'UPDATE company_invitations SET last_send_attempt_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 2 MINUTE) WHERE id = ?',
      [rows[0].id],
    )
    const row = owner.getByRole('row').filter({ hasText: 'new-browser@example.com' })
    await row.getByRole('button', { name: 'Reenviar', exact: true }).click()
    await owner
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmar reenvío', exact: true })
      .click()
    await owner.getByText('Invitación reenviada.', { exact: false }).waitFor()
    assert.equal(inbox.messages.length, 2)
    const token = messageToken(inbox.messages.at(-1))
    assert.ok(token && token !== oldToken)
    const recipient = await browser.newPage({ viewport: { width: 390, height: 900 } })
    recipient.setDefaultTimeout(15000)
    recipient.on('pageerror', (error) => errors.push(error.message))
    await recipient.goto(`${origin}/invitacion#token=${oldToken}`)
    await recipient
      .getByText('El enlace de invitacion no es valido o ya no esta disponible.', {
        exact: true,
      })
      .waitFor()
    await recipient.goto(`${origin}/invitacion#token=${token}`)
    await recipient
      .getByRole('link', { name: 'Crear cuenta para continuar', exact: true })
      .waitFor()
    for (const width of [320, 390, 768]) {
      await recipient.setViewportSize({ width, height: 900 })
      assert.equal(
        await recipient.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
    }
    const screenshotDir = resolve(__dirname, '../logs/invitations')
    await mkdir(screenshotDir, { recursive: true })
    await recipient.setViewportSize({ width: 390, height: 900 })
    await recipient.screenshot({
      path: resolve(screenshotDir, 'invitation-mobile.png'),
      fullPage: true,
    })
    await recipient
      .getByRole('link', { name: 'Crear cuenta para continuar', exact: true })
      .click()
    assert.equal(
      await recipient.getByLabel('Correo electrónico').inputValue(),
      'new-browser@example.com',
    )
    await recipient.getByLabel('Nombre completo').fill('Recipient Browser')
    await recipient.getByLabel('Contraseña', { exact: true }).fill(password)
    await recipient.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click()
    await recipient.waitForURL((url) => url.pathname === '/invitacion')
    await recipient
      .getByRole('button', { name: 'Verificar correo y aceptar', exact: true })
      .click()
    await recipient
      .getByRole('heading', { name: 'Ya sos parte del equipo', exact: true })
      .waitFor()
    await recipient
      .getByRole('link', { name: 'Entrar a la empresa', exact: true })
      .click()
    await recipient.waitForURL((url) => url.pathname === `/app/empresa/${company.id}`)
    await recipient.getByText('Tu rol: Empleado', { exact: true }).waitFor()
    const [members] = await pool.execute(
      "SELECT m.role, u.email_verified_at FROM company_memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? AND u.email = 'new-browser@example.com'",
      [company.id],
    )
    assert.equal(members[0].role, 'employee')
    assert.ok(members[0].email_verified_at)
    await owner.getByLabel('Estado de invitación').selectOption('accepted')
    await owner
      .getByRole('row')
      .filter({ hasText: 'new-browser@example.com' })
      .getByText('Aceptada', { exact: true })
      .waitFor()
    await owner.getByLabel('Estado de invitación').selectOption('pending')
    const revokedToken = await compose('revoke-browser@example.com')
    const revokeRow = owner
      .getByRole('row')
      .filter({ hasText: 'revoke-browser@example.com' })
    await revokeRow.getByRole('button', { name: 'Revocar', exact: true }).click()
    await owner
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmar revocación', exact: true })
      .click()
    await owner.getByText('Invitación revocada.', { exact: false }).waitFor()
    await recipient.goto(`${origin}/invitacion#token=${revokedToken}`)
    await recipient
      .getByText('Esta invitacion vencio o ya fue respondida o revocada.', {
        exact: true,
      })
      .waitFor()
    const existing = await browser.newPage()
    existing.on('pageerror', (error) => errors.push(error.message))
    assert.equal(
      (
        await existing.request.post(`${origin}/api/auth/register`, {
          headers,
          data: {
            fullName: 'Existing Browser',
            email: 'existing-browser@example.com',
            password,
          },
        })
      ).status(),
      201,
    )
    await existing.request.post(`${origin}/api/auth/logout`, { headers })
    const declineToken = await compose('existing-browser@example.com')
    await existing.goto(`${origin}/invitacion#token=${declineToken}`)
    await existing
      .getByRole('link', { name: 'Iniciar sesión para continuar', exact: true })
      .click()
    assert.equal(
      await existing.getByLabel('Correo electrónico').inputValue(),
      'existing-browser@example.com',
    )
    await existing.getByLabel('Contraseña', { exact: true }).fill(password)
    await existing.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
    await existing.waitForURL((url) => url.pathname === '/invitacion')
    await existing
      .getByRole('button', { name: 'Rechazar invitación', exact: true })
      .click()
    await existing
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmar rechazo', exact: true })
      .click()
    await existing
      .getByRole('heading', { name: 'Invitación rechazada', exact: true })
      .waitFor()
    await owner.screenshot({
      path: resolve(screenshotDir, 'invitations-team.png'),
      fullPage: true,
    })
    assert.deepEqual(errors, [])
    console.log(
      'OK navegador: SMTP local, envio, reenvio, token anterior, registro/login con retorno, verificacion, aceptacion, acceso real, revocacion, rechazo y responsive 320/390/768/1440px.',
    )
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    if (server) await new Promise((resolve) => server.close(resolve))
    await closeDatabase()
    if (
      created &&
      /^coreflow_invitations_browser_test_[a-f0-9]{16}$/.test(env.database.name)
    ) {
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
    await inbox.close()
  }
}
main().catch((error) => {
  console.error(String(error.stack ?? error).replace(/[a-f0-9]{64}/g, '[redacted]'))
  process.exitCode = 1
})
