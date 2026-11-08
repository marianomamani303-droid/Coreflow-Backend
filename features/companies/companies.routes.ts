import { Router } from 'express'
import { requireAuth } from '../../middlewares/requireAuth'
import { requireTrustedOrigin } from '../../middlewares/requireTrustedOrigin'
import { CreateCompany, GetCompany, ListCompanies } from './companies.controller'

const router = Router()
router.use(requireAuth, requireTrustedOrigin)
router.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})
router.get('/', ListCompanies)
router.post('/', CreateCompany)
router.get('/:companyId', GetCompany)

export default router
