import { pool } from '../../config/database'
import { HttpError } from '../../shared/errors/HttpError'
import {
  findUserCompany,
  insertCompany,
  insertMembership,
  listUserCompanies,
} from './companies.repository'
import type { CompanyRow } from './companies.repository'
import type { CreateCompanyInput, UserCompany } from './companies.types'

function publicCompany(row: CompanyRow): UserCompany {
  return {
    id: String(row.id),
    currency: row.currency,
    hasLogo: !!row.has_logo,
    logoVersion: String(row.logo_version),
    name: row.name,
    sector: row.sector,
    role: row.role,
    memberCount: Number(row.member_count),
    createdAt: row.created_at.toISOString(),
  }
}

export async function companiesForUser(userId: string): Promise<UserCompany[]> {
  return (await listUserCompanies(userId)).map(publicCompany)
}

export async function companyForUser(
  userId: string,
  companyId: string,
): Promise<UserCompany> {
  const company = await findUserCompany(userId, companyId)
  // No informa a un extraño si la empresa existe.
  if (!company) throw new HttpError(404, 'Empresa no encontrada o sin acceso.')
  return publicCompany(company)
}

export async function createCompanyForUser(
  userId: string,
  input: CreateCompanyInput,
): Promise<UserCompany> {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const companyId = await insertCompany(connection, input)
    await insertMembership(connection, companyId, userId, 'owner')
    const company = await findUserCompany(userId, companyId, connection)
    if (!company) throw new Error('Created membership could not be read')
    await connection.commit()
    return publicCompany(company)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
