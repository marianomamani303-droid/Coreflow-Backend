const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { mkdir } = require('node:fs/promises')
const mysql = require('mysql2/promise')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
process.env.DB_NAME = `coreflow_operations_browser_test_${randomBytes(8).toString('hex')}`
process.env.CORS_ORIGINS = 'http://127.0.0.1:5176'
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
    const backend = `http://127.0.0.1:${server.address().port}`
    const frontend = resolve(__dirname, '../../mi-proyecto')
    const { createServer } = await import(
      pathToFileURL(resolve(frontend, 'node_modules/vite/dist/node/index.js')).href
    )
    vite = await createServer({
      root: frontend,
      configFile: resolve(frontend, 'vite.config.ts'),
      server: {
        host: '127.0.0.1',
        port: 5176,
        strictPort: true,
        proxy: { '/api': { target: backend, changeOrigin: false } },
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
    page.on('pageerror', (e) => errors.push(e.message))
    const origin = 'http://127.0.0.1:5176'
    await page.goto(`${origin}/registro`)
    await page.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click()
    assert.equal(
      await page.getByLabel('Nombre completo').getAttribute('aria-invalid'),
      'true',
    )
    assert.equal(
      await page.getByLabel('Correo electrónico').getAttribute('aria-invalid'),
      'true',
    )
    await page.getByLabel('Nombre completo').fill('Valentina CoreFlow')
    await page.getByLabel(/^Correo electr/).fill('owner-browser@example.com')
    await page.getByLabel(/^Contrase/).fill('Strong-password-2026')
    await page.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click()
    await page.waitForURL('**/app/empresas')
    await page.getByRole('button', { name: 'Nueva empresa', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Crear empresa', exact: true })
      .click()
    assert.equal(
      await page.getByLabel('Nombre de la empresa').getAttribute('aria-invalid'),
      'true',
    )
    await page.getByLabel('Nombre de la empresa').fill('Estudio Core')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Seguir editando' }).click()
    assert.equal(
      await page.getByLabel('Nombre de la empresa').inputValue(),
      'Estudio Core',
    )
    const creation = page.waitForResponse(
      (r) => r.url().endsWith('/api/companies') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Crear empresa', exact: true }).click()
    const { company } = await (await creation).json()
    await page.waitForURL(`**/app/empresa/${company.id}`)
    const base = `${origin}/app/empresa/${company.id}`
    await page.getByText('Empresa creada correctamente.', { exact: false }).waitFor()
    await page.getByRole('progressbar').waitFor()
    assert.equal(await page.getByRole('progressbar').getAttribute('value'), '0')
    assert.equal(
      await page.getByRole('link', { name: 'Pedidos', exact: true }).count(),
      1,
    )
    assert.equal(
      await page.getByRole('link', { name: 'Configuración', exact: true }).count(),
      1,
    )
    await mkdir(resolve(__dirname, '../logs/operations'), { recursive: true })
    await page.screenshot({
      path: resolve(__dirname, '../logs/operations/onboarding-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.screenshot({
      path: resolve(__dirname, '../logs/operations/onboarding-mobile.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    const dialog = page.getByRole('dialog')
    async function closeDialog() {
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
      await dialog.waitFor({ state: 'hidden' })
    }
    await page.goto(`${base}/productos`)
    await page.getByText('Tu próximo producto empieza acá').waitFor()
    await page.locator('summary').filter({ hasText: 'Cómo usar Productos' }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('details').getAttribute('open'), '')
    await page.locator('summary').filter({ hasText: 'Cómo usar Productos' }).click()
    await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click()
    await dialog.getByLabel('Nombre del producto').fill('Lámpara Modular / 01')
    await dialog.getByLabel('Código SKU').fill('CORE-001')
    await dialog.getByLabel('Categoría', { exact: true }).fill('Objetos')
    await dialog.getByLabel('Precio (ARS)').fill('12500,55')
    await dialog.getByRole('button', { name: 'Guardar producto', exact: true }).click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Producto guardado correctamente.' })
      .waitFor()
    await closeDialog()
    await page.getByRole('cell', { name: '$ 12.500,55', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Vista de tarjetas' }).click()
    await page
      .getByRole('button', { name: 'Ver Lámpara Modular / 01', exact: true })
      .click()
    await dialog.getByRole('heading', { name: 'Lámpara Modular / 01' }).waitFor()
    await dialog.getByRole('button', { name: 'Cerrar detalle' }).click()
    await page.getByRole('searchbox').fill('lampara')
    await page
      .getByRole('button', { name: 'Ver Lámpara Modular / 01', exact: true })
      .waitFor()
    await page.getByRole('searchbox').fill('inexistente')
    await page.getByText('No encontramos resultados.').waitFor()
    await page
      .getByRole('button', { name: 'Limpiar filtros', exact: true })
      .first()
      .click()
    assert.equal(await page.getByRole('searchbox').inputValue(), '')
    await mkdir(resolve(__dirname, '../logs/operations'), { recursive: true })
    await page.screenshot({
      path: resolve(__dirname, '../logs/operations/products-desktop.png'),
      fullPage: true,
    })

    // Error de lectura visible, sin filas ficticias ni éxito simulado.
    await page.route('**/api/companies/*/products', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Servidor temporalmente no disponible.' }),
          })
        : route.continue(),
    )
    await page.reload()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Servidor temporalmente no disponible.' })
      .waitFor()
    assert.equal(await page.getByRole('cell').count(), 0)
    await page.unroute('**/api/companies/*/products')
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
    await page.getByRole('cell', { name: '$ 12.500,55', exact: true }).waitFor()

    await page.goto(`${base}/inventario`)
    await page.getByRole('button', { name: 'Nuevo depósito' }).click()
    await dialog.getByLabel('Nombre del depósito').fill('Taller central')
    await page.route('**/api/companies/*/inventory', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'No se pudieron refrescar las existencias.' }),
      }),
    )
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Depósito creado correctamente.' })
      .waitFor()
    await closeDialog()
    await page
      .getByRole('alert')
      .filter({ hasText: 'No se pudieron refrescar las existencias.' })
      .waitFor()
    await page.unroute('**/api/companies/*/inventory')
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
    await page.getByRole('button', { name: 'Registrar movimiento' }).click()
    await dialog
      .getByLabel('Producto', { exact: true })
      .selectOption({ label: 'Lámpara Modular / 01 · CORE-001' })
    await dialog
      .getByLabel('Depósito', { exact: true })
      .selectOption({ label: 'Taller central' })
    await dialog.getByLabel('Cantidad de unidades').fill('12')
    await dialog.getByLabel('Motivo').fill('Producción del taller')
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Saldo actual: 12 unidades.' })
      .waitFor()
    await closeDialog()
    await page.getByRole('cell', { name: '12 un.', exact: true }).waitFor()
    await page
      .getByRole('button', { name: 'Configurar mínimo de Lámpara Modular / 01' })
      .click()
    await dialog.getByLabel('Stock mínimo', { exact: true }).fill('15')
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Mínimo actualizado correctamente.' })
      .waitFor()
    await closeDialog()
    await page.getByRole('cell', { name: 'Stock bajo', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Registrar movimiento' }).click()
    await dialog
      .getByLabel('Producto', { exact: true })
      .selectOption({ label: 'Lámpara Modular / 01 · CORE-001' })
    await dialog
      .getByLabel('Depósito', { exact: true })
      .selectOption({ label: 'Taller central' })
    await dialog.getByLabel('Tipo de movimiento').selectOption('outbound')
    await dialog.getByLabel('Cantidad de unidades').fill('13')
    await dialog.getByLabel('Motivo').fill('Salida superior al saldo')
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
    await dialog.getByRole('alert').filter({ hasText: 'Stock insuficiente' }).waitFor()
    await dialog.getByLabel('Tipo de movimiento').selectOption('adjustment')
    await dialog.getByLabel('Cantidad final contada').fill('8')
    await dialog.getByLabel('Motivo').fill('Conteo físico')
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
    await page.screenshot({
      path: resolve(__dirname, '../logs/operations/stock-adjustment-review.png'),
      fullPage: true,
    })
    await dialog.getByRole('button', { name: 'Confirmar ajuste', exact: true }).click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Saldo actual: 8 unidades.' })
      .waitFor()
    await closeDialog()
    await page.getByRole('cell', { name: '8 un.', exact: true }).waitFor()
    await page.screenshot({
      path: resolve(__dirname, '../logs/operations/inventory-desktop.png'),
      fullPage: true,
    })
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar', exact: true }).click()
    assert.equal((await download).suggestedFilename(), `${company.id}-inventario.csv`)
    await page
      .getByRole('button', { name: 'Historial de movimientos', exact: true })
      .click()
    await page.getByRole('cell', { name: '-4', exact: true }).waitFor()
    await page.getByRole('searchbox').fill('Conteo físico')
    await page.getByRole('cell', { name: 'Conteo físico', exact: true }).waitFor()
    assert.equal(await page.locator('tbody tr').count(), 1)
    await page.reload()
    await page.getByRole('cell', { name: '8 un.', exact: true }).waitFor()

    // Cuenta existente real, creada sólo en la base temporal de esta prueba.
    const registration = await fetch(`${backend}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CoreFlow-Request': '1' },
      body: JSON.stringify({
        fullName: 'Mateo Ríos',
        email: 'mateo-browser@example.com',
        password: 'Strong-password-2026',
      }),
    })
    assert.equal(registration.status, 201)
    const recruit = (await registration.json()).user
    await page.goto(`${base}/empleados`)
    await page
      .getByRole('cell', { name: 'Valentina CoreFlow (vos) owner-browser@example.com' })
      .waitFor()
    await page.getByRole('button', { name: 'Incorporar persona', exact: true }).click()
    await dialog.getByLabel('Correo electrónico').fill('noaccount-browser@example.com')
    await dialog.getByRole('button', { name: 'Incorporar persona', exact: true }).click()
    await dialog
      .getByRole('alert')
      .filter({ hasText: 'No encontramos una cuenta activa' })
      .waitFor()
    assert.equal(
      await dialog.getByLabel('Correo electrónico').getAttribute('aria-invalid'),
      'true',
    )
    assert.equal(
      await dialog.getByLabel('Correo electrónico').inputValue(),
      'noaccount-browser@example.com',
    )
    await dialog.getByLabel('Correo electrónico').fill(recruit.email)
    await dialog.getByLabel('Área', { exact: true }).fill('Diseño')
    await dialog.getByLabel('Puesto', { exact: true }).fill('Diseñador de producto')
    await dialog.getByRole('button', { name: 'Incorporar persona', exact: true }).click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Persona incorporada correctamente.' })
      .waitFor()
    await closeDialog()
    await page.getByRole('button', { name: 'Editar membresía de Mateo Ríos' }).click()
    await dialog.getByLabel('Rol', { exact: true }).selectOption('admin')
    await dialog.getByRole('button', { name: 'Guardar membresía' }).click()
    await dialog.getByRole('button', { name: 'Confirmar permisos', exact: true }).click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Membresía actualizada correctamente.' })
      .waitFor()
    await closeDialog()
    await page.getByRole('cell', { name: 'Administrador', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Editar membresía de Mateo Ríos' }).click()
    await dialog.getByLabel('Estado de membresía').selectOption('suspended')
    await dialog.getByRole('button', { name: 'Guardar membresía' }).click()
    const [beforeConfirmation] = await pool.execute(
      'SELECT status FROM company_memberships WHERE company_id = ? AND user_id = ?',
      [company.id, recruit.id],
    )
    assert.equal(beforeConfirmation[0].status, 'active')
    await page.screenshot({
      path: resolve(__dirname, '../logs/operations/membership-review.png'),
      fullPage: true,
    })
    await dialog
      .getByRole('button', { name: 'Confirmar suspensión', exact: true })
      .click()
    await dialog
      .getByRole('status')
      .filter({ hasText: 'Membresía actualizada correctamente.' })
      .waitFor()
    await closeDialog()
    await page.getByRole('cell', { name: 'Suspendida', exact: true }).waitFor()
    await page.getByLabel('Estado de membresía').selectOption('suspended')
    assert.equal(await page.locator('tbody tr').count(), 1)
    await page.getByLabel('Estado de membresía').selectOption('')
    await page.screenshot({
      path: resolve(__dirname, '../logs/operations/employees-desktop.png'),
      fullPage: true,
    })

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const [route, title] of [
        ['productos', 'Productos'],
        ['inventario', 'Inventario'],
        ['empleados', 'Equipo'],
      ]) {
        await page.goto(`${base}/${route}`)
        await page
          .getByRole('heading', { name: new RegExp(`^${title}`), level: 1 })
          .waitFor()
        await page.locator('tbody tr').first().waitFor()
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${route}: overflow at ${width}px`,
        )
        if (width === 390 || width === 768)
          await page.screenshot({
            path: resolve(__dirname, `../logs/operations/${route}-${width}.png`),
            fullPage: true,
          })
      }
    }
    await page.goto(base)
    await page.locator('summary').filter({ hasText: 'Revisar puesta en marcha' }).click()
    await page.getByRole('progressbar').waitFor()
    assert.equal(await page.getByRole('progressbar').getAttribute('value'), '3')
    await page.setViewportSize({ width: 390, height: 1000 })
    const menu = page.getByRole('button', { name: 'Abrir menú', exact: true })
    await menu.click()
    const menuDialog = page.getByRole('dialog', {
      name: 'Menú de la empresa',
      exact: true,
    })
    await menuDialog.waitFor()
    assert.equal((await page.locator('[inert]').count()) > 0, true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(
      await menuDialog.evaluate((element) => element.contains(document.activeElement)),
      true,
    )
    await page.keyboard.press('Escape')
    await menuDialog.waitFor({ state: 'hidden' })
    assert.equal(
      await menu.evaluate((element) => document.activeElement === element),
      true,
    )
    await page.goto(`${base}/pedidos`)
    await page.getByRole('heading', { name: 'Pedidos', exact: true }).waitFor()
    await page
      .getByRole('button', { name: 'Nuevo pedido', exact: true })
      .first()
      .waitFor()
    await page.goto(base)
    await page.locator('summary').filter({ hasText: 'Revisar puesta en marcha' }).click()
    await page.getByRole('progressbar').waitFor()
    await page.goto(`${origin}/app/empresas`)
    await page.getByRole('heading', { name: 'Mis empresas' }).waitFor()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
    await page.goto(`${base}/productos`)
    await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click()
    await dialog.getByRole('button', { name: 'Guardar producto', exact: true }).click()
    assert.equal(
      await dialog.getByLabel('Nombre del producto').getAttribute('aria-invalid'),
      'true',
    )
    assert.ok(
      Number.parseFloat(
        await dialog
          .getByLabel('Nombre del producto')
          .evaluate((element) => getComputedStyle(element).fontSize),
      ) >= 16,
    )
    await dialog.getByLabel('Nombre del producto').fill('Borrador sin guardar')
    await page.screenshot({
      path: resolve(__dirname, '../logs/operations/product-form-mobile.png'),
      fullPage: true,
    })
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
    await dialog.getByText('Tenés cambios sin guardar', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Seguir editando', exact: true }).click()
    assert.equal(
      await dialog.getByLabel('Nombre del producto').inputValue(),
      'Borrador sin guardar',
    )
    await page.keyboard.press('Escape')
    await dialog.getByRole('button', { name: 'Descartar cambios', exact: true }).click()
    await page.goto(`${base}/inventario`)
    await page
      .getByRole('button', { name: 'Mover stock de Lámpara Modular / 01', exact: true })
      .click()
    assert.notEqual(await dialog.getByLabel('Producto', { exact: true }).inputValue(), '')
    assert.notEqual(await dialog.getByLabel('Depósito', { exact: true }).inputValue(), '')
    await closeDialog()
    // El usuario employee no recibe botones de administración.
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.request.post(`${backend}/api/auth/login`, {
      headers: { 'X-CoreFlow-Request': '1' },
      data: { email: recruit.email, password: 'Strong-password-2026' },
    })
    await pool.execute(
      "UPDATE company_memberships SET role = 'employee', status = 'active' WHERE company_id = ? AND user_id = ?",
      [company.id, recruit.id],
    )
    for (const [route, button] of [
      ['productos', 'Nuevo producto'],
      ['inventario', 'Registrar movimiento'],
      ['empleados', 'Incorporar persona'],
    ]) {
      await page.goto(`${base}/${route}`)
      await page.locator('tbody tr').first().waitFor()
      assert.equal(
        await page.getByRole('button', { name: button, exact: true }).count(),
        0,
      )
      await page.getByText('Tenés acceso de consulta.', { exact: false }).waitFor()
    }
    await page.context().clearCookies()
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    await page.waitForURL('**/login')
    await page
      .getByRole('status')
      .filter({ hasText: 'Tu sesión ya no está disponible.' })
      .waitFor()
    await page.getByLabel('Correo electrónico').fill(recruit.email)
    await page.getByLabel('Contraseña', { exact: true }).fill('Strong-password-2026')
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
    await page.waitForURL(`**/app/empresa/${company.id}/empleados`)
    await page.getByText('Tenés acceso de consulta.', { exact: false }).waitFor()
    const publicPage = await browser.newPage({ viewport: { width: 390, height: 1000 } })
    publicPage.on('pageerror', (error) => errors.push(error.message))
    await publicPage.goto(origin)
    await publicPage.getByRole('button', { name: 'Abrir menú', exact: true }).click()
    await publicPage.getByRole('link', { name: 'Cómo funciona', exact: true }).waitFor()
    await publicPage.keyboard.press('Escape')
    assert.equal(
      await publicPage
        .getByRole('button', { name: 'Abrir menú', exact: true })
        .getAttribute('aria-expanded'),
      'false',
    )
    await publicPage.goto(`${origin}/login`)
    await publicPage
      .getByRole('heading', { name: 'Iniciar sesión', exact: true, level: 1 })
      .waitFor()
    await publicPage.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
    assert.equal(
      await publicPage.getByLabel('Correo electrónico').getAttribute('aria-invalid'),
      'true',
    )
    assert.equal(
      await publicPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
    await publicPage.screenshot({
      path: resolve(__dirname, '../logs/operations/login-mobile.png'),
      fullPage: true,
    })
    await publicPage.close()
    assert.deepEqual(errors, [])
    console.log(
      'OK navegador: productos, tarjetas, centavos, errores/reintento, depósitos, stock, ajuste, mínimo, CSV, historial, membresías, roles y responsive 320/390/768/1440px. Capturas en logs/operations.',
    )
  } catch (error) {
    if (browser) {
      const page = browser.contexts()[0]?.pages()[0]
      if (page) {
        await page.screenshot({
          path: resolve(__dirname, '../logs/operations/failure.png'),
          fullPage: true,
        })
        console.error((await page.locator('dialog').allTextContents()).join('\n'))
      }
    }
    throw error
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    if (server) await new Promise((resolve) => server.close(resolve))
    await closeDatabase()
    if (
      created &&
      /^coreflow_operations_browser_test_[a-f0-9]{16}$/.test(env.database.name)
    ) {
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
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
