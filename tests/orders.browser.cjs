const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { mkdir } = require('node:fs/promises')
const mysql = require('mysql2/promise')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.DB_NAME = `coreflow_orders_browser_test_${randomBytes(8).toString('hex')}`
process.env.CORS_ORIGINS = 'http://127.0.0.1:5178'
const { app } = require('../dist/app.js')
const { env } = require('../dist/config/env.js')
const { pool, closeDatabase } = require('../dist/config/database.js')

async function main() {
  let created = false,
    server,
    vite,
    browser
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
        port: 5178,
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const origin = 'http://127.0.0.1:5178',
      headers = { 'X-CoreFlow-Request': '1' }
    const register = await page.request.post(`${origin}/api/auth/register`, {
      headers,
      data: {
        fullName: 'Operadora Orders',
        email: 'orders-browser@example.com',
        password: 'Strong-password-2026',
      },
    })
    assert.equal(register.status(), 201)
    const companyResponse = await page.request.post(`${origin}/api/companies`, {
      headers,
      data: { name: 'Pedidos del mostrador' },
    })
    const { company } = await companyResponse.json()
    const api = `${origin}/api/companies/${company.id}`
    const { productId } = await (
      await page.request.post(`${api}/products`, {
        headers,
        data: { name: 'Café especial', sku: 'CAFE', category: 'Almacén', price: '10.55' },
      })
    ).json()
    const { productId: secondId } = await (
      await page.request.post(`${api}/products`, {
        headers,
        data: { name: 'Té verde', sku: 'TE', category: 'Almacén', price: '0.10' },
      })
    ).json()
    const { warehouseId } = await (
      await page.request.post(`${api}/inventory/warehouses`, {
        headers,
        data: { name: 'Mostrador' },
      })
    ).json()
    for (const id of [productId, secondId])
      assert.equal(
        (
          await page.request.post(`${api}/inventory/movements`, {
            headers,
            data: {
              productId: id,
              warehouseId,
              type: 'inbound',
              quantity: 50,
              reason: 'Carga inicial de prueba',
            },
          })
        ).status(),
        201,
      )
    const base = `${origin}/app/empresa/${company.id}`
    await page.goto(base)
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click()
    await page.getByRole('heading', { name: 'Pedidos', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Nuevo pedido', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await page.getByLabel('Buscar productos').fill('cafe')
    await page.getByLabel('Buscar productos').press('Enter')
    await page.getByLabel('Cantidad de Café especial').fill('1.5')
    await page.getByRole('button', { name: 'Registrar pedido', exact: true }).click()
    assert.equal(
      await page.getByLabel('Cantidad de Café especial').getAttribute('aria-invalid'),
      'true',
    )
    assert.equal((await (await page.request.get(`${api}/orders`)).json()).total, 0)
    await page.getByLabel('Cantidad de Café especial').fill('3')
    await page.getByLabel('Buscar productos').fill('TE')
    await page.getByRole('button', { name: 'Agregar Té verde', exact: true }).click()
    await page.getByLabel('Cantidad de Té verde').fill('3')
    await page
      .getByText('Cliente, descuento y observaciones (opcional)', { exact: true })
      .click()
    await page.getByLabel('Nombre del cliente').fill('Cliente del mostrador')
    await page.getByLabel(/^Descuento \(/).fill('0,05')
    await page.getByLabel('Observaciones', { exact: true }).fill('Entregar en bolsa')
    assert.match(await dialog.innerText(), /Total \$\s*31,90/)
    await page.getByRole('button', { name: 'Registrar pedido', exact: true }).click()
    await dialog.getByText('Pedido registrado.', { exact: false }).waitFor()
    const registered = (await (await page.request.get(`${api}/orders`)).json()).orders[0]
    assert.equal(registered.total, '31.90')
    await page.getByRole('button', { name: 'Registrar otro pedido', exact: true }).click()
    await page.getByLabel('Buscar productos').waitFor()
    assert.equal(
      await page
        .getByLabel('Buscar productos')
        .evaluate((input) => document.activeElement === input),
      true,
    )
    assert.equal(await page.getByLabel('Nombre del cliente').inputValue(), '')
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
    await page
      .getByRole('button', { name: `Ver ${registered.orderNumber}`, exact: true })
      .click()
    await dialog.getByRole('button', { name: 'Editar pedido', exact: true }).click()
    await page.getByLabel('Cantidad de Café especial').fill('4')
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await dialog.getByText('Cambios guardados.', { exact: false }).waitFor()
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
    await page
      .getByRole('button', { name: `Ver ${registered.orderNumber}`, exact: true })
      .click()
    await dialog.getByRole('button', { name: 'Preparar', exact: true }).click()
    await dialog.getByText('En preparación', { exact: true }).first().waitFor()
    await dialog.getByRole('button', { name: 'Cancelar pedido', exact: true }).click()
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await dialog.getByText('Cancelado', { exact: true }).first().waitFor()
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
    const [balance] = await pool.execute(
      'SELECT quantity FROM inventory_balances WHERE product_id = ?',
      [productId],
    )
    assert.equal(balance[0].quantity, 50)
    // La base confirma el pedido pero el cliente pierde la respuesta: el reintento
    // después de recargar debe recuperar la misma orden y no reservar dos veces.
    await page.getByRole('button', { name: 'Nuevo pedido', exact: true }).first().click()
    await page.getByRole('button', { name: 'Agregar Café especial', exact: true }).click()
    let intercepted = false
    await page.route('**/api/companies/*/orders', async (route) => {
      if (route.request().method() === 'POST' && !intercepted) {
        intercepted = true
        const result = await route.fetch()
        assert.equal(result.status(), 201)
        await route.abort('failed')
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Registrar pedido', exact: true }).click()
    await page
      .getByRole('button', { name: 'Confirmar envío pendiente', exact: true })
      .waitFor()
    await page.reload()
    await page.getByRole('button', { name: 'Nuevo pedido', exact: true }).first().click()
    await page
      .getByRole('button', { name: 'Confirmar envío pendiente', exact: true })
      .click()
    await dialog.getByText('Pedido registrado.', { exact: false }).waitFor()
    assert.equal((await (await page.request.get(`${api}/orders`)).json()).total, 2)
    await dialog
      .getByRole('button', { name: 'Registrar otro pedido', exact: true })
      .click()
    await page.getByRole('button', { name: 'Agregar Café especial', exact: true }).click()
    // Los errores de campos opcionales abren su sección y mueven el foco.
    await page
      .getByText('Cliente, descuento y observaciones (opcional)', { exact: true })
      .click()
    await page.getByLabel(/^Descuento \(/).fill('1000')
    await page
      .getByText('Cliente, descuento y observaciones (opcional)', { exact: true })
      .click()
    await page.getByRole('button', { name: 'Registrar pedido', exact: true }).click()
    assert.equal(
      await page.getByLabel(/^Descuento \(/).getAttribute('aria-invalid'),
      'true',
    )
    assert.equal(await page.getByLabel(/^Descuento \(/).isVisible(), true)
    await page.getByLabel(/^Descuento \(/).fill('0')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Seguir editando', exact: true }).click()
    const screenshots = resolve(__dirname, '../logs/orders')
    await mkdir(screenshots, { recursive: true })
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
        `Página desborda a ${width}px`,
      )
      assert.equal(
        await dialog.evaluate((element) => element.scrollWidth > element.clientWidth),
        false,
        `Modal desborda a ${width}px`,
      )
      await page.screenshot({
        path: resolve(screenshots, `composer-${width}.png`),
        fullPage: true,
      })
    }
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Descartar cambios', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page
      .getByPlaceholder('Buscar pedido, cliente, producto o responsable…')
      .fill('Cliente del mostrador')
    await page
      .getByRole('button', { name: `Ver ${registered.orderNumber}`, exact: true })
      .waitFor()
    await page.screenshot({
      path: resolve(screenshots, 'orders-desktop.png'),
      fullPage: true,
    })
    assert.deepEqual(errors, [])
    console.log(
      'Orders browser OK: crear, editar, cancelar, teclado, foco, recuperación de envío, stock y responsive 320–1440px.',
    )
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    if (server) await new Promise((resolve) => server.close(resolve))
    await closeDatabase()
    if (
      created &&
      /^coreflow_orders_browser_test_[a-f0-9]{16}$/.test(env.database.name)
    ) {
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
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
