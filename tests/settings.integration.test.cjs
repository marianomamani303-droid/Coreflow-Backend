const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { before, after, test } = require('node:test')
const mysql = require('mysql2/promise')
process.env.DB_NAME = `coreflow_settings_test_${randomBytes(8).toString('hex')}`
const { env } = require('../dist/config/env.js')
const { app } = require('../dist/app.js')
const { pool, closeDatabase } = require('../dist/config/database.js')
let server,
  origin,
  created = false,
  owner,
  admin,
  employee,
  outsider
let companyId, otherId, warehouseId, otherWarehouse, productId, historical
const base = (id = companyId) => `/api/companies/${id}`
const path = (id = companyId) => `${base(id)}/settings`
async function request(url, method = 'GET', body, cookie = owner?.cookie, headers = {}) {
  return fetch(origin + url, {
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
      fullName: `${name} Settings`,
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
async function settings(id = companyId) {
  const response = await request(path(id))
  assert.equal(response.status, 200)
  return (await response.json()).settings
}
async function save(section, values, cookie = owner.cookie) {
  const current = await settings()
  const response = await request(
    `${path()}/${section}`,
    'PUT',
    { ...current[section], ...values, version: current.version },
    cookie,
  )
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  return (await response.json()).settings
}
async function product(sku) {
  const response = await request(`${base()}/products`, 'POST', {
    name: `Producto ${sku}`,
    sku,
    category: 'Categoría',
    price: '10.55',
  })
  assert.equal(response.status, 201)
  return (await response.json()).productId
}
const orderInput = () => ({
  requestKey: randomUUID(),
  warehouseId,
  items: [{ productId, quantity: 1 }],
})
async function createOrder(input = orderInput()) {
  const response = await request(`${base()}/orders`, 'POST', input)
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).order
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
  origin = `http://127.0.0.1:${server.address().port}`
  owner = await account('owner')
  admin = await account('admin')
  employee = await account('employee')
  outsider = await account('outsider')
  companyId = (
    await (await request('/api/companies', 'POST', { name: 'Settings Norte' })).json()
  ).company.id
  otherId = (
    await (await request('/api/companies', 'POST', { name: 'Settings Sur' })).json()
  ).company.id
  await pool.execute(
    "INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'admin'), (?, ?, 'employee')",
    [companyId, admin.id, companyId, employee.id],
  )
  warehouseId = (
    await (
      await request(`${base()}/inventory/warehouses`, 'POST', { name: 'Principal' })
    ).json()
  ).warehouseId
  otherWarehouse = (
    await (
      await request(`${base(otherId)}/inventory/warehouses`, 'POST', {
        name: 'Otra empresa',
      })
    ).json()
  ).warehouseId
  productId = await product('ANTERIOR')
  assert.equal(
    (
      await request(`${base()}/inventory/movements`, 'POST', {
        productId,
        warehouseId,
        type: 'inbound',
        quantity: 100,
        reason: 'Existencias iniciales',
      })
    ).status,
    201,
  )
  assert.equal(
    (
      await request(`${base()}/inventory/minimum`, 'PUT', {
        productId,
        warehouseId,
        minimum: 2,
      })
    ).status,
    204,
  )
  historical = await createOrder()
})
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  await closeDatabase()
  if (created && /^coreflow_settings_test_[a-f0-9]{16}$/.test(env.database.name)) {
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

test('valores iniciales conservan comportamiento anterior y lecturas exigen acceso activo', async () => {
  const initial = await settings()
  assert.equal(initial.general.name, 'Settings Norte')
  assert.equal(initial.general.currency, 'ARS')
  assert.equal(initial.inventory.defaultMinimum, 0)
  assert.equal(initial.inventory.alertsEnabled, true)
  assert.equal(initial.orders.initialStatus, 'pending')
  assert.equal(initial.orders.afterSave, 'confirm')
  assert.equal(initial.version, 1)
  for (const suffix of ['', '/logo']) {
    assert.equal((await request(path() + suffix, 'GET', undefined, '')).status, 401)
    assert.equal(
      (await request(path() + suffix, 'GET', undefined, outsider.cookie)).status,
      404,
    )
    assert.equal(
      (await request(path(otherId) + suffix, 'GET', undefined, employee.cookie)).status,
      404,
    )
  }
  const response = await request(path(), 'GET', undefined, employee.cookie)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})
test('sólo administradores/propietarios actualizan empresa; se conserva CSRF en cada mutación', async () => {
  const current = await settings()
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
  const operations = [
    ['/general', 'PUT', { ...current.general, version: 1 }],
    ['/inventory', 'PUT', { ...current.inventory, version: 1 }],
    ['/orders', 'PUT', { ...current.orders, version: 1 }],
    ['/logo', 'PUT', { dataUrl: png, version: 1 }],
    ['/logo', 'DELETE', { version: 1 }],
  ]
  for (const [suffix, method, body] of operations) {
    assert.equal(
      (await request(path() + suffix, method, body, employee.cookie)).status,
      403,
    )
    assert.equal(
      (await request(path() + suffix, method, body, outsider.cookie)).status,
      404,
    )
    assert.equal(
      (
        await request(path() + suffix, method, body, owner.cookie, {
          'X-CoreFlow-Request': '',
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await request(path() + suffix, method, body, owner.cookie, {
          Origin: 'https://foreign.example',
        })
      ).status,
      403,
    )
  }
  const saved = await save(
    'general',
    {
      description: 'Datos reales de contacto',
      contactEmail: 'local@example.com',
      contactPhone: '+54 11 1234',
      address: 'Calle 123',
      timezone: 'America/New_York',
      dateFormat: 'iso',
      name: 'Empresa actualizada',
    },
    admin.cookie,
  )
  assert.equal(saved.general.name, 'Empresa actualizada')
  assert.equal(saved.general.description, 'Datos reales de contacto')
  const listed = (await (await request('/api/companies')).json()).companies.find(
    (company) => company.id === companyId,
  )
  assert.equal(listed.name, saved.general.name)
  assert.equal((await settings(otherId)).general.description, null)
})
test('valida enums, booleanos, límites y campos de suplantación sin escrituras', async () => {
  const current = await settings()
  for (const [section, changes] of [
    ['general', { name: '' }],
    ['general', { name: '😀' }],
    ['general', { currency: 'ZZZ' }],
    ['general', { timezone: 'No/Existe' }],
    ['general', { dateFormat: 'bad' }],
    ['general', { contactEmail: 'invalid' }],
    ['general', { companyId: otherId }],
    ['general', { role: 'owner' }],
    ['general', { logo_data: 'x' }],
    ['inventory', { alertsEnabled: 'false' }],
    ['inventory', { defaultMinimum: -1 }],
    ['inventory', { defaultMinimum: 1.5 }],
    ['inventory', { defaultView: 'inventada' }],
    ['inventory', { defaultCategory: 'x'.repeat(81) }],
    ['orders', { initialStatus: 'completed' }],
    ['orders', { initialStatus: 'cancelled' }],
    ['orders', { defaultQuantity: 0 }],
    ['orders', { defaultQuantity: 1.5 }],
    ['orders', { defaultCustomerName: ' ' }],
    ['orders', { afterSave: 'fake' }],
  ]) {
    assert.equal(
      (
        await request(`${path()}/${section}`, 'PUT', {
          ...current[section],
          ...changes,
          version: current.version,
        })
      ).status,
      400,
      JSON.stringify(changes),
    )
  }
  assert.equal((await settings()).version, current.version)
  assert.equal(
    (
      await request(`${path()}/orders`, 'PUT', {
        ...current.orders,
        defaultWarehouseId: otherWarehouse,
        version: current.version,
      })
    ).status,
    404,
  )
  assert.equal((await settings()).version, current.version)
})
test('mínimo y ubicación automática afectan sólo nuevos saldos/productos, sin modificar stock histórico', async () => {
  await save('inventory', {
    defaultMinimum: 7,
    autoCreateBalances: false,
    defaultCategory: 'Sugerida',
    alertsEnabled: false,
    defaultView: 'low',
    productView: 'cards',
  })
  const id = await product('NUEVO')
  const [empty] = await pool.execute(
    'SELECT * FROM inventory_balances WHERE product_id = ?',
    [id],
  )
  assert.equal(empty.length, 0)
  assert.equal(
    (
      await request(`${base()}/inventory/movements`, 'POST', {
        productId: id,
        warehouseId,
        type: 'inbound',
        quantity: 3,
        reason: 'Recepción nueva',
      })
    ).status,
    201,
  )
  const [newBalance] = await pool.execute(
    'SELECT quantity, minimum_quantity FROM inventory_balances WHERE product_id = ?',
    [id],
  )
  assert.equal(newBalance[0].minimum_quantity, 7)
  assert.equal(newBalance[0].quantity, 3)
  await request(`${base()}/inventory/warehouses`, 'POST', { name: 'Secundario' })
  await save('inventory', { autoCreateBalances: true })
  const located = await product('UBICADO')
  const [balances] = await pool.execute(
    'SELECT quantity, minimum_quantity FROM inventory_balances WHERE product_id = ?',
    [located],
  )
  assert.equal(balances.length, 2)
  assert.ok(
    balances.every((balance) => balance.quantity === 0 && balance.minimum_quantity === 7),
  )
  const [old] = await pool.execute(
    'SELECT quantity, minimum_quantity FROM inventory_balances WHERE product_id = ?',
    [productId],
  )
  assert.equal(old[0].quantity, 99)
  assert.equal(old[0].minimum_quantity, 2)
})
test('estado y cliente predeterminados se aplican en servidor; reintento resiste cambios de preferencias', async () => {
  await save('orders', {
    initialStatus: 'processing',
    defaultCustomerName: 'Cliente del local',
    defaultWarehouseId: warehouseId,
    defaultQuantity: 3,
    afterSave: 'new',
    defaultView: 'processing',
    rememberWarehouse: false,
  })
  const payload = orderInput(),
    order = await createOrder(payload)
  assert.equal(order.status, 'processing')
  assert.equal(order.customerName, 'Cliente del local')
  assert.equal(order.version, 1)
  assert.equal(order.events[0].status, 'processing')
  await save('orders', { initialStatus: 'pending', defaultCustomerName: 'Otro cliente' })
  const repeated = await request(`${base()}/orders`, 'POST', payload)
  assert.equal(repeated.status, 200)
  assert.equal((await repeated.json()).order.id, order.id)
  const [balances] = await pool.execute(
    'SELECT quantity FROM inventory_balances WHERE product_id = ?',
    [productId],
  )
  assert.equal(balances[0].quantity, 98)
})
test('cambio de moneda exige confirmación, conserva órdenes anteriores y evita mezclar monedas', async () => {
  const before = await settings()
  assert.equal(
    (
      await request(`${path()}/general`, 'PUT', {
        ...before.general,
        currency: 'USD',
        version: before.version,
      })
    ).status,
    409,
  )
  assert.equal((await settings()).general.currency, 'ARS')
  assert.equal((await settings()).version, before.version)
  await save('general', { currency: 'USD', confirmCurrencyChange: true })
  const detail = (await (await request(`${base()}/orders/${historical.id}`)).json()).order
  assert.equal(detail.currency, 'ARS')
  assert.equal(detail.total, '10.55')
  assert.equal(detail.items[0].unitPrice, '10.55')
  const current = await createOrder()
  assert.equal(current.currency, 'USD')
  assert.equal(current.total, '10.55')
  const another = await product('OTRA-MONEDA')
  assert.equal(
    (
      await request(`${base()}/orders/${historical.id}`, 'PUT', {
        warehouseId,
        version: historical.version,
        items: [
          { productId, quantity: 1 },
          { productId: another, quantity: 1 },
        ],
      })
    ).status,
    409,
  )
})
test('logo real se guarda, consulta con autorización y elimina; rechaza SVG, URLs y tamaños inválidos', async () => {
  const dataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
  const before = await settings()
  const saved = await request(`${path()}/logo`, 'PUT', {
    dataUrl,
    version: before.version,
  })
  assert.equal(saved.status, 200)
  const state = (await saved.json()).settings
  assert.equal(state.hasLogo, true)
  const response = await request(`${path()}/logo`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /image\/png/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    Buffer.from(dataUrl.split(',')[1], 'base64'),
  )
  for (const invalid of [
    'https://example.com/logo.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,YmFk',
  ])
    assert.equal(
      (
        await request(`${path()}/logo`, 'PUT', {
          dataUrl: invalid,
          version: state.version,
        })
      ).status,
      400,
    )
  const removed = await request(`${path()}/logo`, 'DELETE', { version: state.version })
  assert.equal(removed.status, 200)
  assert.equal((await removed.json()).settings.hasLogo, false)
  assert.equal((await request(`${path()}/logo`)).status, 404)
})
test('preferencias pertenecen a la sesión, persisten tras login y no afectan a otros usuarios', async () => {
  assert.equal((await request('/api/me/preferences', 'GET', undefined, '')).status, 401)
  const defaults = (await (await request('/api/me/preferences')).json()).preferences
  for (const changes of [
    { userId: employee.id },
    { companyId },
    { density: 'fake' },
    { dateFormat: 'locale' },
    { inventoryNotifications: 'false' },
    { version: 0 },
  ])
    assert.equal(
      (await request('/api/me/preferences', 'PUT', { ...defaults, ...changes })).status,
      400,
    )
  const response = await request('/api/me/preferences', 'PUT', {
    ...defaults,
    density: 'compact',
    dateFormat: 'mdy',
    inventoryNotifications: false,
  })
  assert.equal(response.status, 200)
  const saved = (await response.json()).preferences
  assert.equal((await request('/api/me/preferences', 'PUT', defaults)).status, 409)
  const other = (
    await (await request('/api/me/preferences', 'GET', undefined, employee.cookie)).json()
  ).preferences
  assert.equal(other.density, 'comfortable')
  assert.equal(other.inventoryNotifications, true)
  await request('/api/auth/logout', 'POST')
  const login = await request(
    '/api/auth/login',
    'POST',
    { email: owner.email, password: 'Strong-password-2026' },
    '',
  )
  assert.equal(login.status, 200)
  owner.cookie = login.headers.get('set-cookie').split(';')[0]
  assert.deepEqual(
    (await (await request('/api/me/preferences')).json()).preferences,
    saved,
  )
  assert.equal((await settings()).general.name, 'Empresa actualizada')
  assert.equal((await settings()).general.currency, 'USD')
})
test('actualizaciones concurrentes rechazan versiones obsoletas y fallos hacen rollback completo', async () => {
  const previous = await settings()
  const responses = await Promise.all([
    request(`${path()}/inventory`, 'PUT', {
      ...previous.inventory,
      alertsEnabled: true,
      version: previous.version,
    }),
    request(`${path()}/orders`, 'PUT', {
      ...previous.orders,
      afterSave: 'close',
      version: previous.version,
    }),
  ])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
  const before = await settings()
  await pool.query(
    "CREATE TRIGGER reject_settings_update BEFORE UPDATE ON companies FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Intentional settings failure'",
  )
  try {
    const response = await request(`${path()}/general`, 'PUT', {
      ...before.general,
      name: 'No persistir',
      version: before.version,
    })
    assert.equal(response.status, 500)
    assert.doesNotMatch(
      JSON.stringify(await response.json()),
      /Intentional|SQLSTATE|UPDATE/,
    )
    assert.deepEqual(await settings(), before)
  } finally {
    await pool.query('DROP TRIGGER reject_settings_update')
  }
})
test('suspender membresía, archivar empresa y desactivar cuenta revocan acceso vigente', async () => {
  await pool.execute(
    "UPDATE company_memberships SET status = 'suspended' WHERE company_id = ? AND user_id = ?",
    [companyId, admin.id],
  )
  try {
    assert.equal((await request(path(), 'GET', undefined, admin.cookie)).status, 404)
  } finally {
    await pool.execute(
      "UPDATE company_memberships SET status = 'active' WHERE company_id = ? AND user_id = ?",
      [companyId, admin.id],
    )
  }
  await pool.execute("UPDATE companies SET status = 'archived' WHERE id = ?", [companyId])
  try {
    assert.equal((await request(path())).status, 404)
  } finally {
    await pool.execute("UPDATE companies SET status = 'active' WHERE id = ?", [companyId])
  }
  await pool.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [employee.id])
  try {
    assert.equal(
      (await request('/api/me/preferences', 'GET', undefined, employee.cookie)).status,
      401,
    )
  } finally {
    await pool.execute("UPDATE users SET status = 'active' WHERE id = ?", [employee.id])
  }
})
test('migración repetible conserva datos, configuraciones, preferencias y mínimos existentes', async () => {
  const previous = await settings(),
    preferences = (await (await request('/api/me/preferences')).json()).preferences
  const setup = spawnSync(
    process.execPath,
    [resolve(__dirname, '../scripts/database.cjs')],
    { env: process.env, encoding: 'utf8' },
  )
  assert.equal(setup.status, 0, setup.stderr)
  assert.deepEqual(await settings(), previous)
  assert.deepEqual(
    (await (await request('/api/me/preferences')).json()).preferences,
    preferences,
  )
  const [rows] = await pool.execute(
    'SELECT minimum_quantity FROM inventory_balances WHERE product_id = ?',
    [productId],
  )
  assert.equal(rows[0].minimum_quantity, 2)
})
