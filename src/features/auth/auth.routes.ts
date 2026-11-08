import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { Registration, Login, Me, Logout } from './auth.controller'
import { requireAuth } from '../../middlewares/requireAuth'
import { requireTrustedOrigin } from '../../middlewares/requireTrustedOrigin'

const router = Router()

const attempts = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    message: 'Demasiados intentos. Esperá unos minutos antes de volver a intentar.',
  },
})

// Los registros exitosos también consumen cuota para limitar creación masiva.
const registrations = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    message: 'Demasiados registros. Esperá unos minutos antes de volver a intentar.',
  },
})

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
router.use(requireTrustedOrigin)
router.post('/register', registrations, Registration)
router.post('/login', attempts, Login)
router.get('/me', requireAuth, Me)
router.post('/logout', Logout)

export default router
