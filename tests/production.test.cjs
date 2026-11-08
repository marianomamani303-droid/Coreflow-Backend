const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const net = require('node:net')
const { resolve } = require('node:path')
const { test } = require('node:test')

test('runtime compilado en producción arranca, valida SQL y emite cookies Secure', async () => {
  // Reservar un puerto local disponible; todos los datos pertenecen al esquema
  // descartable creado por scripts/test.cjs, nunca a la base de negocio.
  const reservation = net.createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const publicOrigin = 'https://coreflow.example.com'
  const child = spawn(
    process.execPath,
    [process.env.TEST_RUNTIME_ENTRY || resolve(__dirname, '../dist/server.js')],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOST: '127.0.0.1',
        PUBLIC_APP_URL: publicOrigin,
        CORS_ORIGINS: publicOrigin,
        TRUST_PROXY: 'loopback',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (data) => {
    output += data.toString()
  })
  child.stderr.resume()
  try {
    for (let i = 0; !output.includes('funcionando') && i < 100; i++) {
      if (child.exitCode !== null) assert.fail('El runtime terminó antes de abrir HTTP.')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.match(output, /funcionando/)
    const base = `http://127.0.0.1:${port}`
    assert.equal((await fetch(`${base}/api/health`)).status, 200)
    const response = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoreFlow-Request': '1',
        Origin: publicOrigin,
      },
      body: JSON.stringify({
        fullName: 'Production Smoke',
        email: 'production-smoke@example.com',
        password: 'strong-password-2026',
      }),
    })
    assert.equal(response.status, 201)
    const cookie = response.headers.get('set-cookie')
    assert.match(cookie, /; Secure/)
    assert.match(cookie, /; HttpOnly/)
    assert.match(cookie, /; SameSite=Lax/)
    assert.equal(response.headers.get('access-control-allow-origin'), publicOrigin)
    const me = await fetch(`${base}/api/auth/me`, {
      headers: { Cookie: cookie.split(';')[0] },
    })
    assert.equal(me.status, 200)
    assert.equal((await me.json()).user.email, 'production-smoke@example.com')
    assert.equal(me.headers.get('cache-control'), 'no-store')
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
  }
})
