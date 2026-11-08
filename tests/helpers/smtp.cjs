const net = require('node:net')
const { once } = require('node:events')

// Buzon SMTP exclusivamente local: no reenvia ni conecta con servicios externos.
async function startInbox() {
  const messages = []
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(15000, () => socket.destroy())
    socket.setEncoding('utf8')
    let buffer = '',
      data = false
    socket.write('220 coreflow.test ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk
      while (buffer.length) {
        if (data) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end < 0) return
          messages.push(buffer.slice(0, end))
          buffer = buffer.slice(end + 5)
          data = false
          socket.write('250 Message captured locally\r\n')
          continue
        }
        const end = buffer.indexOf('\r\n')
        if (end < 0) return
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (/^EHLO|^HELO/i.test(line))
          socket.write('250-coreflow.test\r\n250-8BITMIME\r\n250 SIZE 1000000\r\n')
        else if (/^DATA$/i.test(line)) {
          data = true
          socket.write('354 End with dot\r\n')
        } else if (/^QUIT$/i.test(line)) {
          socket.end('221 Bye\r\n')
          return
        } else socket.write('250 OK\r\n')
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    messages,
    port: server.address().port,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(resolve)
      }),
  }
}
function messageToken(message) {
  const decoded = message.replace(/=\r?\n/g, '').replace(/=3D/gi, '=')
  return /token=([a-f0-9]{64})/.exec(decoded)?.[1]
}
module.exports = { startInbox, messageToken }
