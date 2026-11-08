import type { AuthUser } from '../features/auth/auth.types'

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export {}
