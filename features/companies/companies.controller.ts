import type { Request, Response } from 'express'
import { HttpError } from '../../shared/errors/HttpError'
import {
  companiesForUser,
  companyForUser,
  createCompanyForUser,
} from './companies.service'
import { parseCompanyId, parseCreateCompany } from './companies.validation'

export async function ListCompanies(request: Request, response: Response) {
  if (!request.user) throw new HttpError(401, 'Iniciá sesión para continuar.')
  const companies = await companiesForUser(request.user.id)
  return response.json({ companies })
}

export async function GetCompany(request: Request, response: Response) {
  if (!request.user) throw new HttpError(401, 'Iniciá sesión para continuar.')
  const companyId = parseCompanyId(request.params.companyId)
  const company = await companyForUser(request.user.id, companyId)
  return response.json({ company })
}

export async function CreateCompany(request: Request, response: Response) {
  if (!request.user) throw new HttpError(401, 'Iniciá sesión para continuar.')
  const input = parseCreateCompany(request.body)
  const company = await createCompanyForUser(request.user.id, input)
  return response.status(201).json({ company })
}
