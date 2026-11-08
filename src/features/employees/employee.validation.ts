import { HttpError } from '../../shared/errors/HttpError'
import { objectBody, text } from '../../shared/validation'
import type { AddMemberInput, UpdateMemberInput } from './employee.types'

function memberFields(b: Record<string, unknown>) {
  if (b.role !== 'admin' && b.role !== 'employee')
    throw new HttpError(400, 'El rol debe ser admin o employee.')
  return {
    role: b.role,
    department:
      b.department == null || b.department === ''
        ? null
        : text(b.department, 'Área', 1, 80),
    jobTitle:
      b.jobTitle == null || b.jobTitle === '' ? null : text(b.jobTitle, 'Puesto', 1, 100),
  } as const
}
export function parseAddMember(input: unknown): AddMemberInput {
  const b = objectBody(input, ['email', 'role', 'department', 'jobTitle'])
  const email = text(b.email, 'Correo', 5, 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, 'Ingresá un correo válido.')
  return { ...memberFields(b), email }
}
export function parseUpdateMember(input: unknown): UpdateMemberInput {
  const b = objectBody(input, ['role', 'status', 'department', 'jobTitle'])
  if (b.status !== 'active' && b.status !== 'suspended')
    throw new HttpError(400, 'Estado de membresía inválido.')
  return { ...memberFields(b), status: b.status }
}
