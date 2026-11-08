import { Router } from 'express'
import { requireAuth } from '../../middlewares/requireAuth'
import { requireTrustedOrigin } from '../../middlewares/requireTrustedOrigin'
import * as controller from './order.controller'

const router = Router({ mergeParams: true })
router.use(requireAuth, requireTrustedOrigin)
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
router.get('/', controller.index)
router.get('/:orderId', controller.show)
router.post('/', controller.create)
router.put('/:orderId', controller.update)
router.patch('/:orderId/status', controller.status)
export default router
