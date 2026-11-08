// Prueba manual opcional: PLAYWRIGHT_MODULE permite reutilizar una instalación local.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const mysql = require('mysql2/promise')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

process.env.DB_NAME = `coreflow_products_browser_test_${randomBytes(8).toString('hex')}`
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'
const { app } = require('../dist/app.js')
const { env } = require('../dist/config/env.js')
const { pool, closeDatabase } = require('../dist/config/database.js')

async function main() {
  let created = false
  let server
  let vite
  let browser
  try {
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
    const frontend = resolve(__dirname, '../../mi-proyecto')
    const { createServer } = await import(
      pathToFileURL(resolve(frontend, 'node_modules/vite/dist/node/index.js')).href
    )
    vite = await createServer({
      root: frontend,
      configFile: resolve(frontend, 'vite.config.ts'),
      server: {
        host: '127.0.0.1',
        port: 5175,
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
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    const productRequests = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (/\/api\/.*\/products/.test(request.url()))
        productRequests.push(request.method())
    })
    await page.goto('http://127.0.0.1:5175/registro')
    await page.getByLabel('Nombre completo').fill('Product Browser Owner')
    await page.getByLabel(/^Correo electr/).fill('browser-products@example.com')
    await page.getByLabel(/^Contrase/).fill('Strong-password-2026')
    await page.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click()
    await page.waitForURL('**/app/empresas')
    await page.getByRole('button', { name: 'Nueva empresa', exact: true }).click()
    await page.getByLabel('Nombre de la empresa').fill('Browser Products')
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/companies') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Crear empresa', exact: true }).click()
    const { company } = await (await creation).json()
    await page.waitForURL(`**/app/empresa/${company.id}`)
    await page.getByRole('link', { name: 'Productos', exact: true }).click()
    await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Nombre del producto').fill('  ')
    await dialog.getByLabel('Código SKU').fill('BROWSER-1')
    await dialog.getByLabel('Categoría').fill('Iluminación')
    await dialog.getByLabel('Precio (ARS)').fill('123.45')
    await dialog.getByRole('button', { name: 'Guardar producto', exact: true }).click()
    await dialog.getByText('Completá este campo.', { exact: true }).waitFor()
    assert.equal(
      await dialog.getByLabel('Nombre del producto').getAttribute('aria-invalid'),
      'true',
    )
    assert.equal(
      await dialog
        .getByLabel('Nombre del producto')
        .evaluate((element) => document.activeElement === element),
      true,
    )
    assert.equal(productRequests.filter((method) => method === 'POST').length, 0)
    await dialog.getByLabel('Nombre del producto').fill('Lámpara browser')

    let release
    let started
    const pending = new Promise((resolve) => {
      release = resolve
    })
    const intercepted = new Promise((resolve) => {
      started = resolve
    })
    await page.route('**/api/companies/*/products', async (route) => {
      started()
      await pending
      await route.continue()
    })
    const saving = page
      .waitForResponse(
        (response) =>
          response.url().endsWith('/products') && response.request().method() === 'POST',
      )
      .catch((error) => error)
    await dialog.getByRole('button', { name: 'Guardar producto', exact: true }).click()
    await intercepted
    try {
      assert.equal(
        await dialog
          .getByRole('button', { name: 'Guardando…', exact: true })
          .isDisabled(),
        true,
      )
      assert.equal(
        await dialog
          .getByRole('button', { name: 'Cerrar', exact: true })
          .last()
          .isDisabled(),
        true,
      )
    } finally {
      release()
    }
    assert.equal((await saving).status(), 201)
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Producto guardado correctamente.' })
      .waitFor()
    assert.equal(
      await dialog.getByRole('button', { name: 'Guardar producto', exact: true }).count(),
      0,
    )
    await dialog.getByRole('link', { name: 'Ir a Inventario', exact: true }).waitFor()
    const [rows] = await pool.execute(
      'SELECT company_id, sku, price FROM products WHERE sku = ?',
      ['BROWSER-1'],
    )
    assert.deepEqual(rows, [
      { company_id: company.id, sku: 'BROWSER-1', price: '123.45' },
    ])
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()

    await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click()
    await dialog.getByLabel('Nombre del producto').fill('Duplicate test')
    await dialog.getByLabel('Código SKU').fill('BROWSER-1')
    await dialog.getByLabel('Categoría').fill('Iluminación')
    await dialog.getByLabel('Precio (ARS)').fill('20')
    await dialog.getByRole('button', { name: 'Guardar producto', exact: true }).click()
    await dialog
      .getByRole('alert')
      .filter({ hasText: /Ya existe un producto/ })
      .waitFor()
    assert.equal(await dialog.getByLabel('Código SKU').inputValue(), 'BROWSER-1')
    await dialog.getByLabel('Código SKU').fill('BROWSER-2')
    await dialog.getByRole('button', { name: 'Guardar producto', exact: true }).click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Producto guardado correctamente.' })
      .waitFor()
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
    await pool.execute(
      "UPDATE company_memberships SET role = 'employee' WHERE company_id = ?",
      [company.id],
    )
    await page.reload()
    await page.getByRole('heading', { name: 'Productos', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Nuevo producto', exact: true }).count(),
      0,
    )
    await pool.execute(
      "UPDATE company_memberships SET role = 'admin' WHERE company_id = ?",
      [company.id],
    )
    await page.reload()
    await page.getByRole('button', { name: 'Nuevo producto', exact: true }).waitFor()
    assert.deepEqual(
      productRequests.filter((method) => method === 'POST'),
      ['POST', 'POST', 'POST'],
    )
    assert.deepEqual(errors, [])
    console.log(
      'OK: formulario → API → SQL, validación, envío bloqueado, éxito, duplicados, reintento y roles; listado real habilitado.',
    )
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    if (server) await new Promise((resolve) => server.close(resolve))
    await closeDatabase()
    if (
      created &&
      /^coreflow_products_browser_test_[a-f0-9]{16}$/.test(env.database.name)
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
