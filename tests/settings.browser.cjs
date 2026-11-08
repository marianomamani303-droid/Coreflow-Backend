const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { mkdir } = require('node:fs/promises')
const mysql = require('mysql2/promise')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.DB_NAME = `coreflow_settings_browser_test_${randomBytes(8).toString('hex')}`
process.env.CORS_ORIGINS = 'http://127.0.0.1:5179'
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
        port: 5179,
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
    const origin = 'http://127.0.0.1:5179',
      headers = { 'X-CoreFlow-Request': '1' }
    const ownerResponse = await page.request.post(`${origin}/api/auth/register`, {
      headers,
      data: {
        fullName: 'Administradora Settings',
        email: 'settings-browser@example.com',
        password: 'Strong-password-2026',
      },
    })
    assert.equal(ownerResponse.status(), 201)
    const { company } = await (
      await page.request.post(`${origin}/api/companies`, {
        headers,
        data: { name: 'Settings inicial' },
      })
    ).json()
    const api = `${origin}/api/companies/${company.id}`,
      base = `${origin}/app/empresa/${company.id}`
    const { warehouseId } = await (
      await page.request.post(`${api}/inventory/warehouses`, {
        headers,
        data: { name: 'Local principal' },
      })
    ).json()
    const { productId } = await (
      await page.request.post(`${api}/products`, {
        headers,
        data: {
          name: 'Producto existente',
          sku: 'ANTERIOR',
          category: 'Catálogo',
          price: '10.55',
        },
      })
    ).json()
    assert.equal(
      (
        await page.request.post(`${api}/inventory/movements`, {
          headers,
          data: {
            productId,
            warehouseId,
            type: 'inbound',
            quantity: 20,
            reason: 'Stock inicial',
          },
        })
      ).status(),
      201,
    )
    const saved = async () =>
      page
        .getByText(
          'Configuración guardada. Los cambios ya están disponibles para la empresa.',
          { exact: true },
        )
        .waitFor()
    await page.goto(`${base}/configuracion`)
    await page
      .getByLabel('Nombre comercial', { exact: false })
      .fill('Mi comercio configurado')
    await page
      .getByLabel('Descripción', { exact: true })
      .fill('Datos comerciales persistidos')
    await page.getByLabel('Correo de contacto').fill('local@example.com')
    await page.getByLabel('Dirección comercial').fill('Calle de prueba 123')
    await page.getByLabel('Zona horaria').fill('UTC')
    await page.getByLabel('Formato de fechas de la empresa').selectOption('iso')
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await saved()
    assert.equal(
      (await (await page.request.get(`${api}/settings`)).json()).settings.general.name,
      'Mi comercio configurado',
    )
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const context = canvas.getContext('2d')
      context.fillStyle = '#375d46'
      context.fillRect(0, 0, 64, 64)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await page.locator('input[type=file]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    })
    await page.getByRole('button', { name: 'Guardar logo', exact: true }).click()
    await page.getByText('Logo guardado.', { exact: true }).waitFor()
    await page.locator('aside img').first().waitFor()
    await page.getByLabel('Moneda del catálogo y de nuevas órdenes').selectOption('USD')
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await page.getByText('Revisá este cambio', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Confirmar cambio', exact: true }).click()
    await saved()
    await page.getByRole('button', { name: 'Inventario', exact: true }).click()
    await page.getByLabel('Umbral predeterminado de stock bajo').fill('7')
    await page.getByLabel('Vista inicial de inventario').selectOption('low')
    await page.getByLabel('Vista inicial del catálogo').selectOption('cards')
    await page
      .getByLabel('Categoría sugerida para nuevos productos')
      .fill('Categoría sugerida')
    await page
      .getByLabel('Ubicar nuevos productos en los depósitos activos', { exact: false })
      .check()
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await saved()
    await page.goto(`${base}/productos`)
    await page.getByRole('button', { name: 'Vista de tarjetas', exact: true }).waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Vista de tarjetas', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    )
    await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click()
    assert.equal(
      await page.getByLabel('Categoría', { exact: false }).last().inputValue(),
      'Categoría sugerida',
    )
    await page.getByLabel('Nombre del producto').fill('Nuevo producto configurado')
    await page.getByLabel('Código SKU', { exact: false }).fill('NUEVO')
    await page.getByLabel('Precio (USD)', { exact: false }).fill('2.50')
    await page.getByRole('button', { name: 'Guardar producto', exact: true }).click()
    await page.getByText('Producto guardado correctamente.', { exact: false }).waitFor()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cerrar', exact: true })
      .last()
      .click()
    await page.goto(`${base}/inventario`)
    await page.getByLabel('Estado del stock').waitFor()
    assert.equal(await page.getByLabel('Estado del stock').inputValue(), 'low')
    await page.getByText('saldos necesitan reposición.', { exact: false }).waitFor()
    const [balance] = await pool.query(
      "SELECT b.quantity, b.minimum_quantity FROM inventory_balances b JOIN products p ON p.id = b.product_id WHERE p.sku = 'NUEVO'",
    )
    assert.equal(balance[0].minimum_quantity, 7)
    assert.equal(balance[0].quantity, 0)
    await page.goto(`${base}/configuracion`)
    await page.getByRole('button', { name: 'Pedidos', exact: true }).click()
    await page.getByLabel('Estado inicial de nuevos pedidos').selectOption('processing')
    await page.getByLabel('Filtro inicial de pedidos').selectOption('processing')
    await page.getByLabel('Después de registrar un pedido').selectOption('new')
    await page.getByLabel('Depósito de salida predeterminado').selectOption(warehouseId)
    await page.getByLabel('Cliente predeterminado').fill('Venta de mostrador')
    await page.getByLabel('Cantidad inicial al agregar un producto').fill('3')
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await saved()
    await page.goto(`${base}/pedidos`)
    await page.getByRole('button', { name: 'Nuevo pedido', exact: true }).first().click()
    await page
      .getByRole('button', { name: 'Agregar Producto existente', exact: true })
      .click()
    assert.equal(
      await page.getByLabel('Cantidad de Producto existente').inputValue(),
      '3',
    )
    assert.equal(await page.getByLabel('Depósito de salida').inputValue(), warehouseId)
    await page.getByRole('button', { name: 'Registrar pedido', exact: true }).click()
    // El siguiente formulario se abre con stock actualizado y sin cerrar el modal.
    await page
      .getByText('Agregá productos del catálogo. Con eso ya podés guardar.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await page.getByLabel('Buscar productos').inputValue(), '')
    const orders = (await (await page.request.get(`${api}/orders`)).json()).orders
    assert.equal(orders.length, 1)
    assert.equal(orders[0].status, 'processing')
    assert.equal(orders[0].customerName, 'Venta de mostrador')
    assert.equal(orders[0].currency, 'USD')
    assert.equal(orders[0].itemCount, 3)
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cerrar', exact: true })
      .last()
      .click()
    await page.goto(`${base}/configuracion`)
    await page.getByRole('button', { name: 'Mis preferencias', exact: true }).click()
    await page.getByLabel('Densidad de las tablas').selectOption('compact')
    await page.getByLabel('Formato personal de fechas').selectOption('mdy')
    await page
      .getByLabel('Mostrar avisos de stock bajo para mi cuenta', { exact: false })
      .uncheck()
    await page
      .getByRole('button', { name: 'Guardar mis preferencias', exact: true })
      .click()
    await page.getByText('Tus preferencias se guardaron.', { exact: true }).waitFor()
    assert.equal(await page.locator('html').getAttribute('data-density'), 'compact')
    await page.goto(`${base}/inventario`)
    await page.getByLabel('Estado del stock').waitFor()
    assert.equal(
      await page.getByText('saldos necesitan reposición.', { exact: false }).count(),
      0,
    )
    // Logout/login real: no se apoya en almacenamiento local para persistir preferencias.
    await page.request.post(`${origin}/api/auth/logout`, { headers })
    const login = await page.request.post(`${origin}/api/auth/login`, {
      headers,
      data: { email: 'settings-browser@example.com', password: 'Strong-password-2026' },
    })
    assert.equal(login.status(), 200)
    await page.goto(`${base}/configuracion`)
    await page.getByLabel('Nombre comercial', { exact: false }).waitFor()
    assert.equal(
      await page.getByLabel('Nombre comercial', { exact: false }).inputValue(),
      'Mi comercio configurado',
    )
    assert.equal(await page.locator('html').getAttribute('data-density'), 'compact')
    const shots = resolve(__dirname, '../logs/settings')
    await mkdir(shots, { recursive: true })
    for (const section of ['Empresa', 'Inventario', 'Pedidos', 'Mis preferencias']) {
      await page.getByRole('button', { name: section, exact: true }).click()
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${section} desborda a ${width}px`,
        )
        await page.screenshot({
          path: resolve(shots, `${section.replaceAll(' ', '-')}-${width}.png`),
          fullPage: true,
        })
      }
    }
    // Cuenta sin permisos: puede guardar sus preferencias y consultar configuración.
    const employeeContext = await browser.newContext()
    const memberPage = await employeeContext.newPage()
    const member = await employeeContext.request.post(`${origin}/api/auth/register`, {
      headers,
      data: {
        fullName: 'Empleado Settings',
        email: 'employee-browser@example.com',
        password: 'Strong-password-2026',
      },
    })
    const memberId = (await member.json()).user.id
    await pool.execute(
      "INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'employee')",
      [company.id, memberId],
    )
    await memberPage.goto(`${base}/configuracion`)
    await memberPage.getByLabel('Nombre comercial', { exact: false }).waitFor()
    assert.equal(
      await memberPage.getByLabel('Nombre comercial', { exact: false }).isDisabled(),
      true,
    )
    assert.equal(
      await memberPage
        .getByRole('button', { name: 'Guardar cambios', exact: true })
        .count(),
      0,
    )
    await memberPage
      .getByRole('button', { name: 'Mis preferencias', exact: true })
      .click()
    await memberPage
      .getByRole('button', { name: 'Guardar mis preferencias', exact: true })
      .waitFor()
    await employeeContext.close()
    assert.deepEqual(errors, [])
    console.log(
      'Settings browser OK: perfil, moneda confirmada, logo, vistas y mínimos, pedidos consecutivos, preferencias personales, logout/login, empleado y responsive 320–1440px.',
    )
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0]
    if (page) {
      console.error((await page.locator('main').innerText()).slice(-1800))
      await page.screenshot({
        path: resolve(__dirname, '../logs/settings-failure.png'),
        fullPage: true,
      })
    }
    throw error
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    if (server) await new Promise((resolve) => server.close(resolve))
    await closeDatabase()
    if (
      created &&
      /^coreflow_settings_browser_test_[a-f0-9]{16}$/.test(env.database.name)
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
