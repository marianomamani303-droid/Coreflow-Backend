import bcrypt from 'bcrypt'
import { HttpError } from '../../shared/errors/HttpError'
import { createAccessToken } from './auth.tokens'
import type { AuthUser } from './auth.types'

import { verifyExistUser, createUser, findUserById } from './auth.repository'

export const servicesRegistration = async (
  fullName: string,
  email: string,
  password: string,
) => {
  const users = await verifyExistUser(email)
  const user = users[0]

  if (user) {
    throw new HttpError(409, 'Ya existe una cuenta con ese correo.')
  }

  const passwordHash = await bcrypt.hash(password, 12)

  let newUserId: string
  try {
    newUserId = await createUser(fullName, email, passwordHash)
  } catch (error) {
    // La restricción UNIQUE también cubre dos registros simultáneos.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ER_DUP_ENTRY'
    ) {
      throw new HttpError(409, 'Ya existe una cuenta con ese correo.')
    }
    throw error
  }

  const token = createAccessToken(newUserId)

  return {
    user: { id: newUserId, fullName, email } satisfies AuthUser,
    token,
  }
}

// Iguala el trabajo de bcrypt aunque el correo no exista; no es una credencial real.
const dummyPasswordHash = bcrypt.hash('coreflow-login-timing-placeholder', 12)

export async function servicesLogin(email: string, password: string) {
  const [user] = await verifyExistUser(email)
  const matches = await bcrypt.compare(
    password,
    user?.password_hash ?? (await dummyPasswordHash),
  )
  if (!user || !matches || user.status !== 'active') {
    throw new HttpError(401, 'Correo o contraseña incorrectos.')
  }

  return {
    user: {
      id: String(user.id),
      fullName: user.full_name,
      email: user.email,
    } satisfies AuthUser,
    token: createAccessToken(String(user.id)),
  }
}

export async function authenticatedUser(userId: string): Promise<AuthUser> {
  const user = await findUserById(userId)
  if (!user || user.status !== 'active') {
    throw new HttpError(401, 'Tu sesión no está disponible. Volvé a iniciar sesión.')
  }
  return { id: String(user.id), fullName: user.full_name, email: user.email }
}
