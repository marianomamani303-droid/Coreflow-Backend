import type { Request, Response } from 'express'
import { identifier } from '../../shared/validation'
import * as service from './inventory.service'
import * as validation from './inventory.validation'

export async function index(req: Request, res: Response) {
  res.json(await service.inventoryForUser(req.user!.id, identifier(req.params.companyId)))
}
export async function history(req: Request, res: Response) {
  res.json(
    await service.movementsForUser(
      req.user!.id,
      identifier(req.params.companyId),
      validation.parseHistoryQuery(req.query),
    ),
  )
}
export async function movement(req: Request, res: Response) {
  res
    .status(201)
    .json(
      await service.recordMovement(
        req.user!.id,
        identifier(req.params.companyId),
        validation.parseMovement(req.body),
      ),
    )
}
export async function minimum(req: Request, res: Response) {
  await service.setMinimum(
    req.user!.id,
    identifier(req.params.companyId),
    validation.parseMinimum(req.body),
  )
  res.sendStatus(204)
}
export async function warehouse(req: Request, res: Response) {
  res
    .status(201)
    .json(
      await service.createWarehouse(
        req.user!.id,
        identifier(req.params.companyId),
        validation.parseWarehouse(req.body),
      ),
    )
}
