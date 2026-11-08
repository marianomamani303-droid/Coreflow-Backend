import type { ErrorRequestHandler } from 'express'
import { HttpError } from '../shared/errors/HttpError'

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error)
    return
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({ message: error.message })
    return
  }

  let status = 500

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const candidate = error.status
    if (
      typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate >= 400 &&
      candidate < 500
    ) {
      status = candidate
    }
  }

  if (status === 500) {
    console.error('[http] Error interno al procesar la solicitud.')
  }

  response.status(status).json({
    error: status === 500 ? 'Internal server error' : 'Invalid request',
  })
}
