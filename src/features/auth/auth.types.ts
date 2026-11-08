export interface AuthUser {
  id: string
  fullName: string
  email: string
}

export interface RegistrationInput {
  fullName: string
  email: string
  password: string
}

export interface LoginInput {
  email: string
  password: string
}
