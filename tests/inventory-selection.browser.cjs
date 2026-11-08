const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const mysql = require('mysql2/promise')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.DB_NAME = `coreflow_selection_test_${randomBytes(8).toString('hex')}`
process.env.CORS_ORIGINS = 'http://127.0.0.1:5177'
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
        port: 5177,
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
    const root = 'http://127.0.0.1:5177'
    async function post(path, data) {
      const response = await page.request.post(`${root}${path}`, {
        headers: { 'X-CoreFlow-Request': '1' },
        data,
      })
      assert.equal(response.status(), 201, await response.text())
      return response.json()
    }
    await post('/api/auth/register', {
      fullName: 'Selection Test',
      email: 'selection@example.com',
      password: 'Strong-password-2026',
    })
    const { company } = await post('/api/companies', { name: 'Selection company' })
    const api = `/api/companies/${company.id}`
    const first = await post(`${api}/products`, {
      name: 'Producto Alfa',
      sku: 'A',
      category: 'Pruebas',
      price: '1',
    })
    const second = await post(`${api}/products`, {
      name: 'Producto Beta',
      sku: 'B',
      category: 'Pruebas',
      price: '2',
    })
    const central = await post(`${api}/inventory/warehouses`, { name: 'Central' })
    const local = await post(`${api}/inventory/warehouses`, { name: 'Local' })
    await page.goto(`${root}/app/empresa/${company.id}/inventario`)
    await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const product = dialog.getByLabel('Producto', { exact: true })
    const warehouse = dialog.getByLabel('Depósito', { exact: true })
    assert.equal(await product.inputValue(), '')
    assert.equal(await warehouse.inputValue(), '')
    await product.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Tab')
    assert.equal(
      await product.inputValue(),
      first.productId,
      'El producto debe conservar la selección con teclado nativo',
    )
    await warehouse.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Tab')
    assert.equal(
      await warehouse.inputValue(),
      central.warehouseId,
      'El depósito debe conservar la selección con teclado nativo',
    )
    await product.click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    assert.equal(
      await product.inputValue(),
      second.productId,
      'El producto debe conservar la selección desde el desplegable',
    )
    await warehouse.click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    assert.equal(
      await warehouse.inputValue(),
      local.warehouseId,
      'El depósito debe conservar la selección desde el desplegable',
    )
    await dialog.getByLabel('Cantidad de unidades').fill('4')
    await dialog.getByLabel('Motivo').fill('Ingreso con selección manual')
    await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Saldo actual: 4 unidades.' })
      .waitFor()
    const [rows] = await pool.execute(
      'SELECT product_id, warehouse_id, quantity FROM inventory_balances WHERE company_id = ?',
      [company.id],
    )
    assert.deepEqual(rows, [
      { product_id: second.productId, warehouse_id: local.warehouseId, quantity: 4 },
    ])
    console.log(
      'OK: selección manual con teclado y desplegable entre dos productos y dos depósitos; movimiento persistido en la combinación elegida.',
    )
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    if (server) await new Promise((resolve) => server.close(resolve))
    await closeDatabase()
    if (created && /^coreflow_selection_test_[a-f0-9]{16}$/.test(env.database.name)) {
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
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
