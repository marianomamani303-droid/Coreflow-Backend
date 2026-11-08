const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { before, after, test } = require('node:test')
const mysql = require('mysql2/promise')

// Todas las escrituras se limitan a una base temporal propia.
process.env.DB_NAME = `coreflow_products_test_${randomBytes(8).toString('hex')}`
const { env } = require('../dist/config/env.js')
const { app } = require('../dist/app.js')
const { pool, closeDatabase } = require('../dist/config/database.js')
let server
let baseUrl
let created = false
let owner
let admin
let employee
let stranger
let companyId
let secondCompanyId
const input = {
  name: 'Lámpara Nórdica',
  sku: 'EN-009',
  category: 'Iluminación',
  price: '48500.25',
}

async function request(path, body, session = owner?.cookie, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CoreFlow-Request': '1',
      ...(session ? { Cookie: session } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function register(name) {
  const response = await request(
    '/api/auth/register',
    {
      fullName: `${name} Test`,
      email: `${name}@example.com`,
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

function productsPath(id = companyId) {
  return `/api/companies/${id}/products`
}

async function counts() {
  const [rows] = await pool.query(
    'SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM categories) AS categories',
  )
  return { products: Number(rows[0].products), categories: Number(rows[0].categories) }
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
  owner = await register('owner')
  admin = await register('admin')
  employee = await register('employee')
  stranger = await register('stranger')
  const first = await request('/api/companies', { name: 'Products North' })
  const second = await request('/api/companies', { name: 'Products South' })
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  companyId = (await first.json()).company.id
  secondCompanyId = (await second.json()).company.id
  await pool.execute(
    `INSERT INTO company_memberships (company_id, user_id, role)
     VALUES (?, ?, 'admin'), (?, ?, 'employee')`,
    [companyId, admin.id, companyId, employee.id],
  )
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  await closeDatabase()
  if (created && /^coreflow_products_test_[a-f0-9]{16}$/.test(env.database.name)) {
    const connection = await mysql.createConnection({
      host: env.database.host,
      port: env.database.port,
      user: env.database.user,
      password: env.database.password,
    })
    try {
      await connection.query('DROP DATABASE ??', [env.database.name])
    } finally {
      await connection.end()
    }
  }
})

test('guardar exige sesión y protección de origen, sin escribir datos', async () => {
  const before = await counts()
  assert.equal((await request(productsPath(), input, '')).status, 401)
  assert.equal((await request(productsPath(), input, 'access_token=invalid')).status, 401)
  assert.equal(
    (await request(productsPath(), input, owner.cookie, { 'X-CoreFlow-Request': '' }))
      .status,
    403,
  )
  assert.equal(
    (
      await request(productsPath(), input, owner.cookie, {
        Origin: 'https://untrusted.example',
      })
    ).status,
    403,
  )
  assert.deepEqual(await counts(), before)
})

test('owner guarda en products y relaciona la categoría de la empresa', async () => {
  const response = await request(productsPath(), {
    ...input,
    name: `  ${input.name} `,
    sku: ` ${input.sku} `,
    category: ` ${input.category} `,
  })
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const result = await response.json()
  assert.deepEqual(Object.keys(result), ['productId'])
  assert.equal(typeof result.productId, 'string')
  const [rows] = await pool.execute(
    `SELECT p.company_id, p.sku, p.name, p.price, p.status, c.name AS category,
       c.company_id AS category_company_id
     FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    [result.productId],
  )
  assert.deepEqual(rows[0], {
    company_id: companyId,
    sku: input.sku,
    name: input.name,
    price: input.price,
    status: 'active',
    category: input.category,
    category_company_id: companyId,
  })
})

test('admin guarda y reutiliza la categoría existente', async () => {
  const before = await counts()
  assert.equal(
    (await request(productsPath(), { ...input, sku: 'ADMIN-1' }, admin.cookie)).status,
    201,
  )
  const after = await counts()
  assert.equal(after.products, before.products + 1)
  assert.equal(after.categories, before.categories)
})

test('employee y usuarios ajenos no pueden guardar; el permiso es por empresa', async () => {
  const before = await counts()
  assert.equal((await request(productsPath(), input, employee.cookie)).status, 403)
  assert.equal((await request(productsPath(), input, stranger.cookie)).status, 404)
  assert.equal(
    (await request(productsPath(secondCompanyId), input, admin.cookie)).status,
    404,
  )
  assert.deepEqual(await counts(), before)
})

test('rechaza suplantación por body y validación inválida sin escribir', async () => {
  const before = await counts()
  const invalid = [
    null,
    [],
    {},
    'text',
    { ...input, name: ' ' },
    { ...input, name: 'x'.repeat(161) },
    { ...input, name: 123 },
    { ...input, sku: ' ' },
    { ...input, sku: 'x'.repeat(65) },
    { ...input, sku: {} },
    { ...input, category: ' ' },
    { ...input, category: 'x'.repeat(81) },
    { ...input, category: [] },
    ...['', '-1', '1.001', '1e2', 'NaN', 'Infinity', '10000000000000', '0 OR 1=1'].map(
      (price) => ({ ...input, price }),
    ),
    { ...input, price: 10 },
    { ...input, price: null },
    ...['company_id', 'companyId', 'user_id', 'userId', 'category_id', 'role'].map(
      (field) => ({ ...input, [field]: '1' }),
    ),
  ]
  for (const body of invalid) {
    assert.equal((await request(productsPath(), body)).status, 400, JSON.stringify(body))
  }
  for (const id of ['0', '-1', 'abc', '18446744073709551616', '1%20OR%201=1']) {
    assert.equal((await request(productsPath(id), input)).status, 400)
  }
  assert.equal((await request(productsPath('99999999'), input)).status, 404)
  assert.deepEqual(await counts(), before)
})

test('SKU duplicado devuelve 409 y revierte también una categoría nueva', async () => {
  const before = await counts()
  const response = await request(productsPath(), {
    ...input,
    category: 'Rollback category',
  })
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    message: 'Ya existe un producto con ese SKU en esta empresa.',
  })
  assert.deepEqual(await counts(), before)
})

test('el mismo SKU y nombre de categoría se admiten en otra empresa sin cruzar relaciones', async () => {
  assert.equal((await request(productsPath(secondCompanyId), input)).status, 201)
  const [rows] = await pool.execute(
    `SELECT p.company_id, c.company_id AS category_company_id, p.category_id
     FROM products p JOIN categories c ON c.id = p.category_id WHERE p.sku = ? ORDER BY p.company_id`,
    [input.sku],
  )
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0].category_id, rows[1].category_id)
  for (const row of rows) assert.equal(row.company_id, row.category_company_id)
})

test('precios cero y máximo se conservan exactamente, con límites de texto del esquema', async () => {
  for (const price of ['0', '9999999999999.99']) {
    const response = await request(productsPath(), {
      name: 'N'.repeat(160),
      sku: `${price}-`.padEnd(64, 'S'),
      category: 'C'.repeat(80),
      price,
    })
    assert.equal(response.status, 201)
    const { productId } = await response.json()
    const [rows] = await pool.execute('SELECT price FROM products WHERE id = ?', [
      productId,
    ])
    assert.equal(rows[0].price, price === '0' ? '0.00' : price)
  }
})

test('los valores con SQL se guardan como texto literal', async () => {
  const literal = {
    name: "Producto '; DROP TABLE users; --",
    sku: "' OR 1=1 --",
    category: "Categoría ' SQL",
    price: '0.10',
  }
  const response = await request(productsPath(), literal)
  assert.equal(response.status, 201)
  const { productId } = await response.json()
  const [rows] = await pool.execute(
    'SELECT name, sku, price FROM products WHERE id = ?',
    [productId],
  )
  assert.deepEqual(rows[0], {
    name: literal.name,
    sku: literal.sku,
    price: literal.price,
  })
  const [users] = await pool.query('SELECT COUNT(*) AS count FROM users')
  assert.equal(Number(users[0].count), 4)
})

test('dos guardados concurrentes no duplican SKU ni categoría', async () => {
  const concurrent = { ...input, sku: 'CONCURRENT', category: 'Concurrent category' }
  const before = await counts()
  const responses = await Promise.all([
    request(productsPath(), concurrent),
    request(productsPath(), concurrent),
  ])
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409])
  const after = await counts()
  assert.equal(after.products, before.products + 1)
  assert.equal(after.categories, before.categories + 1)
})

test('cambiar rol, suspender membresía, archivar empresa o desactivar usuario bloquea un JWT vigente', async () => {
  const before = await counts()
  const changes = [
    [
      'UPDATE company_memberships SET role = ? WHERE company_id = ? AND user_id = ?',
      [companyId, owner.id],
      'employee',
      'owner',
      403,
    ],
    [
      'UPDATE company_memberships SET status = ? WHERE company_id = ? AND user_id = ?',
      [companyId, owner.id],
      'suspended',
      'active',
      404,
    ],
    [
      'UPDATE companies SET status = ? WHERE id = ?',
      [companyId],
      'archived',
      'active',
      404,
    ],
    ['UPDATE users SET status = ? WHERE id = ?', [owner.id], 'disabled', 'active', 401],
  ]
  for (const [sql, ids, blocked, enabled, status] of changes) {
    await pool.execute(sql, [blocked, ...ids])
    try {
      assert.equal(
        (await request(productsPath(), { ...input, sku: 'BLOCKED' })).status,
        status,
      )
    } finally {
      await pool.execute(sql, [enabled, ...ids])
    }
  }
  assert.deepEqual(await counts(), before)
})

test('el listado real conserva tipos, categorías y aislamiento por empresa', async () => {
  const response = await request(productsPath())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const rows = await response.json()
  assert.ok(rows.length > 0)
  for (const row of rows) {
    assert.equal(row.company_id, companyId)
    assert.equal(typeof row.id, 'string')
    assert.equal(typeof row.category_id, 'string')
    assert.equal(typeof row.price, 'string')
    assert.equal(typeof row.category, 'string')
    assert.equal(typeof row.stock, 'number')
  }
  assert.equal((await request(productsPath(), undefined, employee.cookie)).status, 200)
  for (const suffix of ['', '/mostrarProducts']) {
    assert.equal(
      (await request(productsPath() + suffix, undefined, stranger.cookie)).status,
      404,
    )
    assert.equal((await request(productsPath() + suffix, undefined, '')).status, 401)
    await pool.execute(
      "UPDATE company_memberships SET status = 'suspended' WHERE company_id = ? AND user_id = ?",
      [companyId, employee.id],
    )
    try {
      assert.equal(
        (await request(productsPath() + suffix, undefined, employee.cookie)).status,
        404,
      )
    } finally {
      await pool.execute(
        "UPDATE company_memberships SET status = 'active' WHERE company_id = ? AND user_id = ?",
        [companyId, employee.id],
      )
    }
  }
  assert.equal((await request(`${productsPath()}/1`)).status, 404)
})
