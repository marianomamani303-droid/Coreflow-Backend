import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { pool } from '../../config/database'
import type { CompanyRole, CreateCompanyInput } from './companies.types'

export interface CompanyRow extends RowDataPacket {
  id: string
  currency: string
  has_logo: number
  logo_version: string
  name: string
  sector: string | null
  role: CompanyRole
  member_count: number | string
  created_at: Date
}

const userCompaniesQuery = `
  SELECT c.id, c.name, c.sector, c.currency, c.logo_data IS NOT NULL AS has_logo,
    COALESCE((SELECT s.version FROM company_settings s WHERE s.company_id = c.id), 1) AS logo_version, c.created_at, membership.role,
    (SELECT COUNT(*) FROM company_memberships members
     JOIN users member_user ON member_user.id = members.user_id
     WHERE members.company_id = c.id AND members.status = 'active'
       AND member_user.status = 'active') AS member_count
  FROM companies c
  INNER JOIN company_memberships membership ON membership.company_id = c.id
  WHERE membership.user_id = ? AND membership.status = 'active' AND c.status = 'active'
`

export async function listUserCompanies(userId: string): Promise<CompanyRow[]> {
  const [rows] = await pool.execute<CompanyRow[]>(
    `${userCompaniesQuery} ORDER BY c.created_at DESC, c.id DESC`,
    [userId],
  )
  return rows
}

export async function findUserCompany(
  userId: string,
  companyId: string,
  connection: Pick<PoolConnection, 'execute'> = pool,
): Promise<CompanyRow | undefined> {
  const [rows] = await connection.execute<CompanyRow[]>(
    `${userCompaniesQuery} AND c.id = ? LIMIT 1`,
    [userId, companyId],
  )
  return rows[0]
}

export async function insertCompany(
  connection: PoolConnection,
  input: CreateCompanyInput,
): Promise<string> {
  const [result] = await connection.execute<ResultSetHeader>(
    'INSERT INTO companies (name, sector) VALUES (?, ?)',
    [input.name, input.sector],
  )
  return String(result.insertId)
}

export async function insertMembership(
  connection: PoolConnection,
  companyId: string,
  userId: string,
  role: CompanyRole,
): Promise<void> {
  await connection.execute(
    'INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, ?)',
    [companyId, userId, role],
  )
}
