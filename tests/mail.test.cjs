const assert = require('node:assert/strict')
const { test } = require('node:test')
const { randomBytes } = require('node:crypto')
const { startInbox, messageToken } = require('./helpers/smtp.cjs')
const { createMailService, mailFailure } = require('../dist/shared/mail.js')

test('Nodemailer entrega plantilla de texto y HTML a un buzon SMTP local', async () => {
  const inbox = await startInbox()
  try {
    const mailer = createMailService({
      host: '127.0.0.1',
      port: inbox.port,
      secure: false,
      requireTLS: false,
      user: '',
      password: '',
      from: 'coreflow@example.com',
      publicAppUrl: 'http://127.0.0.1:5173',
    })
    const token = randomBytes(32).toString('hex')
    await mailer.sendInvitation({
      email: 'recipient@example.com',
      companyName: '<script>unsafe</script>',
      role: 'employee',
      department: 'Sales',
      jobTitle: '<b>Advisor</b>',
      token,
      expiresAt: new Date(Date.now() + 48 * 3600000),
    })
    assert.equal(inbox.messages.length, 1)
    assert.ok(messageToken(inbox.messages[0]) === token)
    const body = inbox.messages[0].replace(/=\r?\n/g, '').replace(/=3D/gi, '=')
    assert.match(body, /Content-Type: text\/plain/)
    assert.match(body, /Content-Type: text\/html/)
    assert.match(body, /&lt;script&gt;unsafe&lt;\/script&gt;/)
    assert.match(body, /&lt;b&gt;Advisor&lt;\/b&gt;/)
    assert.match(body, /48 horas/)
  } finally {
    await inbox.close()
  }
})

test('sin configuracion no conecta, y los errores publicos usan codigos conocidos', async () => {
  const mailer = createMailService({
    host: '',
    port: 587,
    secure: false,
    requireTLS: true,
    user: '',
    password: '',
    from: '',
    publicAppUrl: '',
  })
  await assert.rejects(mailer.sendInvitation({}), { code: 'MAIL_NOT_CONFIGURED' })
  assert.deepEqual(mailFailure({ code: 'SECRET_PROVIDER_RESPONSE', command: 'DATA' }), {
    code: 'SMTP_FAILED',
    retryable: false,
  })
  assert.deepEqual(mailFailure({ code: 'ECONNECTION', command: 'CONN' }), {
    code: 'ECONNECTION',
    retryable: true,
  })
  assert.deepEqual(mailFailure({ code: 'ETIMEDOUT', command: 'DATA' }), {
    code: 'ETIMEDOUT',
    retryable: false,
  })
})
