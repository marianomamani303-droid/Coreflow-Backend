import type { CookieOptions, Response } from 'express'
import { env } from '../../config/env'

export const accessCookieName = 'access_token'

// Con SameSite=None la cookie viaja en peticiones entre sitios: sólo con Secure y
// Partitioned (CHIPS), para que siga disponible donde se bloquean cookies de terceros.
const crossSite = env.auth.cookieSameSite === 'none'

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.production,
  sameSite: env.auth.cookieSameSite,
  ...(crossSite ? { partitioned: true } : {}),
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
