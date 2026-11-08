import nodemailer from 'nodemailer'
import { env } from '../config/env'

export interface InvitationMail {
  email: string
  companyName: string
  role: 'admin' | 'employee'
  department: string | null
  jobTitle: string | null
  token: string
  expiresAt: Date
}

function html(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  )
}

export function mailFailure(error: unknown): { code: string; retryable: boolean } {
  const value = error as {
    code?: unknown
    command?: unknown
    responseCode?: unknown
  } | null
  const known = [
    'ECONNECTION',
    'ETIMEDOUT',
    'EDNS',
    'EAUTH',
    'EENVELOPE',
    'EMESSAGE',
    'ESOCKET',
    'MAIL_NOT_CONFIGURED',
  ]
  const code =
    typeof value?.code === 'string' && known.includes(value.code)
      ? value.code
      : 'SMTP_FAILED'
  // Solo se reintenta automaticamente antes de entregar el mensaje a SMTP.
  // Un timeout despues de DATA puede haber entregado el correo: no repetirlo.
  const retryable =
    ['ECONNECTION', 'ETIMEDOUT', 'EDNS'].includes(code) &&
    (value?.command === 'CONN' || value?.command === 'EHLO')
  return { code, retryable }
}

export function createMailService(config: typeof env.mail) {
  const configured = Boolean(config.host && config.from && config.publicAppUrl)
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  return {
    async sendInvitation(input: InvitationMail): Promise<void> {
      if (!configured)
        throw Object.assign(new Error('Correo no configurado.'), {
          code: 'MAIL_NOT_CONFIGURED',
        })
      // El fragmento no viaja al servidor web ni en la cabecera Referer.
      const link = `${config.publicAppUrl}/invitacion#token=${input.token}`
      const role = input.role === 'admin' ? 'Administrador' : 'Empleado'
      const details = `Rol: ${role}\nDepartamento: ${input.department ?? 'Sin especificar'}\nPuesto: ${input.jobTitle ?? 'Sin especificar'}`
      const deadline = input.expiresAt.toISOString()
      const info = await transport.sendMail({
        from: { name: 'CoreFlow', address: config.from },
        to: { address: input.email, name: '' },
        subject: `Invitacion a ${input.companyName.replace(/[\r\n]/g, ' ')}`,
        text: `Te invitaron a ${input.companyName} en CoreFlow.\n\n${details}\n\nRevisar y aceptar: ${link}\n\nVence: ${deadline} (UTC). Si no esperabas esta invitacion, podes ignorarla.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#25392f;padding:32px"><p style="letter-spacing:3px">COREFLOW</p><h1>Tu equipo te espera</h1><p>Te invitaron a <strong>${html(input.companyName)}</strong>.</p><p><strong>Rol:</strong> ${role}<br><strong>Departamento:</strong> ${html(input.department ?? 'Sin especificar')}<br><strong>Puesto:</strong> ${html(input.jobTitle ?? 'Sin especificar')}</p><p style="margin:32px 0"><a href="${html(link)}" style="background:#25392f;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none">Revisar y aceptar invitacion</a></p><p>El enlace vence el ${html(deadline)} (UTC), a las 48 horas de su emision.</p><p>Si no esperabas esta invitacion, podes ignorarla. Abrir el enlace no concede acceso.</p></div>`,
      })
      if (!info.accepted?.length)
        throw Object.assign(new Error('SMTP no acepto el destinatario.'), {
          code: 'EENVELOPE',
        })
    },
  }
}

export const mailer = createMailService(env.mail)
