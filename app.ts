import cors from 'cors'
import express from 'express'
import cookieParser from 'cookie-parser'
import authRoutes from './features/auth/auth.routes'
import companiesRoutes from './features/companies/companies.routes'
import productRoutes from './features/products/product.routes'
import inventoryRoutes from './features/inventory/inventory.routes'
import employeeRoutes from './features/employees/employee.routes'
import orderRoutes from './features/orders/order.routes'
import settingsRoutes, { preferencesRouter } from './features/settings/settings.routes'
import invitationsRouter, {
  recipientRouter,
} from './features/invitations/invitations.router'
import { checkDatabaseConnection } from './config/database'
import { env } from './config/env'
import { errorHandler } from './middlewares/errorHandler'

export const app = express()

app.disable('x-powered-by')
app.set('trust proxy', env.trustProxy.length ? [...env.trustProxy] : false)
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  if (env.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
  next()
})
app.use(cors({ origin: [...env.corsOrigins], credentials: true }))
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())
app.use('/api/auth', authRoutes)
app.use('/api/companies/:companyId/products', productRoutes)
app.use('/api/companies/:companyId/inventory', inventoryRoutes)
app.use('/api/companies/:companyId/employees', employeeRoutes)
app.use('/api/companies/:companyId/invitations', invitationsRouter)
app.use('/api/invitations', recipientRouter)
app.use('/api/companies/:companyId/orders', orderRoutes)
app.use('/api/companies/:companyId/settings', settingsRoutes)
app.use('/api/me/preferences', preferencesRouter)
app.use('/api/companies', companiesRoutes)

app.get('/api/health', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store')

  try {
    await checkDatabaseConnection()
    response.json({ status: 'ok', database: 'ok' })
  } catch {
    response.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.use((_request, response) => {
  response.status(404).json({ error: 'Not found' })
})

app.use(errorHandler)
