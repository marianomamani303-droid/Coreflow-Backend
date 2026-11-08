const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { before, after, test } = require('node:test')
const mysql = require('mysql2/promise')

process.env.DB_NAME = `coreflow_operations_test_${randomBytes(8).toString('hex')}`
const { env } = require('../dist/config/env.js')
const { app } = require('../dist/app.js')
const { pool, closeDatabase } = require('../dist/config/database.js')
let server,
  baseUrl,
  created = false
let owner, admin, employee, outsider, recruit
let companyId, otherId, productId, otherProductId, warehouseId, otherWarehouseId

async function request(path, method = 'GET', body, cookie = owner?.cookie, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
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
async function register(name) {
  const response = await request(
    '/api/auth/register',
    'POST',
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
const base = (id = companyId) => `/api/companies/${id}`
const movement = (overrides = {}) => ({
  productId,
  warehouseId,
  type: 'inbound',
  quantity: 10,
  reason: 'Recepción de mercadería',
  ...overrides,
})
const member = (overrides = {}) => ({
  role: 'employee',
  department: 'Operaciones',
  jobTitle: 'Analista',
  status: 'active',
  ...overrides,
})
async function balance() {
  const [rows] = await pool.execute(
    'SELECT quantity, minimum_quantity FROM inventory_balances WHERE company_id = ? AND product_id = ? AND warehouse_id = ?',
    [companyId, productId, warehouseId],
  )
  return rows[0]
}
async function movementCount() {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS total FROM inventory_movements WHERE company_id = ?',
    [companyId],
  )
  return Number(rows[0].total)
}

before(async () => {
  const setup = spawnSync(
    process.execPath,
    [resolve(__dirname, '../scripts/database.cjs')],
    { env: process.env, encoding: 'utf8' },
  )
  assert.equal(setup.status, 0, setup.stderr)
  created = true
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
  owner = await register('owner')
  admin = await register('admin')
  employee = await register('employee')
  outsider = await register('outsider')
  recruit = await register('recruit')
  const first = await request('/api/companies', 'POST', { name: 'Operations North' })
  const second = await request('/api/companies', 'POST', { name: 'Operations South' })
  companyId = (await first.json()).company.id
  otherId = (await second.json()).company.id
  await pool.execute(
    "INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'admin'), (?, ?, 'employee')",
    [companyId, admin.id, companyId, employee.id],
  )
  for (const id of [companyId, otherId]) {
    const product = await request(`${base(id)}/products`, 'POST', {
      name: 'Producto real',
      sku: 'REAL-1',
      category: 'Operaciones',
      price: '10.55',
    })
    assert.equal(product.status, 201)
    const warehouse = await request(`${base(id)}/inventory/warehouses`, 'POST', {
      name: 'Central',
    })
    assert.equal(warehouse.status, 201)
    if (id === companyId) {
      productId = (await product.json()).productId
      warehouseId = (await warehouse.json()).warehouseId
    } else {
      otherProductId = (await product.json()).productId
      otherWarehouseId = (await warehouse.json()).warehouseId
    }
  }
})
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  await closeDatabase()
  if (created && /^coreflow_operations_test_[a-f0-9]{16}$/.test(env.database.name)) {
    const c = await mysql.createConnection({
      host: env.database.host,
      port: env.database.port,
      user: env.database.user,
      password: env.database.password,
    })
    try {
      await c.query('DROP DATABASE ??', [env.database.name])
    } finally {
      await c.end()
    }
  }
})

test('inventario y equipo exigen sesión, empresa activa y membresía activa en todas sus lecturas', async () => {
  for (const suffix of ['/inventory', '/inventory/movements', '/employees']) {
    assert.equal((await request(base() + suffix, 'GET', undefined, '')).status, 401)
    assert.equal(
      (await request(base() + suffix, 'GET', undefined, outsider.cookie)).status,
      404,
    )
    assert.equal(
      (await request(base(otherId) + suffix, 'GET', undefined, employee.cookie)).status,
      404,
    )
    const response = await request(base() + suffix, 'GET', undefined, employee.cookie)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    await pool.execute(
      "UPDATE company_memberships SET status = 'suspended' WHERE company_id = ? AND user_id = ?",
      [companyId, employee.id],
    )
    try {
      assert.equal(
        (await request(base() + suffix, 'GET', undefined, employee.cookie)).status,
        404,
      )
    } finally {
      await pool.execute(
        "UPDATE company_memberships SET status = 'active' WHERE company_id = ? AND user_id = ?",
        [companyId, employee.id],
      )
    }
    await pool.execute("UPDATE companies SET status = 'archived' WHERE id = ?", [
      companyId,
    ])
    try {
      assert.equal((await request(base() + suffix)).status, 404)
    } finally {
      await pool.execute("UPDATE companies SET status = 'active' WHERE id = ?", [
        companyId,
      ])
    }
  }
})
test('productos sin saldo se muestran en cero; depósitos no se cruzan entre empresas', async () => {
  const data = await (await request(`${base()}/inventory`)).json()
  assert.equal(data.inventory.length, 1)
  assert.equal(data.inventory[0].productId, productId)
  assert.equal(data.inventory[0].quantity, 0)
  assert.equal(data.inventory[0].warehouseId, null)
  assert.deepEqual(
    data.warehouses.map((w) => w.id),
    [warehouseId],
  )
  assert.equal(
    (await request(`${base()}/inventory/warehouses`, 'POST', { name: 'Central' })).status,
    409,
  )
})
test('sólo owner/admin mutan stock y equipo; se conservan las defensas CSRF', async () => {
  const ops = [
    ['/inventory/movements', 'POST', movement()],
    ['/inventory/minimum', 'PUT', { productId, warehouseId, minimum: 5 }],
    ['/inventory/warehouses', 'POST', { name: 'Blocked' }],
    ['/employees', 'POST', { email: recruit.email, role: 'employee' }],
    [`/employees/${employee.id}`, 'PATCH', member()],
  ]
  for (const [suffix, method, body] of ops) {
    assert.equal(
      (await request(base() + suffix, method, body, employee.cookie)).status,
      403,
    )
    assert.equal(
      (await request(base() + suffix, method, body, outsider.cookie)).status,
      404,
    )
    assert.equal(
      (
        await request(base() + suffix, method, body, owner.cookie, {
          'X-CoreFlow-Request': '',
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await request(base() + suffix, method, body, owner.cookie, {
          Origin: 'https://untrusted.example',
        })
      ).status,
      403,
    )
  }
  assert.equal(await movementCount(), 0)
})
test('validaciones estrictas rechazan tipos, cantidades y campos de suplantación', async () => {
  for (const change of [
    { quantity: -1 },
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: '10' },
    { quantity: 2147483648 },
    { type: 'initial' },
    { type: [] },
    { reason: ' ' },
    { reason: 'x'.repeat(256) },
    { productId: 1 },
    { warehouseId: '0' },
    { companyId: otherId },
    { created_by: outsider.id },
  ]) {
    assert.equal(
      (await request(`${base()}/inventory/movements`, 'POST', movement(change))).status,
      400,
      JSON.stringify(change),
    )
  }
  for (const payload of [
    null,
    [],
    {},
    { productId, warehouseId, minimum: -1 },
    { productId, warehouseId, minimum: '0' },
    { productId, warehouseId, minimum: 0, userId: owner.id },
  ]) {
    assert.equal(
      (await request(`${base()}/inventory/minimum`, 'PUT', payload)).status,
      400,
    )
  }
  for (const payload of [
    { email: recruit.email, role: 'owner' },
    { email: 'bad', role: 'employee' },
    { email: recruit.email, role: 'employee', department: 1 },
    { email: recruit.email, role: 'employee', companyId: otherId },
  ]) {
    assert.equal((await request(`${base()}/employees`, 'POST', payload)).status, 400)
  }
  for (const query of [
    'page=0',
    'page=1.5',
    'page[]=1',
    'type[]=inbound',
    'q[]=x',
    'productId=0',
    'companyId=1',
  ]) {
    assert.equal(
      (await request(`${base()}/inventory/movements?${query}`)).status,
      400,
      query,
    )
  }
})
test('no permite relacionar productos o depósitos de otra empresa ni deja saldos huérfanos', async () => {
  assert.equal(
    (
      await request(
        `${base()}/inventory/movements`,
        'POST',
        movement({ productId: otherProductId }),
      )
    ).status,
    404,
  )
  assert.equal(
    (
      await request(
        `${base()}/inventory/movements`,
        'POST',
        movement({ warehouseId: otherWarehouseId }),
      )
    ).status,
    404,
  )
  assert.equal(await balance(), undefined)
  assert.equal(await movementCount(), 0)
})
test('entrada, salida y ajustes por conteo guardan saldo y trazabilidad juntos', async () => {
  const initial = await request(
    `${base()}/inventory/movements`,
    'POST',
    movement(),
    admin.cookie,
  )
  assert.equal(initial.status, 201)
  assert.deepEqual(
    { ...(await initial.json()), movementId: 'id' },
    { movementId: 'id', quantity: 10, delta: 10 },
  )
  const minimum = await request(`${base()}/inventory/minimum`, 'PUT', {
    productId,
    warehouseId,
    minimum: 8,
  })
  assert.equal(minimum.status, 204)
  assert.equal(
    (
      await request(
        `${base()}/inventory/movements`,
        'POST',
        movement({ type: 'outbound', quantity: 3 }),
      )
    ).status,
    201,
  )
  assert.equal((await balance()).quantity, 7)
  let response = await request(
    `${base()}/inventory/movements`,
    'POST',
    movement({ type: 'adjustment', quantity: 4, reason: 'Conteo físico' }),
  )
  assert.equal(response.status, 201)
  assert.equal((await response.json()).delta, -3)
  response = await request(
    `${base()}/inventory/movements`,
    'POST',
    movement({ type: 'adjustment', quantity: 9 }),
  )
  assert.equal(response.status, 201)
  assert.equal((await response.json()).delta, 5)
  const unchanged = await movementCount()
  assert.equal(
    (
      await request(
        `${base()}/inventory/movements`,
        'POST',
        movement({ type: 'adjustment', quantity: 9 }),
      )
    ).status,
    409,
  )
  assert.equal(
    (
      await request(
        `${base()}/inventory/movements`,
        'POST',
        movement({ type: 'outbound', quantity: 10 }),
      )
    ).status,
    409,
  )
  assert.equal(await movementCount(), unchanged)
  const products = await (await request(`${base()}/products`)).json()
  assert.equal(products[0].stock, 9)
  const history = await (
    await request(`${base()}/inventory/movements?type=adjustment&q=Conteo`)
  ).json()
  assert.equal(history.total, 1)
  assert.equal(history.movements[0].delta, -3)
  assert.equal(history.movements[0].createdBy, owner.fullName)
  assert.equal(typeof history.movements[0].id, 'string')
  assert.equal(
    (await (await request(`${base(otherId)}/inventory/movements`)).json()).total,
    0,
  )
})
test('salidas concurrentes nunca sobrevenden y el saldo coincide con la suma del historial', async () => {
  const responses = await Promise.all(
    [1, 2].map(() =>
      request(
        `${base()}/inventory/movements`,
        'POST',
        movement({ type: 'outbound', quantity: 6 }),
      ),
    ),
  )
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409])
  assert.equal((await balance()).quantity, 3)
  const [rows] = await pool.execute(
    'SELECT SUM(quantity_delta) AS total FROM inventory_movements WHERE company_id = ? AND product_id = ? AND warehouse_id = ?',
    [companyId, productId, warehouseId],
  )
  assert.equal(Number(rows[0].total), 3)
})
test('un fallo al escribir historial revierte el saldo y nuevas filas de inventario', async () => {
  const previous = await balance(),
    count = await movementCount()
  await pool.query(
    "CREATE TRIGGER reject_test_movement BEFORE INSERT ON inventory_movements FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Intentional test failure'",
  )
  try {
    const response = await request(`${base()}/inventory/movements`, 'POST', movement())
    assert.equal(response.status, 500)
    assert.doesNotMatch(
      JSON.stringify(await response.json()),
      /Intentional|SQLSTATE|INSERT/,
    )
    assert.deepEqual(await balance(), previous)
    assert.equal(await movementCount(), count)
    const w = await request(`${base()}/inventory/warehouses`, 'POST', {
      name: 'Rollback location',
    })
    const wId = (await w.json()).warehouseId
    assert.equal(
      (
        await request(
          `${base()}/inventory/movements`,
          'POST',
          movement({ warehouseId: wId }),
        )
      ).status,
      500,
    )
    const [balances] = await pool.execute(
      'SELECT * FROM inventory_balances WHERE warehouse_id = ?',
      [wId],
    )
    assert.equal(balances.length, 0)
  } finally {
    await pool.query('DROP TRIGGER reject_test_movement')
  }
})
test('rechaza overflow y archivados, y permite agotar stock de productos archivados', async () => {
  assert.equal(
    (
      await request(
        `${base()}/inventory/movements`,
        'POST',
        movement({ quantity: 2147483647 }),
      )
    ).status,
    400,
  )
  await pool.execute("UPDATE products SET status = 'archived' WHERE id = ?", [productId])
  try {
    assert.equal(
      (await request(`${base()}/inventory/movements`, 'POST', movement())).status,
      409,
    )
    assert.equal(
      (
        await request(
          `${base()}/inventory/movements`,
          'POST',
          movement({ type: 'outbound', quantity: 3 }),
        )
      ).status,
      201,
    )
  } finally {
    await pool.execute("UPDATE products SET status = 'active' WHERE id = ?", [productId])
  }
})
test('historial pagina en el servidor y busca fuera de la primera página', async () => {
  for (let i = 0; i < 33; i++) {
    assert.equal(
      (
        await request(
          `${base()}/inventory/movements`,
          'POST',
          movement({ quantity: 1, reason: `Página ${i}` }),
        )
      ).status,
      201,
    )
  }
  const first = await (await request(`${base()}/inventory/movements`)).json()
  const second = await (await request(`${base()}/inventory/movements?page=2`)).json()
  assert.equal(first.movements.length, 30)
  assert.equal(second.movements.length, second.total - 30)
  assert.equal(
    new Set([...first.movements, ...second.movements].map((m) => m.id)).size,
    first.total,
  )
  const search = await (
    await request(`${base()}/inventory/movements?q=${encodeURIComponent('Página 0')}`)
  ).json()
  assert.equal(search.total, 1)
  const literal = await (
    await request(`${base()}/inventory/movements?q=${encodeURIComponent("' OR 1=1 --")}`)
  ).json()
  assert.equal(literal.total, 0)
})
test('incorpora usuarios existentes; evita cuentas inventadas y membresías duplicadas', async () => {
  assert.equal(
    (
      await request(`${base()}/employees`, 'POST', {
        email: 'missing@example.com',
        role: 'employee',
      })
    ).status,
    404,
  )
  const input = {
    email: recruit.email.toUpperCase(),
    role: 'employee',
    department: 'Operaciones',
    jobTitle: 'Analista',
  }
  const response = await request(`${base()}/employees`, 'POST', input, admin.cookie)
  assert.equal(response.status, 201)
  assert.equal((await response.json()).userId, recruit.id)
  assert.equal((await request(`${base()}/employees`, 'POST', input)).status, 409)
  const data = await (await request(`${base()}/employees`)).json()
  assert.equal(data.employees.length, 4)
  assert.ok(
    data.employees.find((e) => e.id === recruit.id && e.department === 'Operaciones'),
  )
  assert.equal(
    (await request(`${base()}/inventory`, 'GET', undefined, recruit.cookie)).status,
    200,
  )
  assert.equal(
    (await request(`${base(otherId)}/employees`, 'GET', undefined, recruit.cookie))
      .status,
    404,
  )
})
test('protege owner, propia membresía y administradores frente a escalamiento de rol', async () => {
  assert.equal(
    (await request(`${base()}/employees/${owner.id}`, 'PATCH', member())).status,
    403,
  )
  assert.equal(
    (await request(`${base()}/employees/${admin.id}`, 'PATCH', member(), admin.cookie))
      .status,
    403,
  )
  assert.equal(
    (
      await request(
        `${base()}/employees/${recruit.id}`,
        'PATCH',
        member({ role: 'admin' }),
        admin.cookie,
      )
    ).status,
    403,
  )
  assert.equal(
    (
      await request(
        `${base()}/employees`,
        'POST',
        { email: outsider.email, role: 'admin' },
        admin.cookie,
      )
    ).status,
    403,
  )
  assert.equal(
    (await request(`${base()}/employees/${outsider.id}`, 'PATCH', member())).status,
    404,
  )
  assert.equal(
    (
      await request(
        `${base()}/employees/${recruit.id}`,
        'PATCH',
        member({ role: 'admin' }),
      )
    ).status,
    204,
  )
  assert.equal(
    (await request(`${base()}/employees/${recruit.id}`, 'PATCH', member(), admin.cookie))
      .status,
    403,
  )
})
test('suspensión revoca JWT vigente en los tres módulos y reactivación conserva identidad', async () => {
  assert.equal(
    (
      await request(
        `${base()}/employees/${recruit.id}`,
        'PATCH',
        member({ role: 'admin', status: 'suspended' }),
      )
    ).status,
    204,
  )
  for (const suffix of [
    '/products',
    '/inventory',
    '/inventory/movements',
    '/employees',
  ]) {
    assert.equal(
      (await request(base() + suffix, 'GET', undefined, recruit.cookie)).status,
      404,
    )
  }
  assert.equal(
    (await request(`${base()}/employees/${recruit.id}`, 'PATCH', member())).status,
    204,
  )
  assert.equal(
    (await request(`${base()}/inventory`, 'GET', undefined, recruit.cookie)).status,
    200,
  )
  const data = await (await request(`${base()}/employees`)).json()
  assert.equal(data.employees.find((e) => e.id === recruit.id).role, 'employee')
  const [users] = await pool.query('SELECT COUNT(*) AS total FROM users')
  assert.equal(Number(users[0].total), 5)
})
