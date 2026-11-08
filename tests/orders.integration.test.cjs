const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { before, after, test } = require('node:test')
const mysql = require('mysql2/promise')
const { readFile } = require('node:fs/promises')

process.env.DB_NAME = `coreflow_orders_test_${randomBytes(8).toString('hex')}`
const { env } = require('../dist/config/env.js')
const { app } = require('../dist/app.js')
const { pool, closeDatabase } = require('../dist/config/database.js')
let server,
  baseUrl,
  created = false
let owner,
  employee,
  admin,
  outsider,
  companyId,
  otherId,
  productId,
  secondProductId,
  warehouseId,
  otherProductId,
  otherWarehouseId
const base = (company = companyId) => `/api/companies/${company}/orders`
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
async function account(name) {
  const response = await request(
    '/api/auth/register',
    'POST',
    {
      fullName: `${name} Orders`,
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
const input = (changes = {}) => ({
  requestKey: randomUUID(),
  warehouseId,
  items: [{ productId, quantity: 2 }],
  ...changes,
})
async function create(changes = {}, cookie = owner.cookie) {
  const response = await request(base(), 'POST', input(changes), cookie)
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).order
}
async function stock(id = productId, warehouse = warehouseId) {
  const [rows] = await pool.execute(
    'SELECT quantity FROM inventory_balances WHERE company_id = ? AND warehouse_id = ? AND product_id = ?',
    [companyId, warehouse, id],
  )
  return Number(rows[0]?.quantity ?? 0)
}
async function replenish(id = productId, quantity = 100) {
  const response = await request(
    `/api/companies/${companyId}/inventory/movements`,
    'POST',
    {
      productId: id,
      warehouseId,
      type: 'adjustment',
      quantity,
      reason: 'Preparación del escenario de prueba',
    },
  )
  assert.ok([201, 409].includes(response.status))
}
const edit = (order, changes = {}) => ({
  warehouseId: order.warehouseId,
  version: order.version,
  items: order.items.map(({ productId, quantity }) => ({ productId, quantity })),
  customerName: order.customerName,
  customerEmail: order.customerEmail,
  notes: order.notes,
  discount: order.discount,
  ...changes,
})
async function counts() {
  const [rows] = await pool.query(
    'SELECT (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM order_items) AS items, (SELECT COUNT(*) FROM inventory_movements) AS movements, (SELECT COUNT(*) FROM order_events) AS events',
  )
  return rows[0]
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
  owner = await account('owner')
  employee = await account('employee')
  admin = await account('admin')
  outsider = await account('outsider')
  companyId = (
    await (await request('/api/companies', 'POST', { name: 'Órdenes Norte' })).json()
  ).company.id
  otherId = (
    await (await request('/api/companies', 'POST', { name: 'Órdenes Sur' })).json()
  ).company.id
  await pool.execute(
    "INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'employee'), (?, ?, 'admin')",
    [companyId, employee.id, companyId, admin.id],
  )
  for (const company of [companyId, otherId]) {
    const product = await request(`/api/companies/${company}/products`, 'POST', {
      name: 'Café especial',
      sku: 'CAFE',
      category: 'Almacén',
      price: '10.55',
    })
    const warehouse = await request(
      `/api/companies/${company}/inventory/warehouses`,
      'POST',
      { name: 'Local' },
    )
    assert.equal(product.status, 201)
    assert.equal(warehouse.status, 201)
    const p = (await product.json()).productId,
      w = (await warehouse.json()).warehouseId
    if (company === companyId) {
      productId = p
      warehouseId = w
    } else {
      otherProductId = p
      otherWarehouseId = w
    }
  }
  secondProductId = (
    await (
      await request(`/api/companies/${companyId}/products`, 'POST', {
        name: 'Té verde',
        sku: 'TE',
        category: 'Almacén',
        price: '0.10',
      })
    ).json()
  ).productId
  await replenish()
  await replenish(secondProductId)
})
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  await closeDatabase()
  if (created && /^coreflow_orders_test_[a-f0-9]{16}$/.test(env.database.name)) {
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

test('registro mínimo, precios históricos, descuento exacto, responsable y movimientos reales', async () => {
  const before = await stock()
  const order = await create(
    {
      items: [
        { productId, quantity: 3 },
        { productId: secondProductId, quantity: 3 },
      ],
      discount: '0.05',
    },
    employee.cookie,
  )
  assert.equal(order.customerName, 'Consumidor final')
  assert.equal(order.status, 'pending')
  assert.equal(order.subtotal, '31.95')
  assert.equal(order.total, '31.90')
  assert.equal(order.currency, 'ARS')
  assert.equal(order.createdById, employee.id)
  assert.equal(order.createdBy, employee.fullName)
  assert.equal(order.events.length, 1)
  assert.equal(order.version, 1)
  assert.equal(await stock(), before - 3)
  const [movements] = await pool.execute(
    'SELECT order_id, quantity_delta FROM inventory_movements WHERE company_id = ? AND order_id = ?',
    [companyId, order.id],
  )
  assert.equal(movements.length, 2)
  assert.deepEqual(
    movements.map((row) => row.quantity_delta),
    [-3, -3],
  )
  const response = await request(`${base()}/${order.id}`)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual((await response.json()).order, order)
})
test('sesión, origen, empresa y pertenencia se validan para cada endpoint', async () => {
  const order = await create()
  for (const [suffix, method, body] of [
    ['', 'GET'],
    [`/${order.id}`, 'GET'],
    ['', 'POST', input()],
    [`/${order.id}`, 'PUT', edit(order)],
    [`/${order.id}/status`, 'PATCH', { status: 'processing', version: 1 }],
  ]) {
    assert.equal((await request(base() + suffix, method, body, '')).status, 401)
    assert.equal(
      (await request(base() + suffix, method, body, outsider.cookie)).status,
      404,
    )
    assert.equal(
      (await request(base(otherId) + suffix, method, body, employee.cookie)).status,
      404,
    )
    if (method !== 'GET') {
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
            Origin: 'https://foreign.example',
          })
        ).status,
        403,
      )
    }
  }
  assert.equal((await request(`${base(otherId)}/${order.id}`)).status, 404)
  assert.equal(
    (
      await request(
        base(),
        'POST',
        input({ items: [{ productId: otherProductId, quantity: 1 }] }),
      )
    ).status,
    404,
  )
  assert.equal(
    (await request(base(), 'POST', input({ warehouseId: otherWarehouseId }))).status,
    404,
  )
  for (const [table, column, id, inactive] of [
    ['company_memberships', 'user_id', employee.id, 'suspended'],
    ['companies', 'id', companyId, 'archived'],
    ['users', 'id', employee.id, 'disabled'],
  ]) {
    const scope = table === 'company_memberships' ? ' AND company_id = ?' : ''
    const values = table === 'company_memberships' ? [id, companyId] : [id]
    await pool.query(`UPDATE ${table} SET status = ? WHERE ${column} = ?${scope}`, [
      inactive,
      ...values,
    ])
    try {
      assert.equal(
        (await request(base(), 'GET', undefined, employee.cookie)).status,
        table === 'users' ? 401 : 404,
      )
    } finally {
      await pool.query(
        `UPDATE ${table} SET status = 'active' WHERE ${column} = ?${scope}`,
        values,
      )
    }
  }
})
test('validaciones rechazan manipulación de precios, campos ajenos, duplicados y totales inválidos', async () => {
  const before = await counts()
  for (const changes of [
    { items: [] },
    { items: [{ productId, quantity: 0 }] },
    { items: [{ productId, quantity: 1.2 }] },
    { items: [{ productId, quantity: '2' }] },
    { items: [{ productId, quantity: 1000001 }] },
    { items: [{ productId, quantity: 1, unitPrice: '0' }] },
    {
      items: [
        { productId, quantity: 1 },
        { productId, quantity: 1 },
      ],
    },
    { companyId: otherId },
    { createdBy: outsider.id },
    { status: 'completed' },
    { total: '1' },
    { discount: '-1' },
    { discount: '100000' },
    { discount: 1 },
    { discount: '0.001' },
    { customerEmail: 'invalid' },
    { notes: 'x'.repeat(2001) },
    { warehouseId: '0' },
    { requestKey: 'bad' },
  ])
    assert.equal(
      (await request(base(), 'POST', input(changes))).status,
      400,
      JSON.stringify(changes),
    )
  for (const query of [
    'page=0',
    'page[]=1',
    'status=foo',
    'q[]=x',
    'companyId=1',
    'from=2026-02-30',
    'from=2026-10-02&to=2026-10-01',
  ])
    assert.equal((await request(`${base()}?${query}`)).status, 400, query)
  assert.deepEqual(await counts(), before)
})
test('dos envíos iguales y reintentos recuperan una sola orden sin volver a descontar', async () => {
  const payload = input(),
    before = await stock()
  const responses = await Promise.all([
    request(base(), 'POST', payload),
    request(base(), 'POST', payload),
  ])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201])
  const orders = await Promise.all(responses.map((response) => response.json()))
  assert.equal(orders[0].order.id, orders[1].order.id)
  assert.equal(await stock(), before - 2)
  assert.equal(
    (await request(base(), 'POST', { ...payload, customerName: 'Otro' })).status,
    409,
  )
  assert.equal((await request(base(), 'POST', payload, employee.cookie)).status, 409)
  assert.equal((await request(base(), 'POST', payload)).status, 200)
})
test('edición conserva precios históricos, ajusta diferencias y protege contra sobrescritura', async () => {
  const order = await create({}, employee.cookie),
    before = await stock()
  await pool.execute(
    "UPDATE products SET price = '99.99', name = 'Nombre nuevo' WHERE id = ?",
    [productId],
  )
  try {
    const response = await request(
      `${base()}/${order.id}`,
      'PUT',
      edit(order, {
        items: [{ productId, quantity: 4 }],
        customerName: 'Cliente editado',
      }),
      employee.cookie,
    )
    assert.equal(response.status, 200)
    const edited = (await response.json()).order
    assert.equal(edited.total, '42.20')
    assert.equal(edited.items[0].productName, 'Café especial')
    assert.equal(edited.items[0].unitPrice, '10.55')
    assert.equal(edited.version, 2)
    assert.equal(await stock(), before - 2)
    assert.equal((await request(`${base()}/${order.id}`, 'PUT', edit(order))).status, 409)
    assert.equal(
      (
        await request(`${base()}/${order.id}/status`, 'PATCH', {
          status: 'processing',
          version: 1,
        })
      ).status,
      409,
    )
    const other = await create()
    assert.equal(other.items[0].unitPrice, '99.99')
    assert.equal(
      (await request(`${base()}/${other.id}`, 'PUT', edit(other), employee.cookie))
        .status,
      403,
    )
    assert.equal(
      (
        await request(
          `${base()}/${other.id}/status`,
          'PATCH',
          { status: 'cancelled', version: 1 },
          employee.cookie,
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await request(
          `${base()}/${other.id}/status`,
          'PATCH',
          { status: 'processing', version: 1 },
          admin.cookie,
        )
      ).status,
      200,
    )
    const reduced = await request(
      `${base()}/${order.id}`,
      'PUT',
      edit(edited, { items: [{ productId, quantity: 1 }] }),
    )
    assert.equal(reduced.status, 200)
    assert.equal((await reduced.json()).order.total, '10.55')
  } finally {
    await pool.execute(
      "UPDATE products SET price = '10.55', name = 'Café especial' WHERE id = ?",
      [productId],
    )
  }
})
test('cancelación devuelve exactamente las cantidades editadas y nunca devuelve dos veces', async () => {
  const before = await stock(),
    order = await create()
  const editResponse = await request(
    `${base()}/${order.id}`,
    'PUT',
    edit(order, { items: [{ productId, quantity: 5 }] }),
  )
  assert.equal(editResponse.status, 200)
  const edited = (await editResponse.json()).order
  const results = await Promise.all(
    [1, 2].map(() =>
      request(`${base()}/${order.id}/status`, 'PATCH', {
        status: 'cancelled',
        version: edited.version,
      }),
    ),
  )
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409])
  assert.equal(await stock(), before)
  const cancelled = (await (await request(`${base()}/${order.id}`)).json()).order
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.total, '52.75')
  assert.equal(
    (await request(`${base()}/${order.id}`, 'PUT', edit(cancelled))).status,
    409,
  )
  const [net] = await pool.execute(
    'SELECT SUM(quantity_delta) AS delta FROM inventory_movements WHERE order_id = ?',
    [order.id],
  )
  assert.equal(Number(net[0].delta), 0)
})
test('preparar y completar no descuentan de nuevo; no reabre ni cancela órdenes finalizadas', async () => {
  const order = await create(),
    before = await stock()
  const processing = await request(`${base()}/${order.id}/status`, 'PATCH', {
    status: 'processing',
    version: 1,
  })
  assert.equal(processing.status, 200)
  assert.equal(
    (
      await request(`${base()}/${order.id}/status`, 'PATCH', {
        status: 'pending',
        version: 2,
      })
    ).status,
    409,
  )
  const completed = await request(`${base()}/${order.id}/status`, 'PATCH', {
    status: 'completed',
    version: 2,
  })
  assert.equal(completed.status, 200)
  assert.equal(await stock(), before)
  const final = (await completed.json()).order
  assert.equal(final.events.length, 3)
  assert.equal(
    (
      await request(`${base()}/${order.id}/status`, 'PATCH', {
        status: 'cancelled',
        version: 3,
      })
    ).status,
    409,
  )
  assert.equal((await request(`${base()}/${order.id}`, 'PUT', edit(final))).status, 409)
})
test('reservas simultáneas nunca sobrevenden; fallos multilínea revierten todo', async () => {
  await replenish(productId, 5)
  const results = await Promise.all(
    [1, 2].map(() =>
      request(base(), 'POST', input({ items: [{ productId, quantity: 4 }] })),
    ),
  )
  assert.deepEqual(results.map((response) => response.status).sort(), [201, 409])
  assert.equal(await stock(), 1)
  const before = await counts(),
    secondBefore = await stock(secondProductId)
  assert.equal(
    (
      await request(
        base(),
        'POST',
        input({
          items: [
            { productId: secondProductId, quantity: 2 },
            { productId, quantity: 2 },
          ],
        }),
      )
    ).status,
    409,
  )
  assert.deepEqual(await counts(), before)
  assert.equal(await stock(secondProductId), secondBefore)
  assert.equal(await stock(), 1)
  await replenish()
})
test('fallo de historial hace rollback de orden, líneas, saldos y eventos', async () => {
  const before = await counts(),
    balance = await stock()
  await pool.query(
    "CREATE TRIGGER reject_order_event BEFORE INSERT ON order_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Intentional test failure'",
  )
  try {
    const response = await request(base(), 'POST', input())
    assert.equal(response.status, 500)
    assert.doesNotMatch(
      JSON.stringify(await response.json()),
      /Intentional|INSERT|SQLSTATE/,
    )
    assert.deepEqual(await counts(), before)
    assert.equal(await stock(), balance)
  } finally {
    await pool.query('DROP TRIGGER reject_order_event')
  }
})
test('archivados no se venden, pero pueden devolverse al cancelar', async () => {
  const order = await create(),
    before = await stock()
  await pool.execute("UPDATE products SET status = 'archived' WHERE id = ?", [productId])
  try {
    assert.equal((await request(base(), 'POST', input())).status, 409)
    assert.equal(
      (
        await request(
          `${base()}/${order.id}`,
          'PUT',
          edit(order, { items: [{ productId, quantity: 3 }] }),
        )
      ).status,
      409,
    )
    assert.equal(
      (
        await request(`${base()}/${order.id}/status`, 'PATCH', {
          status: 'cancelled',
          version: 1,
        })
      ).status,
      200,
    )
    assert.equal(await stock(), before + 2)
  } finally {
    await pool.execute("UPDATE products SET status = 'active' WHERE id = ?", [productId])
  }
})
test('desbordamiento monetario se rechaza sin tocar stock; importes grandes mantienen centavos', async () => {
  await pool.execute("UPDATE products SET price = '9999999999999.99' WHERE id = ?", [
    secondProductId,
  ])
  try {
    const before = await stock(secondProductId)
    assert.equal(
      (
        await request(
          base(),
          'POST',
          input({ items: [{ productId: secondProductId, quantity: 2 }] }),
        )
      ).status,
      400,
    )
    const order = await create({
      items: [{ productId: secondProductId, quantity: 1 }],
      discount: '0.01',
    })
    assert.equal(order.total, '9999999999999.98')
    assert.equal(await stock(secondProductId), before - 1)
  } finally {
    await pool.execute("UPDATE products SET price = '0.10' WHERE id = ?", [
      secondProductId,
    ])
  }
})
test('búsqueda literal por producto/cliente/responsable, filtros y paginación en servidor', async () => {
  await replenish(productId, 200)
  for (let index = 0; index < 33; index++)
    await create({ customerName: `Paginación ${index}` })
  const first = await (await request(base())).json(),
    second = await (await request(`${base()}?page=2`)).json()
  assert.equal(first.orders.length, 30)
  assert.ok(second.orders.length > 0)
  assert.equal(
    new Set([...first.orders, ...second.orders].map((order) => order.id)).size,
    first.orders.length + second.orders.length,
  )
  assert.equal(
    (await (await request(`${base()}?q=${encodeURIComponent('Paginación 32')}`)).json())
      .total,
    1,
  )
  assert.equal(
    (await (await request(`${base()}?q=${encodeURIComponent("' OR 1=1 --")}`)).json())
      .total,
    0,
  )
  assert.ok(
    (await (await request(`${base()}?q=${encodeURIComponent('Café especial')}`)).json())
      .total > 0,
  )
  const cancelled = await (await request(`${base()}?status=cancelled`)).json()
  assert.ok(cancelled.orders.every((order) => order.status === 'cancelled'))
  assert.equal(
    (await (await request(`${base()}?from=2000-01-01&to=2000-01-01`)).json()).total,
    0,
  )
  assert.equal((await (await request(base(otherId))).json()).total, 0)
})
test('migración repetible conserva las filas existentes y verifica columnas e índices', async () => {
  const before = await counts()
  const setup = spawnSync(
    process.execPath,
    [resolve(__dirname, '../scripts/database.cjs')],
    { env: process.env, encoding: 'utf8' },
  )
  assert.equal(setup.status, 0, setup.stderr)
  assert.deepEqual(await counts(), before)
})

test('migración actualiza un esquema anterior con órdenes sin inventar reservas de stock', async () => {
  const name = `coreflow_orders_legacy_test_${randomBytes(8).toString('hex')}`
  const connection = await mysql.createConnection({
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    multipleStatements: true,
  })
  try {
    await connection.query(
      'CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
      [name],
    )
    await connection.changeUser({ database: name })
    const schema = await readFile(resolve(__dirname, '../database/schema.sql'), 'utf8')
    const orders = schema.match(
      /CREATE TABLE IF NOT EXISTS orders \([\s\S]*?\) ENGINE = InnoDB;/,
    )[0]
    const legacy = orders
      .replace(
        /^  (?:discount_amount|warehouse_id|request_key|request_hash|version) .*\r?\n/gm,
        '',
      )
      .replace(/^  UNIQUE KEY uq_orders_request .*\r?\n/gm, '')
      .replace(/^  CONSTRAINT chk_orders_discount .*\r?\n/gm, '')
      .replace(
        /  CONSTRAINT fk_orders_warehouse FOREIGN KEY \(company_id, warehouse_id\)\r?\n    REFERENCES warehouses \(company_id, id\) ON DELETE RESTRICT ON UPDATE RESTRICT,\r?\n/,
        '',
      )
    await connection.query(
      schema
        .replace(orders, legacy)
        .replace(
          /^CREATE DATABASE IF NOT EXISTS coreflow\s+CHARACTER SET utf8mb4\s+COLLATE utf8mb4_unicode_ci;\s*/m,
          '',
        )
        .replace(/^USE coreflow;\s*/m, ''),
    )
    await connection.execute(
      "INSERT INTO users (full_name, email, password_hash) VALUES ('Legacy User', 'legacy@example.com', 'fixture-not-a-password')",
    )
    await connection.execute("INSERT INTO companies (name) VALUES ('Empresa anterior')")
    await connection.execute(
      "INSERT INTO company_memberships (company_id, user_id, role) VALUES (1, 1, 'owner')",
    )
    await connection.execute(
      "INSERT INTO orders (company_id, order_number, customer_name, total_amount, created_by) VALUES (1, 'LEGACY-1', 'Cliente anterior', '20.10', 1)",
    )
    for (let attempt = 0; attempt < 2; attempt++) {
      const setup = spawnSync(
        process.execPath,
        [resolve(__dirname, '../scripts/database.cjs')],
        {
          env: { ...process.env, DB_NAME: name },
          encoding: 'utf8',
        },
      )
      assert.equal(setup.status, 0, setup.stderr)
    }
    const [rows] = await connection.query(
      'SELECT order_number, customer_name, total_amount, discount_amount, warehouse_id, request_key, version FROM orders',
    )
    assert.equal(rows.length, 1)
    assert.deepEqual(
      { ...rows[0] },
      {
        order_number: 'LEGACY-1',
        customer_name: 'Cliente anterior',
        total_amount: '20.10',
        discount_amount: '0.00',
        warehouse_id: null,
        request_key: null,
        version: 1,
      },
    )
    const [movements] = await connection.query(
      'SELECT COUNT(*) AS total FROM inventory_movements',
    )
    assert.equal(Number(movements[0].total), 0)
  } finally {
    if (/^coreflow_orders_legacy_test_[a-f0-9]{16}$/.test(name))
      await connection.query('DROP DATABASE IF EXISTS ??', [name])
    await connection.end()
  }
})

test('agregar y quitar líneas ajusta ambos productos; cancelar respeta el depósito original', async () => {
  await replenish()
  await replenish(secondProductId)
  const coffeeBefore = await stock(),
    teaBefore = await stock(secondProductId)
  const order = await create()
  const response = await request(
    `${base()}/${order.id}`,
    'PUT',
    edit(order, {
      items: [{ productId: secondProductId, quantity: 3 }],
      discount: '0.05',
    }),
  )
  assert.equal(response.status, 200)
  const edited = (await response.json()).order
  assert.equal(edited.total, '0.25')
  assert.equal(edited.items.length, 1)
  assert.equal(await stock(), coffeeBefore)
  assert.equal(await stock(secondProductId), teaBefore - 3)
  assert.equal(
    (
      await request(`${base()}/${order.id}/status`, 'PATCH', {
        status: 'cancelled',
        version: edited.version,
      })
    ).status,
    200,
  )
  assert.equal(await stock(secondProductId), teaBefore)
  const { warehouseId: branch } = await (
    await request(`/api/companies/${companyId}/inventory/warehouses`, 'POST', {
      name: 'Sucursal',
    })
  ).json()
  assert.equal(
    (
      await request(`/api/companies/${companyId}/inventory/movements`, 'POST', {
        productId,
        warehouseId: branch,
        type: 'inbound',
        quantity: 8,
        reason: 'Stock de la sucursal',
      })
    ).status,
    201,
  )
  const branchOrder = await create({ warehouseId: branch })
  assert.equal(await stock(productId, branch), 6)
  assert.equal(await stock(), coffeeBefore)
  assert.equal(
    (
      await request(
        `${base()}/${branchOrder.id}`,
        'PUT',
        edit(branchOrder, { warehouseId }),
      )
    ).status,
    409,
  )
  await pool.execute("UPDATE warehouses SET status = 'archived' WHERE id = ?", [branch])
  assert.equal(
    (
      await request(`${base()}/${branchOrder.id}/status`, 'PATCH', {
        status: 'cancelled',
        version: 1,
      })
    ).status,
    200,
  )
  assert.equal(await stock(productId, branch), 8)
  assert.equal(await stock(), coffeeBefore)
})

test('un fallo al editar o cancelar revierte líneas, total, estado y devoluciones', async () => {
  const order = await create(),
    balance = await stock(),
    before = await counts()
  await pool.query(
    "CREATE TRIGGER reject_order_update BEFORE INSERT ON order_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Intentional test failure'",
  )
  try {
    assert.equal(
      (
        await request(
          `${base()}/${order.id}`,
          'PUT',
          edit(order, { items: [{ productId, quantity: 4 }] }),
        )
      ).status,
      500,
    )
    assert.equal(await stock(), balance)
    assert.deepEqual(await counts(), before)
    assert.deepEqual((await (await request(`${base()}/${order.id}`)).json()).order, order)
    assert.equal(
      (
        await request(`${base()}/${order.id}/status`, 'PATCH', {
          status: 'cancelled',
          version: 1,
        })
      ).status,
      500,
    )
    assert.equal(await stock(), balance)
    assert.deepEqual(await counts(), before)
    assert.deepEqual((await (await request(`${base()}/${order.id}`)).json()).order, order)
  } finally {
    await pool.query('DROP TRIGGER reject_order_update')
  }
})
