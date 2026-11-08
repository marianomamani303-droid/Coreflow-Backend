import { companyForUser } from '../companies/companies.service'
import { companyTransaction, requireManager } from '../../shared/companyAccess'
import { HttpError } from '../../shared/errors/HttpError'
import * as repository from './employee.repository'
import type { AddMemberInput, UpdateMemberInput } from './employee.types'

export async function membersForUser(userId: string, companyId: string) {
  await companyForUser(userId, companyId)
  return { employees: await repository.listMembers(companyId) }
}
export async function addMember(
  userId: string,
  companyId: string,
  input: AddMemberInput,
) {
  return companyTransaction(userId, companyId, async (c, role) => {
    requireManager(role)
    if (role !== 'owner' && input.role !== 'employee')
      throw new HttpError(403, 'Sólo el propietario puede incorporar administradores.')
    const account = await repository.findAccount(c, input.email)
    if (!account || account.status !== 'active')
      throw new HttpError(
        404,
        'No encontramos una cuenta activa con ese correo. La persona debe registrarse primero en CoreFlow.',
      )
    const targetId = String(account.id)
    if (await repository.lockMember(c, companyId, targetId))
      throw new HttpError(
        409,
        'La persona ya pertenece a la empresa. Podés editar o reactivar su membresía.',
      )
    await repository.insertMember(c, companyId, targetId, input)
    return { userId: targetId }
  })
}
export async function editMember(
  userId: string,
  companyId: string,
  targetId: string,
  input: UpdateMemberInput,
) {
  return companyTransaction(userId, companyId, async (c, role) => {
    requireManager(role)
    const member = await repository.lockMember(c, companyId, targetId)
    if (!member) throw new HttpError(404, 'Membresía no encontrada en esta empresa.')
    if (targetId === userId || member.role === 'owner')
      throw new HttpError(
        403,
        'No se puede modificar tu propia membresía ni la del propietario desde este módulo.',
      )
    if (role !== 'owner' && (member.role !== 'employee' || input.role !== 'employee'))
      throw new HttpError(
        403,
        'Sólo el propietario puede administrar roles de administrador.',
      )
    await repository.updateMember(c, companyId, targetId, input)
  })
}
