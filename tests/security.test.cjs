const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const { once } = require('node:events')
const { after, before, mock, test } = require('node:test')
const { app } = require('../dist/app.js')
const database = require('../dist/config/database.js')
const auth = require('../dist/features/auth/auth.services.js')
const { parseRegistration } = require('../dist/features/auth/auth.validation.js')
const {
  parseCreateCompany,
} = require('../dist/features/companies/companies.validation.js')
const { parseCreateProduct } = require('../dist/features/products/product.validation.js')

let server, origin
before(async () => {
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  await database.closeDatabase()
})

test('nombres de un único carácter Unicode reciben 400 antes de llegar a SQL', () => {
  const invalid = (error) => error.status === 400
  assert.throws(
    () =>
      parseRegistration({
        fullName: '😀',
        email: 'x@example.com',
        password: 'strong-password',
      }),
    invalid,
  )
  assert.throws(() => parseCreateCompany({ name: '😀' }), invalid)
  assert.throws(
    () => parseCreateProduct({ name: '😀', sku: 'A', category: 'Test', price: '1' }),
    invalid,
  )
  assert.equal(parseCreateCompany({ name: '😀😀' }).name, '😀😀')
})

test('respuestas de errores privados tampoco pueden almacenarse en caché', async () => {
  const response = await fetch(`${origin}/api/companies/1/products`)
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-powered-by'), null)
})

test('sólo se confía en las direcciones de proxy configuradas', () => {
  const { env } = require('../dist/config/env.js')
  assert.equal(app.get('trust proxy'), false)
  assert.equal(app.get('trust proxy fn')('127.0.0.1', 0), false)
  try {
    app.set('trust proxy', ['loopback'])
    assert.equal(app.get('trust proxy fn')('127.0.0.1', 0), true)
    assert.equal(app.get('trust proxy fn')('203.0.113.1', 0), false)
  } finally {
    app.set('trust proxy', env.trustProxy.length ? [...env.trustProxy] : false)
  }
})

test('registros exitosos consumen cuota y el intento 31 recibe 429', async () => {
  // Sustituir bcrypt/SQL permite verificar el middleware sin crear 30 cuentas.
  const registration = mock.method(auth, 'servicesRegistration', async () => ({
    user: { id: '1', fullName: 'Rate Test', email: 'rate@example.com' },
    token: 'opaque-test-cookie',
  }))
  try {
    for (let i = 0; i < 31; i++) {
      const response = await fetch(`${origin}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CoreFlow-Request': '1' },
        body: JSON.stringify({
          fullName: 'Rate Test',
          email: 'rate@example.com',
          password: 'strong-password',
        }),
      })
      assert.equal(response.status, i < 30 ? 201 : 429)
      if (i === 0) assert.match(response.headers.get('set-cookie'), /HttpOnly/)
    }
    assert.equal(registration.mock.callCount(), 30)
  } finally {
    registration.mock.restore()
  }
})

test('configuración productiva rechaza orígenes inseguros y claves de ejemplo', () => {
  const run = (overrides) =>
    spawnSync(
      process.execPath,
      [
        '-e',
        'const {env}=require(process.argv[1]); console.log(JSON.stringify({production:env.production,ssl:env.database.ssl}))',
        resolve(__dirname, '../dist/config/env.js'),
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PUBLIC_APP_URL: 'https://coreflow.example.com',
          CORS_ORIGINS: 'https://coreflow.example.com',
          JWT_SECRET: 'a0123456789-b9876543210-c0123456789-d9876543210',
          ...overrides,
        },
        encoding: 'utf8',
        timeout: 5000,
      },
    )
  assert.equal(run({}).status, 0)
  for (const overrides of [
    { PUBLIC_APP_URL: '' },
    { CORS_ORIGINS: 'http://coreflow.example.com' },
    { CORS_ORIGINS: 'https://another.example.com' },
    { JWT_SECRET: 'x'.repeat(64) },
    { JWT_SECRET: 'change-me-example-secret-0123456789-abcdef' },
    { TRUST_PROXY: 'true' },
    { TRUST_PROXY: '0.0.0.0/00' },
    { TRUST_PROXY: '::/0' },
    { TRUST_PROXY: '203.0.113.1/99' },
    { DB_SSL: 'true', DB_HOST: '127.0.0.1' },
    { DB_SSL: 'false', DB_SSL_CA: 'private-ca.pem' },
    { NODE_ENV: 'prod' },
  ])
    assert.notEqual(run(overrides).status, 0, JSON.stringify(Object.keys(overrides)))
  const tls = run({ TRUST_PROXY: 'loopback', DB_SSL: 'true', DB_HOST: 'sql.example.com' })
  assert.equal(tls.status, 0)
  assert.deepEqual(JSON.parse(tls.stdout).ssl, {
    rejectUnauthorized: true,
    verifyIdentity: true,
  })
})
