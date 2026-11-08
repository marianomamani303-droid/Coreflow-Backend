import type { RequestHandler } from 'express'
import { env } from '../config/env'
import { HttpError } from '../shared/errors/HttpError'

// Cabecera no simple + lista de orígenes: las mutaciones no pueden enviarse
// desde un formulario ajeno ni desde un fetch autorizado por un origen ajeno.
export const requireTrustedOrigin: RequestHandler = (request, _response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    next()
    return
  }

  const origin = request.get('Origin')
  if (
    request.get('X-CoreFlow-Request') !== '1' ||
    (origin !== undefined && !env.corsOrigins.includes(origin))
  ) {
    next(new HttpError(403, 'Origen de solicitud no permitido.'))
    return
  }
  next()
}
