const { pool, checkDatabaseConnection, closeDatabase } = require('../dist/config/database.js')
const { env } = require('../dist/config/env.js')

async function main() {
  try {
    await checkDatabaseConnection()
    const connection = await pool.getConnection()
    try {
      if (env.database.ssl) {
        const socket = connection.connection.stream
        if (!socket.encrypted || !socket.authorized) throw new Error('TLS no está verificado.')
        console.log(`[database] TLS: ${socket.getProtocol()}; certificado del servidor verificado.`)
      }
    } finally {
      connection.release()
    }
    const [[server]] = await pool.query(
      'SELECT 1 AS ok, DATABASE() AS database_name, VERSION() AS version',
    )
    if (Number(server.ok) !== 1) throw new Error('SELECT 1 no devolvió el resultado esperado.')
    const [[schema]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    )
    console.log(`[database] SELECT 1 = ${server.ok}; base: ${server.database_name}; servidor: ${server.version}.`)
    console.log(`[database] Consulta preparada desde el pool: ${schema.total} tablas.`)
  } finally {
    await closeDatabase()
  }
}

main().catch((error) => {
  console.error(`[database] No se pudo verificar la conexión (${error.code || 'CHECK_FAILED'}).`)
  process.exitCode = 1
})
