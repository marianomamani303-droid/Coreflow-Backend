import type { Request, Response } from 'express'
import { identifier, objectBody } from '../../shared/validation'
import * as service from './invitations.services'
import {
  parseInvitation,
  parseInvitationQuery,
  parseToken,
} from './invitations.validation'

export async function crear_invitacion(req: Request, res: Response) {
  const result = await service.generar_invitacion(
    req.user!.id,
    identifier(req.params.companyId),
    parseInvitation(req.body),
  )
  res.status(201).json(result)
}
export async function index(req: Request, res: Response) {
  res.json(
    await service.invitationsForUser(
      req.user!.id,
      identifier(req.params.companyId),
      parseInvitationQuery(req.query),
    ),
  )
}
export async function revoke(req: Request, res: Response) {
  objectBody(req.body ?? {}, [])
  res.json(
    await service.revokeInvitation(
      req.user!.id,
      identifier(req.params.companyId),
      identifier(req.params.invitationId),
    ),
  )
}
export async function resend(req: Request, res: Response) {
  objectBody(req.body ?? {}, [])
  res.json(
    await service.resendInvitation(
      req.user!.id,
      identifier(req.params.companyId),
      identifier(req.params.invitationId),
    ),
  )
}
export async function preview(req: Request, res: Response) {
  res.json(await service.previewInvitation(parseToken(req.body)))
}
export async function verifyEmail(req: Request, res: Response) {
  res.json(await service.verifyInvitationEmail(req.user!.id, parseToken(req.body)))
}
export async function accept(req: Request, res: Response) {
  res.json(await service.acceptInvitation(req.user!.id, parseToken(req.body)))
}
export async function decline(req: Request, res: Response) {
  res.json(await service.declineInvitation(req.user!.id, parseToken(req.body)))
}
