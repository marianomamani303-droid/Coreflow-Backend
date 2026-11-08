import { Router } from 'express'
import { requireAuth } from '../../middlewares/requireAuth'
import { requireTrustedOrigin } from '../../middlewares/requireTrustedOrigin'
import * as controller from './settings.controller'

function securedRouter() {
  const router = Router({ mergeParams: true })
  router.use(requireAuth, requireTrustedOrigin)
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  return router
}
const router = securedRouter()
router.get('/', controller.index)
router.put('/general', controller.general)
router.put('/inventory', controller.inventory)
router.put('/orders', controller.orders)
router.get('/logo', controller.image)
router.put('/logo', controller.logo)
router.delete('/logo', controller.removeLogo)
export const preferencesRouter = securedRouter()
preferencesRouter.get('/', controller.preferences)
preferencesRouter.put('/', controller.updatePreferences)
export default router
