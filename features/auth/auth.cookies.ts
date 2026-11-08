import type { CookieOptions, Response } from 'express'
import { env } from '../../config/env'

export const accessCookieName = 'access_token'

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.production,
  sameSite: 'lax',
  path: '/',
}

export function setAccessCookie(response: Response, token: string): void {
  response.cookie(accessCookieName, token, {
    ...cookieOptions,
    maxAge: env.auth.sessionSeconds * 1000,
  })
}

export function clearAccessCookie(response: Response): void {
  response.clearCookie(accessCookieName, cookieOptions)
}
