import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { pool } from '../../config/database'
import type { AddMemberInput, UpdateMemberInput } from './employee.types'
import type { CompanyRole } from '../companies/companies.types'

interface AccountRow extends RowDataPacket {
  id: string
  status: 'active' | 'disabled'
}
interface MembershipRow extends RowDataPacket {
  role: CompanyRole
  status: 'active' | 'suspended'
}
interface MemberRow extends RowDataPacket {
  id: string
  status: 'active' | 'suspended'
  name: string
  email: string
  accountStatus: AccountRow['status']
  role: CompanyRole
  department: string | null
  jobTitle: string | null
  joinedAt: Date
}

export async function listMembers(companyId: string) {
  const [rows] = await pool.execute<MemberRow[]>(
    `SELECT u.id, u.full_name AS name, u.email, u.status AS accountStatus, m.role,
      m.department, m.job_title AS jobTitle, m.status, m.joined_at AS joinedAt
     FROM company_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.company_id = ? ORDER BY FIELD(m.role, 'owner', 'admin', 'employee'), u.full_name`,
    [companyId],
  )
  return rows.map((r) => ({ ...r, id: String(r.id), joinedAt: r.joinedAt.toISOString() }))
}
export async function findAccount(c: PoolConnection, email: string) {
  const [rows] = await c.execute<AccountRow[]>(
    'SELECT id, status FROM users WHERE email = ?',
    [email],
  )
  return rows[0]
}
export async function lockMember(c: PoolConnection, companyId: string, userId: string) {
  const [rows] = await c.execute<MembershipRow[]>(
    'SELECT role, status FROM company_memberships WHERE company_id = ? AND user_id = ? FOR UPDATE',
    [companyId, userId],
  )
  return rows[0]
}
export async function insertMember(
  c: PoolConnection,
  companyId: string,
  userId: string,
  input: AddMemberInput,
) {
  await c.execute(
    'INSERT INTO company_memberships (company_id, user_id, role, department, job_title) VALUES (?, ?, ?, ?, ?)',
    [companyId, userId, input.role, input.department, input.jobTitle],
  )
}
export async function updateMember(
  c: PoolConnection,
  companyId: string,
  userId: string,
  input: UpdateMemberInput,
) {
  await c.execute(
    'UPDATE company_memberships SET role = ?, status = ?, department = ?, job_title = ? WHERE company_id = ? AND user_id = ?',
    [input.role, input.status, input.department, input.jobTitle, companyId, userId],
  )
}
