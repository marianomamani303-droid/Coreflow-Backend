import { Router } from 'express'
import { requireAuth } from '../../middlewares/requireAuth'
import { requireTrustedOrigin } from '../../middlewares/requireTrustedOrigin'
import { CreateProduct, enviarProducts } from './product.controller'

const router = Router({ mergeParams: true })
router.use(requireAuth, requireTrustedOrigin)
router.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})
router.post('/', CreateProduct)
router.get('/', enviarProducts)
router.get('/mostrarProducts', enviarProducts)
export default router
