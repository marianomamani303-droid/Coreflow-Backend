const { randomBytes } = require('node:crypto')
const { readdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const dotenv = require('dotenv')
const mysql = require('mysql2/promise')

const root = resolve(__dirname, '..')
dotenv.config({ path: resolve(root, '.env.test'), quiet: true })

async function main() {
  for (const name of [
    'TEST_DB_HOST',
    'TEST_DB_PORT',
    'TEST_DB_USER',
    'TEST_DB_PASSWORD',
  ]) {
    if (
      process.env[name] === undefined ||
      (name !== 'TEST_DB_PASSWORD' && !process.env[name].trim())
    ) {
      throw new Error(`Falta ${name}. Usá .env.test con un servidor de pruebas dedicado.`)
    }
  }
  if (
    !/^\d+$/.test(process.env.TEST_DB_PORT) ||
    Number(process.env.TEST_DB_PORT) < 1 ||
    Number(process.env.TEST_DB_PORT) > 65535
  ) {
    throw new Error('TEST_DB_PORT debe ser un puerto válido.')
  }
  // No se heredan credenciales DB_* ni SMTP del .env de la aplicación.
  const databaseName = `coreflow_infrastructure_test_${randomBytes(8).toString('hex')}`
  const testEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DB_HOST: process.env.TEST_DB_HOST,
    DB_PORT: process.env.TEST_DB_PORT,
    DB_USER: process.env.TEST_DB_USER,
    DB_PASSWORD: process.env.TEST_DB_PASSWORD,
    DB_NAME: databaseName,
    DB_SSL: 'false',
    DB_SSL_CA: '',
    JWT_SECRET: randomBytes(48).toString('hex'),
    HOST: '127.0.0.1',
    PORT: '3000',
    AUTH_SESSION_SECONDS: '28800',
    TRUST_PROXY: '',
    CORS_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
    PUBLIC_APP_URL: 'http://127.0.0.1:5173',
    SMTP_HOST: '',
    SMTP_PORT: '587',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    SMTP_SECURE: 'false',
    SMTP_REQUIRE_TLS: 'true',
    MAIL_FROM: '',
  }
  const run = (args) => {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: testEnv,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    return result.status ?? 1
  }
  const mode = process.argv[2] ?? 'all'
  if (
    !['all', 'invitations', 'database', 'browser', 'invitations-browser'].includes(mode)
  ) {
    throw new Error('Modo de pruebas inválido.')
  }
  if (mode === 'browser' || mode === 'invitations-browser') {
    const files =
      mode === 'invitations-browser'
        ? ['invitations.browser.cjs']
        : [
            'products.browser.cjs',
            'operations.browser.cjs',
            'inventory-selection.browser.cjs',
            'orders.browser.cjs',
            'settings.browser.cjs',
            'invitations.browser.cjs',
          ]
    for (const file of files) {
      const status = run([`tests/${file}`])
      if (status) {
        process.exitCode = status
        return
      }
    }
    return
  }
  // Infrastructure also gets a temporary schema, including when tests fail.
  let connection
  let created = false
  try {
    connection = await mysql.createConnection({
      host: testEnv.DB_HOST,
      port: Number(testEnv.DB_PORT),
      user: testEnv.DB_USER,
      password: testEnv.DB_PASSWORD,
      connectTimeout: 5000,
    })
    await connection.query('CREATE DATABASE ??', [databaseName])
    created = true
    if (run(['scripts/database.cjs']))
      throw new Error('No se pudo preparar el esquema temporal.')
    const files =
      mode === 'all'
        ? readdirSync(resolve(root, 'tests')).filter((name) => name.endsWith('.test.cjs'))
        : mode === 'database'
          ? ['invitations.database.test.cjs']
          : [
              'invitations.database.test.cjs',
              'invitations.integration.test.cjs',
              'mail.test.cjs',
            ]
    process.exitCode = run(['--test', ...files.map((file) => `tests/${file}`)])
  } finally {
    // databaseName is generated here and is never taken from user/environment input.
    try {
      if (created) await connection.query('DROP DATABASE ??', [databaseName])
    } finally {
      if (connection) await connection.end()
    }
  }
}

main().catch((error) => {
  // Driver messages can contain credentials or SQL; expose only controlled messages.
  console.error(
    error.code
      ? `[test] Falló la conexión de pruebas (${error.code}).`
      : `[test] ${error.message}`,
  )
  process.exitCode = 1
})
