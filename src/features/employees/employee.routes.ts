import { Router } from 'express'
import { requireAuth } from '../../middlewares/requireAuth'
import { requireTrustedOrigin } from '../../middlewares/requireTrustedOrigin'
import * as controller from './employee.controller'
const router = Router({ mergeParams: true })
router.use(requireAuth, requireTrustedOrigin)
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
router.get('/', controller.index)
router.post('/', controller.create)
router.patch('/:userId', controller.update)
export default router
