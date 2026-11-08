import { Router } from 'express'
import { requireAuth } from '../../middlewares/requireAuth'
import { requireTrustedOrigin } from '../../middlewares/requireTrustedOrigin'
import * as controller from './inventory.controller'

const router = Router({ mergeParams: true })
router.use(requireAuth, requireTrustedOrigin)
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
router.get('/', controller.index)
router.get('/movements', controller.history)
router.post('/movements', controller.movement)
router.put('/minimum', controller.minimum)
router.post('/warehouses', controller.warehouse)
export default router
