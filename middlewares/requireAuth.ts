import type { RequestHandler } from 'express'
import { accessCookieName, clearAccessCookie } from '../features/auth/auth.cookies'
import { verifyAccessToken } from '../features/auth/auth.tokens'
import { authenticatedUser } from '../features/auth/auth.services'
import { HttpError } from '../shared/errors/HttpError'

export const requireAuth: RequestHandler = async (request, response, next) => {
  try {
    const token: unknown = request.cookies?.[accessCookieName]
    if (typeof token !== 'string' || !token) {
      throw new HttpError(401, 'Iniciá sesión para continuar.')
    }

    const userId = verifyAccessToken(token)
    request.user = await authenticatedUser(userId)
    next()
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) clearAccessCookie(response)
    next(error)
  }
}
