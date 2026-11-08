import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import { HttpError } from '../../shared/errors/HttpError'

export function createAccessToken(userId: string): string {
  return jwt.sign({ userId }, env.auth.secret, {
    algorithm: 'HS256',
    subject: userId,
    issuer: 'coreflow',
    audience: 'coreflow-web',
    expiresIn: env.auth.sessionSeconds,
  })
}

export function verifyAccessToken(token: string): string {
  try {
    const payload = jwt.verify(token, env.auth.secret, {
      algorithms: ['HS256'],
      issuer: 'coreflow',
      audience: 'coreflow-web',
    })

    if (
      typeof payload === 'string' ||
      typeof payload.userId !== 'string' ||
      !/^[1-9]\d*$/.test(payload.userId) ||
      payload.sub !== payload.userId ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Invalid claims')
    }
    return payload.userId
  } catch {
    throw new HttpError(401, 'Tu sesión no es válida o venció. Volvé a iniciar sesión.')
  }
}
