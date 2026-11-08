import type { Request, Response } from 'express'
import { identifier } from '../../shared/validation'
import * as service from './order.service'
import * as validation from './order.validation'

export async function index(req: Request, res: Response) {
  res.json(
    await service.ordersForUser(
      req.user!.id,
      identifier(req.params.companyId),
      validation.parseOrderQuery(req.query),
    ),
  )
}
export async function show(req: Request, res: Response) {
  res.json({
    order: await service.orderForUser(
      req.user!.id,
      identifier(req.params.companyId),
      identifier(req.params.orderId),
    ),
  })
}
export async function create(req: Request, res: Response) {
  const result = await service.createOrder(
    req.user!.id,
    identifier(req.params.companyId),
    validation.parseCreateOrder(req.body),
  )
  res.status(result.replayed ? 200 : 201).json(result)
}
export async function update(req: Request, res: Response) {
  res.json(
    await service.editOrder(
      req.user!.id,
      identifier(req.params.companyId),
      identifier(req.params.orderId),
      validation.parseUpdateOrder(req.body),
    ),
  )
}
export async function status(req: Request, res: Response) {
  const input = validation.parseStatus(req.body)
  res.json(
    await service.changeStatus(
      req.user!.id,
      identifier(req.params.companyId),
      identifier(req.params.orderId),
      input.status,
      input.version,
    ),
  )
}
