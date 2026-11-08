import type { Request, Response } from 'express'
import { servicesLogin, servicesRegistration } from './auth.services'
import { clearAccessCookie, setAccessCookie } from './auth.cookies'
import { parseLogin, parseRegistration } from './auth.validation'

export const Registration = async (req: Request, res: Response) => {
  const { fullName, email, password } = parseRegistration(req.body)
  const info = await servicesRegistration(fullName, email, password)

  setAccessCookie(res, info.token)
  return res.status(201).json({
    message: 'Usuario registrado correctamente',
    user: info.user,
  })
}

export const Login = async (req: Request, res: Response) => {
  const { email, password } = parseLogin(req.body)
  const info = await servicesLogin(email, password)
  setAccessCookie(res, info.token)
  return res.json({ user: info.user })
}

export const Me = (req: Request, res: Response) => {
  return res.json({ user: req.user })
}

export const Logout = (_req: Request, res: Response) => {
  clearAccessCookie(res)
  return res.status(204).send()
}
