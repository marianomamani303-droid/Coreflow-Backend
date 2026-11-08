import { randomBytes, createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { PoolConnection } from 'mysql2/promise'
import { pool } from '../../config/database'
import { companyTransaction, requireManager } from '../../shared/companyAccess'
import { HttpError } from '../../shared/errors/HttpError'
import { mailer, mailFailure } from '../../shared/mail'
import type { InvitationMail } from '../../shared/mail'
import * as members from '../employees/employee.repository'
import type { AddMemberInput } from '../employees/employee.types'
import * as repository from './invitations.repository'
import { invitationView } from './invitations.types'
import type { InvitationRow } from './invitations.types'
import type { parseInvitationQuery } from './invitations.validation'

const expiry = () => new Date(Date.now() + 48 * 60 * 60 * 1000)
const hashToken = (token: string) => createHash('sha256').update(token).digest()

function authorize(role: string | undefined, invitedRole: string) {
  if (role !== 'owner' && role !== 'admin')
    throw new HttpError(403, 'Tu rol no permite administrar invitaciones.')
  if (role !== 'owner' && invitedRole !== 'employee') {
    throw new HttpError(
      403,
      'Solo el propietario puede administrar invitaciones de administradores.',
    )
  }
}

type Delivery = InvitationMail & {
  id: string
  companyId: string
  senderId: string
  lockId: string
}

async function requireSender(connection: PoolConnection, row: InvitationRow) {
  const role = await repository.senderRole(
    connection,
    String(row.company_id),
    String(row.invited_by),
  )
  if (role !== 'owner' && !(role === 'admin' && row.role === 'employee')) {
    throw new HttpError(
      410,
      'La invitacion ya no tiene un remitente autorizado. Solicita una nueva.',
    )
  }
}

async function deliverReserved(delivery: Delivery) {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const claimed = await companyTransaction(
        delivery.senderId,
        delivery.companyId,
        async (connection, role) => {
          authorize(role, delivery.role)
          authorize(
            await repository.senderRole(
              connection,
              delivery.companyId,
              delivery.senderId,
            ),
            delivery.role,
          )
          const row = await repository.findInvitation(
            delivery.id,
            delivery.companyId,
            connection,
            true,
          )
          if (!row || row.delivery_lock_id !== delivery.lockId) return false
          await requireSender(connection, row)
          return repository.startAttempt(connection, delivery.id, delivery.lockId)
        },
      )
      if (!claimed) break
      let failure: ReturnType<typeof mailFailure> | null = null
      try {
        await mailer.sendInvitation(delivery)
      } catch (error) {
        failure = mailFailure(error)
      }
      if (!failure) {
        await repository.finishDelivery(delivery.id, delivery.lockId, null, true)
        break
      }
      const retry = attempt === 0 && failure.retryable
      await repository.finishDelivery(delivery.id, delivery.lockId, failure.code, !retry)
      if (!retry) break
      await delay(250)
    }
  } finally {
    await repository.releaseDelivery(delivery.id, delivery.lockId)
  }
  const row = await repository.findInvitation(delivery.id, delivery.companyId)
  if (!row) throw new HttpError(404, 'Invitacion no encontrada.')
  return { invitation: invitationView(row) }
}

export async function generar_invitacion(
  userId: string,
  companyId: string,
  input: AddMemberInput,
) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = expiry()
  const lockId = randomUUID()
  let delivery: Delivery
  try {
    delivery = await companyTransaction(userId, companyId, async (connection, role) => {
      authorize(role, input.role)
      authorize(await repository.senderRole(connection, companyId, userId), input.role)
      const company = await repository.lockCompany(connection, companyId)
      const account = await members.findAccount(connection, input.email)
      if (
        account &&
        (await members.lockMember(connection, companyId, String(account.id)))
      ) {
        throw new HttpError(
          409,
          'La persona ya pertenece a la empresa. Administra su membresia existente.',
        )
      }
      await repository.expirePending(connection, companyId)
      if (await repository.findPending(connection, companyId, input.email)) {
        throw new HttpError(
          409,
          'Ya hay una invitacion pendiente para ese correo. Podes reenviarla desde el listado.',
        )
      }
      const result = await repository.guardar_invitacion(
        companyId,
        input.email,
        input.role,
        input.department,
        input.jobTitle,
        hashToken(token),
        userId,
        expiresAt,
        connection,
      )
      const id = String(result.insertId)
      await repository.reserveDelivery(
        connection,
        id,
        companyId,
        lockId,
        hashToken(token),
        expiresAt,
      )
      return {
        id,
        companyId,
        senderId: userId,
        lockId,
        token,
        expiresAt,
        email: input.email,
        role: input.role,
        department: input.department,
        jobTitle: input.jobTitle,
        companyName: company!.name,
      }
    })
  } catch (error) {
    if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Ya existe una invitacion pendiente para ese correo.')
    }
    throw error
  }
  return deliverReserved(delivery)
}

export async function invitationsForUser(
  userId: string,
  companyId: string,
  filters: ReturnType<typeof parseInvitationQuery>,
) {
  return companyTransaction(userId, companyId, async (connection, role) => {
    requireManager(role)
    const { rows, ...pagination } = await repository.listInvitations(
      companyId,
      filters,
      connection,
    )
    return { invitations: rows.map(invitationView), ...pagination }
  })
}

export async function revokeInvitation(userId: string, companyId: string, id: string) {
  return companyTransaction(userId, companyId, async (connection, role) => {
    const row = await repository.findInvitation(id, companyId, connection, true)
    if (!row) throw new HttpError(404, 'Invitacion no encontrada.')
    authorize(role, row.role)
    if (row.status !== 'pending')
      throw new HttpError(409, 'La invitacion ya no esta pendiente.')
    await repository.setStatus(connection, id, 'revoked')
    return {
      invitation: invitationView(
        (await repository.findInvitation(id, companyId, connection))!,
      ),
    }
  })
}

export async function resendInvitation(userId: string, companyId: string, id: string) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = expiry()
  const lockId = randomUUID()
  const delivery = await companyTransaction(
    userId,
    companyId,
    async (connection, role) => {
      const row = await repository.findInvitation(id, companyId, connection, true)
      if (!row) throw new HttpError(404, 'Invitacion no encontrada.')
      authorize(role, row.role)
      authorize(await repository.senderRole(connection, companyId, userId), row.role)
      await requireSender(connection, row)
      if (row.status !== 'pending' || row.expires_at.getTime() <= Date.now()) {
        throw new HttpError(409, 'La invitacion ya no esta vigente. Crea una nueva.')
      }
      if (row.delivery_locked_until && row.delivery_locked_until.getTime() > Date.now()) {
        throw new HttpError(
          409,
          'Hay un envio en curso. Espera antes de volver a intentar.',
        )
      }
      if (row.send_attempts >= 5)
        throw new HttpError(
          409,
          'Se alcanzo el limite de 5 intentos. Revoca la invitacion y crea una nueva.',
        )
      if (
        row.last_send_attempt_at &&
        row.last_send_attempt_at.getTime() > Date.now() - 60000
      ) {
        throw new HttpError(429, 'Espera un minuto entre envios.')
      }
      const account = await members.findAccount(connection, row.email)
      if (
        account &&
        (await members.lockMember(connection, companyId, String(account.id)))
      ) {
        throw new HttpError(409, 'La persona ya pertenece a esta empresa.')
      }
      const company = await repository.lockCompany(connection, companyId)
      await repository.reserveDelivery(
        connection,
        id,
        companyId,
        lockId,
        hashToken(token),
        expiresAt,
      )
      return {
        id,
        companyId,
        senderId: userId,
        lockId,
        token,
        expiresAt,
        email: row.email,
        role: row.role,
        department: row.department,
        jobTitle: row.job_title,
        companyName: company!.name,
      }
    },
  )
  return deliverReserved(delivery)
}

async function withToken<T>(
  token: string,
  work: (
    connection: PoolConnection,
    row: InvitationRow,
    companyName: string,
  ) => Promise<T>,
): Promise<T> {
  const hash = hashToken(token)
  const reference = await repository.findByToken(hash)
  if (!reference)
    throw new HttpError(
      404,
      'El enlace de invitacion no es valido o ya no esta disponible.',
    )
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const company = await repository.lockCompany(connection, String(reference.company_id))
    const row = await repository.findInvitation(
      String(reference.id),
      String(reference.company_id),
      connection,
      true,
    )
    if (
      !company ||
      company.status !== 'active' ||
      !row ||
      !timingSafeEqual(row.token_hash, hash)
    ) {
      throw new HttpError(404, 'El enlace de invitacion no esta disponible.')
    }
    if (row.status !== 'pending' || row.expires_at.getTime() <= Date.now()) {
      throw new HttpError(410, 'Esta invitacion vencio o ya fue respondida o revocada.')
    }
    await requireSender(connection, row)
    const result = await work(connection, row, company.name)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function recipient(connection: PoolConnection, row: InvitationRow, userId: string) {
  const account = await repository.lockAccount(connection, userId)
  if (!account || account.status !== 'active')
    throw new HttpError(401, 'Tu cuenta no esta disponible.')
  if (account.email.trim().toLowerCase() !== row.email.trim().toLowerCase()) {
    throw new HttpError(403, 'Inicia sesion con el correo al que se envio la invitacion.')
  }
  return account
}

export function previewInvitation(token: string) {
  return withToken(token, async (_connection, row, companyName) => ({
    invitation: {
      companyName,
      email: row.email,
      role: row.role,
      department: row.department,
      jobTitle: row.job_title,
      expiresAt: row.expires_at.toISOString(),
    },
  }))
}

export function verifyInvitationEmail(userId: string, token: string) {
  return withToken(token, async (connection, row) => {
    await recipient(connection, row, userId)
    // El enlace recibido y una sesion del mismo correo prueban acceso al buzon.
    await connection.execute(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(6)) WHERE id = ?',
      [userId],
    )
    return { verified: true }
  })
}

export function acceptInvitation(userId: string, token: string) {
  return withToken(token, async (connection, row) => {
    const account = await recipient(connection, row, userId)
    if (!account.email_verified_at)
      throw new HttpError(403, 'Primero verifica tu correo desde esta invitacion.')
    const companyId = String(row.company_id)
    if (await members.lockMember(connection, companyId, userId)) {
      throw new HttpError(
        409,
        'Ya tenes una membresia en esta empresa. No se modificaron tus permisos.',
      )
    }
    await members.insertMember(connection, companyId, userId, {
      email: row.email,
      role: row.role,
      department: row.department,
      jobTitle: row.job_title,
    })
    await connection.execute(
      `UPDATE company_invitations SET status = 'accepted', accepted_by = ?, accepted_at = UTC_TIMESTAMP(6),
        delivery_lock_id = NULL, delivery_locked_until = NULL WHERE id = ?`,
      [userId, row.id],
    )
    return { companyId }
  })
}

export function declineInvitation(userId: string, token: string) {
  return withToken(token, async (connection, row) => {
    await recipient(connection, row, userId)
    await repository.setStatus(connection, String(row.id), 'declined')
    return { declined: true }
  })
}
