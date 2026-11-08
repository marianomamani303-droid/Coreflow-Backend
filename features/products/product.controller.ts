import type { Request, Response } from 'express'
import { HttpError } from '../../shared/errors/HttpError'
import { parseCompanyId } from '../companies/companies.validation'
import { createProductForUser, productsForUser } from './product.service'
import { parseCreateProduct } from './product.validation'

export async function CreateProduct(request: Request, response: Response) {
  if (!request.user) throw new HttpError(401, 'Iniciá sesión para continuar.')
  const companyId = parseCompanyId(request.params.companyId)
  const input = parseCreateProduct(request.body)
  const result = await createProductForUser(request.user.id, companyId, input)
  return response.status(201).json(result)
}

export async function enviarProducts(request: Request, response: Response) {
  if (!request.user) {
    throw new HttpError(401, 'Iniciá sesión para continuar.')
  }

  const companyId = parseCompanyId(request.params.companyId)

  const products = await productsForUser(request.user.id, companyId)

  return response.status(200).json(products)
}
