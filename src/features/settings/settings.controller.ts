import type { Request, Response } from 'express'
import { identifier, integer, objectBody } from '../../shared/validation'
import * as service from './settings.service'
import * as validation from './settings.validation'
import { parseLogo } from './settings.logo'

export async function index(req: Request, res: Response) {
  res.json({
    settings: await service.settingsForUser(
      req.user!.id,
      identifier(req.params.companyId),
    ),
  })
}
export async function general(req: Request, res: Response) {
  res.json({
    settings: await service.general(
      req.user!.id,
      identifier(req.params.companyId),
      validation.parseGeneral(req.body),
    ),
  })
}
export async function inventory(req: Request, res: Response) {
  res.json({
    settings: await service.inventory(
      req.user!.id,
      identifier(req.params.companyId),
      validation.parseInventory(req.body),
    ),
  })
}
export async function orders(req: Request, res: Response) {
  res.json({
    settings: await service.orders(
      req.user!.id,
      identifier(req.params.companyId),
      validation.parseOrders(req.body),
    ),
  })
}
export async function logo(req: Request, res: Response) {
  const value = parseLogo(req.body)
  res.json({
    settings: await service.logo(
      req.user!.id,
      identifier(req.params.companyId),
      value.data,
      value.version,
    ),
  })
}
export async function removeLogo(req: Request, res: Response) {
  const body = objectBody(req.body, ['version'])
  res.json({
    settings: await service.logo(
      req.user!.id,
      identifier(req.params.companyId),
      null,
      integer(body.version, 1),
    ),
  })
}
export async function image(req: Request, res: Response) {
  const data = await service.logoForUser(req.user!.id, identifier(req.params.companyId))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.type('image/png').send(data)
}
export async function preferences(req: Request, res: Response) {
  res.json({ preferences: await service.preferencesForUser(req.user!.id) })
}
export async function updatePreferences(req: Request, res: Response) {
  res.json({
    preferences: await service.updatePreferencesForUser(
      req.user!.id,
      validation.parsePreferences(req.body),
    ),
  })
}
