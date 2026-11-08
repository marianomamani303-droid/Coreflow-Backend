import { pool } from '../../config/database'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { InvitationRow } from './invitations.types'
import type { parseInvitationQuery } from './invitations.validation'

type Reader = Pick<PoolConnection, 'execute'>

export async function guardar_invitacion(
  companyId: string,
  email: string,
  role: 'admin' | 'employee',
  department: string | null,
  jobTitle: string | null,
  tokenHash: Buffer,
  invitedBy: string,
  expiresAt: Date,
  connection: Reader = pool,
): Promise<ResultSetHeader> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO company_invitations (company_id, email, role, department,
      job_title, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, email, role, department, jobTitle, tokenHash, invitedBy, expiresAt],
  )
  return result
}

export async function lockCompany(connection: Reader, companyId: string) {
  const [rows] = await connection.execute<
    (RowDataPacket & { name: string; status: string })[]
  >('SELECT name, status FROM companies WHERE id = ? FOR UPDATE', [companyId])
  return rows[0]
}

export async function findInvitation(
  id: string,
  companyId: string,
  connection: Reader = pool,
  lock = false,
) {
  const [rows] = await connection.execute<InvitationRow[]>(
    `SELECT * FROM company_invitations WHERE company_id = ? AND id = ?${lock ? ' FOR UPDATE' : ''}`,
    [companyId, id],
  )
  return rows[0]
}

export async function findByToken(hash: Buffer) {
  const [rows] = await pool.execute<InvitationRow[]>(
    'SELECT * FROM company_invitations WHERE token_hash = ? LIMIT 1',
    [hash],
  )
  return rows[0]
}

export async function expirePending(connection: Reader, companyId: string) {
  await connection.execute(
    `UPDATE company_invitations SET status = 'expired'
     WHERE company_id = ? AND status = 'pending' AND expires_at <= UTC_TIMESTAMP(6)`,
    [companyId],
  )
}

export async function findPending(connection: Reader, companyId: string, email: string) {
  const [rows] = await connection.execute<InvitationRow[]>(
    'SELECT * FROM company_invitations WHERE company_id = ? AND pending_email = ? FOR UPDATE',
    [companyId, email],
  )
  return rows[0]
}

export async function listInvitations(
  companyId: string,
  filters: ReturnType<typeof parseInvitationQuery>,
  connection: Pick<PoolConnection, 'execute' | 'query'> = pool,
) {
  const status =
    "CASE WHEN status = 'pending' AND expires_at <= UTC_TIMESTAMP(6) THEN 'expired' ELSE status END"
  const where = `company_id = ? AND (? IS NULL OR (${status}) = ?) AND (? = '' OR LOCATE(?, email) > 0)`
  const params = [companyId, filters.status, filters.status, filters.query, filters.query]
  const [count] = await connection.execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM company_invitations WHERE ${where}`,
    params,
  )
  const [rows] = await connection.query<InvitationRow[]>(
    `SELECT * FROM company_invitations WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 30 OFFSET ?`,
    [...params, (filters.page - 1) * 30],
  )
  return { rows, total: Number(count[0]!.total), page: filters.page, pageSize: 30 }
}

export async function reserveDelivery(
  connection: Reader,
  id: string,
  companyId: string,
  lockId: string,
  tokenHash: Buffer,
  expiresAt: Date,
) {
  await connection.execute(
    `UPDATE company_invitations SET token_hash = ?, expires_at = ?,
      delivery_lock_id = ?, delivery_locked_until = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 2 MINUTE)
     WHERE id = ? AND company_id = ?`,
    [tokenHash, expiresAt, lockId, id, companyId],
  )
}

export async function startAttempt(connection: Reader, id: string, lockId: string) {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE company_invitations SET send_attempts = send_attempts + 1,
      last_send_attempt_at = UTC_TIMESTAMP(6), delivery_status = 'not_sent', last_send_error = NULL
     WHERE id = ? AND delivery_lock_id = ? AND delivery_locked_until > UTC_TIMESTAMP(6)
       AND status = 'pending' AND expires_at > UTC_TIMESTAMP(6) AND send_attempts < 5`,
    [id, lockId],
  )
  return result.affectedRows === 1
}

export async function finishDelivery(
  id: string,
  lockId: string,
  errorCode: string | null,
  release: boolean,
) {
  await pool.execute(
    `UPDATE company_invitations SET delivery_status = ?, last_send_error = ?,
      last_sent_at = IF(? IS NULL, UTC_TIMESTAMP(6), last_sent_at),
      delivery_lock_id = IF(?, NULL, delivery_lock_id),
      delivery_locked_until = IF(?, NULL, delivery_locked_until)
     WHERE id = ? AND delivery_lock_id = ?`,
    [errorCode ? 'failed' : 'sent', errorCode, errorCode, release, release, id, lockId],
  )
}

export async function releaseDelivery(id: string, lockId: string) {
  await pool.execute(
    'UPDATE company_invitations SET delivery_lock_id = NULL, delivery_locked_until = NULL WHERE id = ? AND delivery_lock_id = ?',
    [id, lockId],
  )
}

export async function lockAccount(connection: Reader, id: string) {
  const [rows] = await connection.execute<
    (RowDataPacket & {
      id: string
      email: string
      status: string
      email_verified_at: Date | null
    })[]
  >('SELECT id, email, status, email_verified_at FROM users WHERE id = ? FOR UPDATE', [
    id,
  ])
  return rows[0]
}

export async function senderRole(connection: Reader, companyId: string, userId: string) {
  const [rows] = await connection.execute<(RowDataPacket & { role: string })[]>(
    `SELECT m.role FROM company_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.company_id = ? AND m.user_id = ? AND m.status = 'active' AND u.status = 'active'
     FOR UPDATE`,
    [companyId, userId],
  )
  return rows[0]?.role
}

export async function setStatus(
  connection: Reader,
  id: string,
  status: 'revoked' | 'declined',
) {
  await connection.execute(
    `UPDATE company_invitations SET status = ?, delivery_lock_id = NULL,
      delivery_locked_until = NULL WHERE id = ?`,
    [status, id],
  )
}
