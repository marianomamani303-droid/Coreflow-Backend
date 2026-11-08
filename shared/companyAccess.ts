import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../config/database'
import { HttpError } from './errors/HttpError'
import { lockCompanyForUser } from './companyAccess.repository'
import type { CompanyRole } from '../features/companies/companies.types'

// El bloqueo de empresa serializa cambios de permisos y stock en la misma empresa.
// La autorización se vuelve a leer dentro de cada transacción.
export async function companyTransaction<T>(
  userId: string,
  companyId: string,
  work: (connection: PoolConnection, role: CompanyRole) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const company = await lockCompanyForUser(connection, userId, companyId)
    if (!company) throw new HttpError(404, 'Empresa no encontrada o sin acceso.')
    const result = await work(connection, company.role)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export function requireManager(role: CompanyRole) {
  if (role !== 'owner' && role !== 'admin') {
    throw new HttpError(403, 'Tu rol no permite realizar esta operación.')
  }
}
