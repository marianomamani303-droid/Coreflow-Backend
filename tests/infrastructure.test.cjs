const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { after, before, mock, test } = require('node:test')
const { app } = require('../dist/app.js')
const database = require('../dist/config/database.js')
const { env } = require('../dist/config/env.js')

let server
let baseUrl

before(async () => {
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  await database.closeDatabase()
})

test('health comprueba la conexión real y no permite cachear el resultado', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { status: 'ok', database: 'ok' })
})

test('health devuelve 503 sin exponer detalles cuando falla la base', async () => {
  const unavailable = mock.method(database, 'checkDatabaseConnection', async () => {
    throw new Error('Private connection details')
  })

  try {
    const response = await fetch(`${baseUrl}/api/health`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      status: 'error',
      database: 'unavailable',
    })
  } finally {
    unavailable.mock.restore()
  }
})

test('CORS admite los orígenes configurados y no autoriza uno ajeno', async () => {
  for (const origin of env.corsOrigins) {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: origin } })
    assert.equal(response.headers.get('access-control-allow-origin'), origin)
  }

  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://unconfigured.example' },
  })
  assert.equal(response.headers.get('access-control-allow-origin'), null)
})

test('JSON malformado recibe 400 y una ruta inexistente recibe 404', async () => {
  const malformed = await fetch(`${baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  })
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { error: 'Invalid request' })

  const missing = await fetch(`${baseUrl}/not-a-route`)
  assert.equal(missing.status, 404)
  assert.deepEqual(await missing.json(), { error: 'Not found' })
})

test('el pool usa UTC y la base contiene el campo full_name', async () => {
  const [timezone] = await database.pool.query('SELECT @@session.time_zone AS timezone')
  assert.equal(timezone[0].timezone, '+00:00')

  const [columns] = await database.pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'full_name'`,
    [env.database.name],
  )
  assert.equal(columns.length, 1)
})

test('un puerto ocupado produce salida de error sin anunciar un arranque exitoso', () => {
  const child = spawnSync(process.execPath, [resolve(__dirname, '../dist/server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(server.address().port) },
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(child.status, 1)
  assert.match(child.stderr, /No se pudo abrir el puerto/)
  assert.doesNotMatch(child.stdout, /funcionando/)
})
