import { HttpError } from '../../shared/errors/HttpError'
import type { LoginInput, RegistrationInput } from './auth.types'

function bodyObject(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new HttpError(400, 'El cuerpo de la solicitud debe ser un objeto JSON.')
  }
  return input as Record<string, unknown>
}

function emailValue(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'Ingresá un correo válido.')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Ingresá un correo válido.')
  }
  return email
}

function passwordValue(value: unknown, minimum: number): string {
  // bcrypt procesa como máximo 72 bytes: se rechaza en vez de truncar en silencio.
  if (
    typeof value !== 'string' ||
    value.length < minimum ||
    Buffer.byteLength(value, 'utf8') > 72
  ) {
    throw new HttpError(
      400,
      `La contraseña debe tener al menos ${minimum} caracteres y no superar 72 bytes.`,
    )
  }
  return value
}

export function parseRegistration(input: unknown): RegistrationInput {
  const body = bodyObject(input)
  const fullName =
    typeof body.fullName === 'string' ? body.fullName.trim().replace(/\s+/g, ' ') : ''

  if (Array.from(fullName).length < 2 || fullName.length > 120) {
    throw new HttpError(400, 'El nombre completo debe tener entre 2 y 120 caracteres.')
  }

  return {
    fullName,
    email: emailValue(body.email),
    password: passwordValue(body.password, 8),
  }
}

export function parseLogin(input: unknown): LoginInput {
  const body = bodyObject(input)
  return { email: emailValue(body.email), password: passwordValue(body.password, 1) }
}
