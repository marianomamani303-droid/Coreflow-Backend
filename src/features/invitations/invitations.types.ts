import type { RowDataPacket } from 'mysql2/promise'

export interface InvitationRow extends RowDataPacket {
  id: string
  company_id: string
  email: string
  role: 'admin' | 'employee'
  department: string | null
  job_title: string | null
  token_hash: Buffer
  invited_by: string
  accepted_by: string | null
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
  expires_at: Date
  created_at: Date
  delivery_status: 'not_sent' | 'sent' | 'failed'
  send_attempts: number
  last_send_attempt_at: Date | null
  last_sent_at: Date | null
  last_send_error: string | null
  delivery_lock_id: string | null
  delivery_locked_until: Date | null
}

export function invitationView(row: InvitationRow) {
  const expired = row.status === 'pending' && row.expires_at.getTime() <= Date.now()
  const nextSendAt = row.last_send_attempt_at
    ? new Date(row.last_send_attempt_at.getTime() + 60000).toISOString()
    : null
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    email: row.email,
    role: row.role,
    department: row.department,
    jobTitle: row.job_title,
    status: expired ? ('expired' as const) : row.status,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    deliveryStatus: row.delivery_status,
    sendAttempts: Number(row.send_attempts),
    lastSentAt: row.last_sent_at?.toISOString() ?? null,
    lastSendError: row.last_send_error,
    nextSendAt,
    sending: Boolean(
      row.delivery_locked_until && row.delivery_locked_until.getTime() > Date.now(),
    ),
  }
}
