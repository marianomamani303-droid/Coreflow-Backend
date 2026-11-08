import mysql from 'mysql2/promise'
import { env } from './env'

export const pool = mysql.createPool({
  host: env.database.host,
  port: env.database.port,
  user: env.database.user,
  password: env.database.password,
  database: env.database.name,
  ssl: env.database.ssl,
  charset: 'utf8mb4',
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 20,
  connectTimeout: 15000,
  enableKeepAlive: true,
  multipleStatements: false,
})

// timezone: 'Z' controla la conversión del driver; esta sentencia configura
// también CURRENT_TIMESTAMP en cada sesión nueva del servidor SQL.
// El evento del pool subyacente entrega la conexión con callbacks antes de usarla.
pool.pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'", (error) => {
    if (error) {
      console.error('[database] No se pudo configurar la sesión SQL en UTC.')
      connection.destroy()
    }
  })
})

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query({ sql: 'SELECT 1', timeout: 5000 })
}

export async function closeDatabase(): Promise<void> {
  await pool.end()
}
