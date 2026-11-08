import { HttpError } from '../../shared/errors/HttpError'
import { objectBody, text } from '../../shared/validation'
import { parseAddMember } from '../employees/employee.validation'

export const parseInvitation = parseAddMember

export function parseToken(input: unknown): string {
  const body = objectBody(input, ['token'])
  const token = text(body.token, 'Enlace de invitacion', 64, 64)
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(400, 'El enlace de invitacion no es valido.')
  return token
}

export function parseInvitationQuery(query: Record<string, unknown>) {
  const body = objectBody(query, ['page', 'status', 'q'])
  if (
    body.page !== undefined &&
    (typeof body.page !== 'string' || !/^[1-9]\d{0,5}$/.test(body.page))
  ) {
    throw new HttpError(400, 'Pagina no valida.')
  }
  const status = body.status === undefined ? null : text(body.status, 'Estado', 1, 10)
  if (
    status &&
    !['pending', 'accepted', 'declined', 'revoked', 'expired'].includes(status)
  ) {
    throw new HttpError(400, 'Estado de invitacion no valido.')
  }
  return {
    page: Number(body.page ?? 1),
    status,
    query: body.q === undefined ? '' : text(body.q, 'Busqueda', 0, 160),
  }
}
