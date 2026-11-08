import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { CompanyRole } from '../features/companies/companies.types'
interface AccessRow extends RowDataPacket {
  id: string
  role: CompanyRole
}

export async function lockCompanyForUser(
  connection: PoolConnection,
  userId: string,
  companyId: string,
): Promise<AccessRow | undefined> {
  const [rows] = await connection.execute<AccessRow[]>(
    `SELECT c.id, membership.role FROM companies c
     INNER JOIN company_memberships membership ON membership.company_id = c.id
     WHERE c.id = ? AND membership.user_id = ? AND c.status = 'active' AND membership.status = 'active'
     FOR UPDATE`,
    [companyId, userId],
  )
  return rows[0]
}
