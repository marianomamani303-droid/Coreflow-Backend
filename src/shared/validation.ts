import { HttpError } from './errors/HttpError'
import { parseCompanyId } from '../features/companies/companies.validation'

export function objectBody(input: unknown, fields: string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new HttpError(400, 'Enviá un objeto JSON válido.')
  }
  const body = input as Record<string, unknown>
  if (Object.keys(body).some((key) => !fields.includes(key))) {
    throw new HttpError(400, 'La solicitud contiene campos no admitidos.')
  }
  return body
}
export const identifier = parseCompanyId
export function text(input: unknown, label: string, min: number, max: number): string {
  if (
    typeof input !== 'string' ||
    Array.from(input.trim()).length < min ||
    input.trim().length > max
  ) {
    throw new HttpError(400, `${label}: ingresá entre ${min} y ${max} caracteres.`)
  }
  return input.trim()
}
export function integer(input: unknown, min = 0, max = 2147483647): number {
  if (
    typeof input !== 'number' ||
    !Number.isSafeInteger(input) ||
    input < min ||
    input > max
  ) {
    throw new HttpError(400, `La cantidad debe ser un entero entre ${min} y ${max}.`)
  }
  return input
}
