const { readFile } = require('node:fs/promises')
const { resolve } = require('node:path')
const mysql = require('mysql2/promise')
const { env } = require('../dist/config/env.js')

const expectedTables = [
  'users',
  'companies',
  'company_memberships',
  'company_invitations',
  'categories',
  'products',
  'warehouses',
  'inventory_balances',
  'orders',
  'order_items',
  'order_events',
  'inventory_movements',
  'company_settings',
  'user_preferences',
]

async function checkTiDBCompatibility(connection, verifyOnly) {
  const [[server]] = await connection.query('SELECT VERSION() AS version')
  if (!/tidb/i.test(server.version)) return false

  const [settings] = await connection.query(
    "SHOW GLOBAL VARIABLES LIKE 'tidb_enable_check_constraint'",
  )
  if (settings[0]?.Value !== 'ON') {
    if (verifyOnly) throw new Error('TiDB requiere tidb_enable_check_constraint=ON.')
    // TiDB ignora los CHECK al crear tablas si esta opción está desactivada.
    // No se eliminan ni se recrean tablas para reparar restricciones faltantes.
    await connection.query('SET GLOBAL tidb_enable_check_constraint = ON')
    const [enabled] = await connection.query(
      "SHOW GLOBAL VARIABLES LIKE 'tidb_enable_check_constraint'",
    )
    if (enabled[0]?.Value !== 'ON') throw new Error('No se pudieron habilitar los CHECK de TiDB.')
  }
  const [[foreignKeys]] = await connection.query('SELECT @@foreign_key_checks AS enabled')
  if (Number(foreignKeys.enabled) !== 1) throw new Error('Se requieren claves foráneas activas.')
  console.log('[database] TiDB: CHECK y claves foráneas habilitados.')
  return true
}

async function verifyTiDBConstraints(connection) {
  const schema = await readFile(resolve(__dirname, '../database/schema.sql'), 'utf8')
  const expected = [...schema.matchAll(/\bCONSTRAINT\s+(\w+)\s+(?:CHECK|FOREIGN KEY)\b/g)]
    .map((match) => match[1])
  const [constraints] = await connection.query(
    `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ?
     UNION
     SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TIDB_CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?`,
    [env.database.name, env.database.name],
  )
  const present = new Set(constraints.map((row) => row.CONSTRAINT_NAME))
  const missing = expected.filter((name) => !present.has(name))
  if (missing.length) throw new Error(`Faltan restricciones en TiDB: ${missing.join(', ')}.`)
  console.log(`[database] Verificadas las ${expected.length} restricciones CHECK/FK del esquema en TiDB.`)
}

async function tableConstraints(connection, table, isTiDB) {
  const [constraints] = await connection.query(
    'SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [env.database.name, table],
  )
  // TiDB 8.5 expone los CHECK en otra vista, sin incluirlos en TABLE_CONSTRAINTS.
  if (isTiDB) {
    const [checks] = await connection.query(
      'SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TIDB_CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?',
      [env.database.name, table],
    )
    constraints.push(...checks)
  }
  return new Set(constraints.map((row) => row.CONSTRAINT_NAME))
}

async function verifySchema(connection, isTiDB) {
  const [tables] = await connection.query(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ?',
    [env.database.name, 'BASE TABLE'],
  )
  const names = new Set(tables.map((table) => table.TABLE_NAME))
  const missing = expectedTables.filter((name) => !names.has(name))
  if (missing.length) throw new Error(`Faltan tablas: ${missing.join(', ')}.`)

  const [columns] = await connection.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'full_name'`,
    [env.database.name],
  )
  if (columns.length !== 1) throw new Error('Falta users.full_name.')

  const [orderColumns] = await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders'
       AND COLUMN_NAME IN ('warehouse_id', 'discount_amount', 'request_key', 'request_hash', 'version')`,
    [env.database.name],
  )
  if (orderColumns.length !== 5)
    throw new Error('Falta aplicar la migración 002 de Orders.')

  const orderConstraints = await tableConstraints(connection, 'orders', isTiDB)
  if (['uq_orders_request', 'fk_orders_warehouse', 'chk_orders_discount'].some((name) => !orderConstraints.has(name)))
    throw new Error('Faltan restricciones de integridad de Orders.')

  for (const [table, expected] of [
    [
      'companies',
      [
        'description',
        'contact_email',
        'contact_phone',
        'address',
        'logo_data',
        'logo_mime',
      ],
    ],
    [
      'company_settings',
      [
        'company_id',
        'version',
        'default_minimum',
        'inventory_alerts',
        'order_initial_status',
        'default_warehouse_id',
        'date_format',
      ],
    ],
    [
      'user_preferences',
      ['user_id', 'version', 'density', 'date_format', 'inventory_notifications'],
    ],
  ]) {
    const [columns] = await connection.query(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [env.database.name, table],
    )
    const present = new Set(columns.map((column) => column.COLUMN_NAME))
    if (expected.some((name) => !present.has(name)))
      throw new Error('Falta aplicar la migración 003 de Settings.')
  }

  const [invitationColumns] = await connection.query(
    `SELECT COLUMN_NAME, GENERATION_EXPRESSION FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'company_invitations'`,
    [env.database.name],
  )
  const invitationFields = new Map(
    invitationColumns.map((column) => [column.COLUMN_NAME, column]),
  )
  if (
    [
      'department',
      'job_title',
      'updated_at',
      'delivery_status',
      'send_attempts',
      'last_send_attempt_at',
      'last_sent_at',
      'last_send_error',
      'pending_email',
      'delivery_lock_id',
      'delivery_locked_until',
    ].some((name) => !invitationFields.has(name)) ||
    !invitationFields.get('pending_email')?.GENERATION_EXPRESSION
  ) {
    throw new Error('Falta aplicar la migracion 004 de Invitaciones.')
  }
  const invitationConstraints = [
    'uq_invitations_token',
    'uq_invitations_pending',
    'fk_invitations_company',
    'fk_invitations_sender',
    'fk_invitations_recipient',
    'chk_invitations_expiry',
    'chk_invitations_acceptance',
    'chk_invitations_accepted_by',
    'chk_invitations_email',
    'chk_invitations_delivery',
    'chk_invitations_delivery_lock',
  ]
  const presentConstraints = await tableConstraints(connection, 'company_invitations', isTiDB)
  if (invitationConstraints.some((name) => !presentConstraints.has(name))) {
    throw new Error('Faltan restricciones de integridad de Invitaciones.')
  }
  const [invitationIndexes] = await connection.query(
    `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'company_invitations'
       AND INDEX_NAME IN ('uq_invitations_pending', 'idx_invitations_expiry')
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [env.database.name],
  )
  const pendingIndex = invitationIndexes.filter(
    (row) => row.INDEX_NAME === 'uq_invitations_pending',
  )
  const expiryIndex = invitationIndexes.filter(
    (row) => row.INDEX_NAME === 'idx_invitations_expiry',
  )
  if (
    pendingIndex.map((row) => row.COLUMN_NAME).join(',') !== 'company_id,pending_email' ||
    pendingIndex.some((row) => Number(row.NON_UNIQUE) !== 0) ||
    expiryIndex.map((row) => row.COLUMN_NAME).join(',') !== 'status,expires_at'
  ) {
    throw new Error('Faltan indices de unicidad o vencimiento de Invitaciones.')
  }

  const [relations] = await connection.query(
    'SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?',
    [env.database.name],
  )

  console.log(`[database] Verificadas ${expectedTables.length} tablas de CoreFlow.`)
  console.log(
    `[database] users.full_name: ${columns[0].COLUMN_TYPE}; nullable: ${columns[0].IS_NULLABLE}.`,
  )
  console.log(`[database] Claves foráneas presentes: ${relations[0].total}.`)
}

async function main() {
  const verifyOnly = process.argv.includes('--verify')
  const connection = await mysql.createConnection({
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    ssl: env.database.ssl,
    connectTimeout: 15000,
    // Únicamente este comando ejecuta SQL local confiable de inicialización.
    // El pool HTTP mantiene multipleStatements deshabilitado.
    multipleStatements: !verifyOnly,
    charset: 'utf8mb4',
  })

  try {
    const isTiDB = await checkTiDBCompatibility(connection, verifyOnly)
    if (!verifyOnly) {
      await connection.query(
        'CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
        [env.database.name],
      )
    }
    await connection.changeUser({ database: env.database.name })
    await connection.query("SET time_zone = '+00:00'")

    if (!verifyOnly) {
      const migration = await readFile(
        resolve(__dirname, '../database/migrations/001_users_full_name.sql'),
        'utf8',
      )
      await connection.query(migration)

      const schema = await readFile(resolve(__dirname, '../database/schema.sql'), 'utf8')
      // El archivo manual usa coreflow; el comando respeta siempre DB_NAME.
      const tablesSql = schema
        .replace(
          /^CREATE DATABASE IF NOT EXISTS coreflow\s+CHARACTER SET utf8mb4\s+COLLATE utf8mb4_unicode_ci;\s*/m,
          '',
        )
        .replace(/^USE coreflow;\s*/m, '')
      await connection.query(tablesSql)
      const ordersMigration = await readFile(
        resolve(__dirname, '../database/migrations/002_orders.sql'),
        'utf8',
      )
      await connection.query(ordersMigration)
      await connection.query(
        await readFile(
          resolve(__dirname, '../database/migrations/003_settings.sql'),
          'utf8',
        ),
      )
      await connection.query(
        await readFile(
          resolve(__dirname, '../database/migrations/004_invitations.sql'),
          'utf8',
        ),
      )
      await connection.query(
        await readFile(
          resolve(__dirname, '../database/migrations/005_invitation_delivery_lock.sql'),
          'utf8',
        ),
      )
      console.log(
        '[database] Esquema y migración aplicados sin eliminar tablas ni filas.',
      )
    }

    await verifySchema(connection, isTiDB)
    if (isTiDB) await verifyTiDBConstraints(connection)
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  // Los mensajes SQL pueden incluir consultas o datos; se muestra sólo el código.
  const detail =
    typeof error.code === 'string'
      ? error.code
      : 'No se verificaron las tablas o la columna users.full_name.'
  console.error(`[database] Falló la preparación o verificación (${detail}).`)
  process.exitCode = 1
})
