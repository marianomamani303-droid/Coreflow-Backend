import { app } from './app'
import { checkDatabaseConnection, closeDatabase } from './config/database'
import { env } from './config/env'

async function startServer(): Promise<void> {
  try {
    await checkDatabaseConnection()

    const server = app.listen(env.port, env.host)

    server.once('listening', () => {
      console.log(`CoreFlow Backend funcionando en http://${env.host}:${env.port}`)
      console.log(
        `Health: http://${env.host}:${env.port}/api/health · Base de datos conectada`,
      )
    })

    server.on('error', async () => {
      console.error('[server] No se pudo abrir el puerto. Revisá HOST y PORT.')
      await closeDatabase()
      process.exitCode = 1
    })

    let shuttingDown = false

    function shutdown(): void {
      if (shuttingDown) return
      shuttingDown = true
      console.log('[server] Cerrando servidor y conexiones SQL...')

      const timeout = setTimeout(() => {
        server.closeAllConnections()
        process.exit(1)
      }, 10000)
      timeout.unref()

      server.close(async () => {
        try {
          await closeDatabase()
          clearTimeout(timeout)
        } catch {
          console.error('[database] No se pudieron cerrar todas las conexiones.')
          process.exitCode = 1
        }
      })
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  } catch (error) {
    // Sólo el código del driver (p. ej. ER_ACCESS_DENIED_ERROR, ENOTFOUND,
    // HANDSHAKE_SSL_ERROR): el mensaje completo puede incluir usuario o host.
    const code =
      typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? ` (${error.code})`
        : ''
    console.error(
      `[server] No se pudo conectar a la base de datos${code}. Revisá la disponibilidad del servidor SQL, TLS y las variables DB_*.`,
    )
    await closeDatabase()
    process.exitCode = 1
  }
}

void startServer()
