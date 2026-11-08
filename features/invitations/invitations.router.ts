import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { requireAuth } from '../../middlewares/requireAuth'
import { requireTrustedOrigin } from '../../middlewares/requireTrustedOrigin'
import * as controller from './invitations.controller'

const router = Router({ mergeParams: true })
router.use(requireAuth, requireTrustedOrigin)
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
const sendLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => `${req.user!.id}:${req.params.companyId}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    message: 'Demasiados envios. Espera unos minutos antes de volver a intentar.',
  },
})
router.get('/', controller.index)
router.post('/', sendLimit, controller.crear_invitacion)
router.post('/:invitationId/revoke', controller.revoke)
router.post('/:invitationId/resend', sendLimit, controller.resend)

export const recipientRouter = Router()
recipientRouter.use(requireTrustedOrigin)
recipientRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
recipientRouter.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 240,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Demasiados intentos. Espera unos minutos.' },
  }),
)
recipientRouter.post('/preview', controller.preview)
recipientRouter.post('/verify-email', requireAuth, controller.verifyEmail)
recipientRouter.post('/accept', requireAuth, controller.accept)
recipientRouter.post('/decline', requireAuth, controller.decline)
export default router
