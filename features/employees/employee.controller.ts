import type { Request, Response } from 'express'
import { identifier } from '../../shared/validation'
import * as service from './employee.service'
import { parseAddMember, parseUpdateMember } from './employee.validation'

export async function index(req: Request, res: Response) {
  res.json(await service.membersForUser(req.user!.id, identifier(req.params.companyId)))
}
export async function create(req: Request, res: Response) {
  res
    .status(201)
    .json(
      await service.addMember(
        req.user!.id,
        identifier(req.params.companyId),
        parseAddMember(req.body),
      ),
    )
}
export async function update(req: Request, res: Response) {
  await service.editMember(
    req.user!.id,
    identifier(req.params.companyId),
    identifier(req.params.userId),
    parseUpdateMember(req.body),
  )
  res.sendStatus(204)
}
