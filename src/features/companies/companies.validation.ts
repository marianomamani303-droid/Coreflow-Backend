import { HttpError } from '../../shared/errors/HttpError'
import type { CreateCompanyInput } from './companies.types'

export function parseCompanyId(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^[1-9]\d{0,19}$/.test(input) ||
    BigInt(input) > 18446744073709551615n
  ) {
    throw new HttpError(400, 'El identificador de empresa no es válido.')
  }
  return input
}

export function parseCreateCompany(input: unknown): CreateCompanyInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new HttpError(400, 'Enviá los datos de la empresa como un objeto JSON.')
  }

  const body = input as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (Array.from(name).length < 2 || name.length > 120) {
    throw new HttpError(
      400,
      'El nombre de la empresa debe tener entre 2 y 120 caracteres.',
    )
  }
  if (
    body.sector !== undefined &&
    body.sector !== null &&
    typeof body.sector !== 'string'
  ) {
    throw new HttpError(400, 'El rubro debe ser un texto.')
  }
  const sector = typeof body.sector === 'string' ? body.sector.trim() : null
  if (sector && sector.length > 80)
    throw new HttpError(400, 'El rubro admite hasta 80 caracteres.')
  return { name, sector: sector || null }
}
