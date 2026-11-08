const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const { resolve } = require('node:path')
const { after, before, test } = require('node:test')
const mysql = require('mysql2/promise')
const { env } = require('../dist/config/env.js')

const config = {
  host: env.database.host,
  port: env.database.port,
  user: env.database.user,
  password: env.database.password,
  connectTimeout: 5000,
  multipleStatements: true,
  timezone: 'Z',
  charset: 'utf8mb4',
}
let admin, schema, migration

// Estructura previa a 004, independiente del esquema nuevo.
const legacyInvitations = `CREATE TABLE company_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(254) NOT NULL,
  role ENUM('admin', 'employee') NOT NULL DEFAULT 'employee',
  token_hash BINARY(32) NOT NULL,
  invited_by BIGINT UNSIGNED NOT NULL,
  accepted_by BIGINT UNSIGNED NULL,
  status ENUM('pending', 'accepted', 'declined', 'revoked', 'expired') NOT NULL DEFAULT 'pending',
  expires_at DATETIME(6) NOT NULL,
  accepted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_invitations_token (token_hash),
  KEY idx_invitations_company (company_id, status, email),
  KEY idx_invitations_recipient (email, status, expires_at),
  CONSTRAINT fk_invitations_company FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT fk_invitations_sender FOREIGN KEY (company_id, invited_by)
    REFERENCES company_memberships (company_id, user_id),
  CONSTRAINT fk_invitations_recipient FOREIGN KEY (accepted_by) REFERENCES users (id),
  CONSTRAINT chk_invitations_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_invitations_acceptance CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL)
    OR (status <> 'accepted' AND accepted_at IS NULL)
  )
) ENGINE = InnoDB;`

before(async () => {
  admin = await mysql.createConnection(config)
  schema = (await readFile(resolve(__dirname, '../database/schema.sql'), 'utf8'))
    .replace(
      /^CREATE DATABASE IF NOT EXISTS coreflow\s+CHARACTER SET utf8mb4\s+COLLATE utf8mb4_unicode_ci;\s*/m,
      '',
    )
    .replace(/^USE coreflow;\s*/m, '')
  migration = await readFile(
    resolve(__dirname, '../database/migrations/004_invitations.sql'),
    'utf8',
  )
})
after(async () => {
  if (admin) await admin.end()
})

async function withDatabase(work, legacy = false) {
  const name = `coreflow_invitations_test_${randomBytes(8).toString('hex')}`
  let connection
  await admin.query(
    'CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    [name],
  )
  try {
    connection = await mysql.createConnection({ ...config, database: name })
    await connection.query(
      legacy
        ? schema.replace(
            /CREATE TABLE IF NOT EXISTS company_invitations \([\s\S]*?\) ENGINE = InnoDB;/,
            legacyInvitations,
          )
        : schema,
    )
    await connection.query(`
      INSERT INTO users (full_name, email, password_hash) VALUES
        ('Owner Test', 'owner@example.com', 'fixture-not-a-password'),
        ('Recipient Test', 'recipient@example.com', 'fixture-not-a-password');
      INSERT INTO companies (name) VALUES ('Invitations One'), ('Invitations Two');
      INSERT INTO company_memberships (company_id, user_id, role) VALUES
        (1, 1, 'owner'), (2, 1, 'owner');
    `)
    await work(connection, name)
  } finally {
    if (connection) await connection.end()
    if (/^coreflow_invitations_test_[a-f0-9]{16}$/.test(name)) {
      await admin.query('DROP DATABASE IF EXISTS ??', [name])
    }
  }
}

async function invite(connection, overrides = {}) {
  const values = {
    company_id: 1,
    email: 'recipient@example.com',
    invited_by: 1,
    token_hash: randomBytes(32),
    expires_at: new Date(Date.now() + 7 * 86400000),
    ...overrides,
  }
  const columns = Object.keys(values)
    .map((name) => mysql.escapeId(name))
    .join(', ')
  const placeholders = Object.keys(values).map(() => '?').join(', ')
  const [result] = await connection.execute(
    `INSERT INTO company_invitations (${columns}) VALUES (${placeholders})`,
    Object.values(values),
  )
  return result.insertId
}

// MariaDB y MySQL usan numeros distintos para violaciones de CHECK.
const constraintError = (error) => [4025, 3819].includes(error.errno)

function verify(name) {
  return spawnSync(
    process.execPath,
    [resolve(__dirname, '../scripts/database.cjs'), '--verify'],
    { env: { ...process.env, DB_NAME: name }, encoding: 'utf8', timeout: 20000 },
  )
}

test('instalacion nueva, valores iniciales y verificacion del esquema', async () => {
  await withDatabase(async (connection, name) => {
    const id = await invite(connection, { department: 'Ventas', job_title: 'Vendedor' })
    const [rows] = await connection.query('SELECT * FROM company_invitations WHERE id = ?', [id])
    assert.equal(rows[0].department, 'Ventas')
    assert.equal(rows[0].job_title, 'Vendedor')
    assert.equal(rows[0].status, 'pending')
    assert.equal(rows[0].pending_email, 'recipient@example.com')
    assert.equal(rows[0].delivery_status, 'not_sent')
    assert.equal(rows[0].send_attempts, 0)
    assert.equal(rows[0].last_sent_at, null)
    assert.equal(rows[0].last_send_attempt_at, null)
    assert.equal(rows[0].last_send_error, null)
    assert.ok(rows[0].updated_at)
    const [members] = await connection.query('SELECT * FROM company_memberships WHERE user_id = 2')
    assert.equal(members.length, 0)
    const result = verify(name)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('unicidad por empresa y correo normalizado; conserva historiales', async () => {
  await withDatabase(async (connection) => {
    await invite(connection)
    await assert.rejects(invite(connection, { email: ' RECIPIENT@EXAMPLE.COM ' }), { code: 'ER_DUP_ENTRY' })
    await invite(connection, { company_id: 2 })
    for (const status of ['declined', 'revoked', 'expired', 'accepted']) {
      await invite(connection, {
        status,
        ...(status === 'accepted' ? { accepted_by: 2, accepted_at: new Date() } : {}),
      })
    }
    await connection.query("UPDATE company_invitations SET status = 'expired' WHERE company_id = 1 AND status = 'pending'")
    await invite(connection)
    const [rows] = await connection.query("SELECT COUNT(*) AS total FROM company_invitations WHERE company_id = 1 AND status = 'pending'")
    assert.equal(Number(rows[0].total), 1)
  })
})

test('dos creaciones simultaneas dejan una sola invitacion pendiente', async () => {
  await withDatabase(async (connection, name) => {
    const second = await mysql.createConnection({ ...config, database: name })
    try {
      const results = await Promise.allSettled([invite(connection), invite(second)])
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
      assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'ER_DUP_ENTRY')
    } finally {
      await second.end()
    }
  })
})

test('integridad de aceptacion, remitente, token y vencimiento', async () => {
  await withDatabase(async (connection) => {
    await assert.rejects(invite(connection, { invited_by: 2 }), { code: 'ER_NO_REFERENCED_ROW_2' })
    await assert.rejects(invite(connection, { status: 'accepted', accepted_at: new Date() }), constraintError)
    await assert.rejects(invite(connection, { accepted_by: 2 }), constraintError)
    await assert.rejects(invite(connection, { status: 'accepted', accepted_by: 2 }), constraintError)
    await assert.rejects(invite(connection, { expires_at: new Date('2000-01-01') }), constraintError)
    await assert.rejects(invite(connection, { email: ' ' }), constraintError)
    const token = randomBytes(32)
    await invite(connection, { token_hash: token })
    await assert.rejects(invite(connection, { email: 'other@example.com', token_hash: token }), { code: 'ER_DUP_ENTRY' })
    await connection.query("UPDATE company_invitations SET status = 'accepted', accepted_by = 2, accepted_at = UTC_TIMESTAMP(6)")
  })
})

test('seguimiento de fallo y reenvio sin mezclar entrega y aceptacion', async () => {
  await withDatabase(async (connection) => {
    const id = await invite(connection)
    await assert.rejects(connection.execute("UPDATE company_invitations SET delivery_status = 'sent' WHERE id = ?", [id]), constraintError)
    await assert.rejects(connection.execute("UPDATE company_invitations SET delivery_status = 'failed' WHERE id = ?", [id]), constraintError)
    await connection.execute(`UPDATE company_invitations SET delivery_status = 'failed',
      send_attempts = send_attempts + 1, last_send_attempt_at = UTC_TIMESTAMP(6),
      last_send_error = 'SMTP_TIMEOUT' WHERE id = ?`, [id])
    await connection.execute(`UPDATE company_invitations SET delivery_status = 'sent',
      send_attempts = send_attempts + 1, last_send_attempt_at = UTC_TIMESTAMP(6),
      last_sent_at = UTC_TIMESTAMP(6), last_send_error = NULL WHERE id = ?`, [id])
    const [rows] = await connection.query('SELECT * FROM company_invitations WHERE id = ?', [id])
    assert.equal(rows[0].send_attempts, 2)
    assert.equal(rows[0].delivery_status, 'sent')
    assert.equal(rows[0].status, 'pending')
    assert.equal(rows[0].last_send_error, null)
    assert.ok(rows[0].last_sent_at)
  })
})

test('migracion de datos anteriores repetible y sin perdida de filas', async () => {
  await withDatabase(async (connection, name) => {
    await invite(connection)
    await invite(connection, { status: 'accepted', accepted_by: 2, accepted_at: new Date() })
    const historicalFields = 'id, company_id, email, role, token_hash, invited_by, accepted_by, status, expires_at, accepted_at, created_at'
    const [before] = await connection.query(`SELECT ${historicalFields} FROM company_invitations ORDER BY id`)
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, [resolve(__dirname, '../scripts/database.cjs')], {
        env: { ...process.env, DB_NAME: name }, encoding: 'utf8', timeout: 20000,
      })
      assert.equal(result.status, 0, result.stderr)
    }
    const [after] = await connection.query(`SELECT ${historicalFields} FROM company_invitations ORDER BY id`)
    assert.deepEqual(after, before)
    const result = verify(name)
    assert.equal(result.status, 0, result.stderr)
  }, true)
})

test('duplicados anteriores detienen la migracion sin borrarlos; permite reintentar', async () => {
  await withDatabase(async (connection) => {
    await invite(connection)
    const secondId = await invite(connection, { email: ' RECIPIENT@EXAMPLE.COM ' })
    await assert.rejects(connection.query(migration), { code: 'ER_DUP_ENTRY' })
    const [rows] = await connection.query('SELECT COUNT(*) AS total FROM company_invitations')
    assert.equal(Number(rows[0].total), 2)
    // Resolucion explicita del conflicto en esta base temporal.
    await connection.execute("UPDATE company_invitations SET status = 'revoked' WHERE id = ?", [secondId])
    await connection.query(migration)
    await connection.query(migration)
    await assert.rejects(invite(connection), { code: 'ER_DUP_ENTRY' })
  }, true)
})

test('db:verify detecta la falta del indice de vencimientos', async () => {
  await withDatabase(async (connection, name) => {
    await connection.query('ALTER TABLE company_invitations DROP INDEX idx_invitations_expiry')
    assert.equal(verify(name).status, 1)
  })
})
