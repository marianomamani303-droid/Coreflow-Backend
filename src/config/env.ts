import { isAbsolute, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import dotenv from 'dotenv'

// La ruta funciona tanto desde src/config como desde dist/config.
dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true })

const nodeEnv = process.env.NODE_ENV?.trim() || 'development'
if (!['development', 'test', 'production'].includes(nodeEnv)) {
  throw new Error('NODE_ENV debe ser development, test o production.')
}
const production = nodeEnv === 'production'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`)
  return value
}

function port(name: string, fallback?: string): number {
  const value = process.env[name]?.trim() ?? fallback
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} debe contener un puerto numérico.`)
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} debe estar entre 1 y 65535.`)
  }
  return parsed
}

if (process.env.DB_PASSWORD === undefined) {
  throw new Error('Falta DB_PASSWORD. Declarala vacía sólo si tu instalación lo permite.')
}

const databaseName = required('DB_NAME')
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) {
  throw new Error(
    'DB_NAME debe ser un identificador con letras, números o guiones bajos.',
  )
}
if (['sys', 'mysql', 'information_schema', 'performance_schema'].includes(databaseName.toLowerCase())) {
  throw new Error('DB_NAME debe ser la base de la aplicación, no una base del sistema.')
}

// Se tolera una barra final ("https://app.example.com/"), como la que copian los
// paneles de hosting; cualquier otra ruta, query o credencial sigue rechazada.
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

for (const origin of corsOrigins) {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new Error('CORS_ORIGINS debe contener orígenes HTTP/HTTPS sin rutas.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
    throw new Error('CORS_ORIGINS debe contener orígenes HTTP/HTTPS sin rutas.')
  }
}

const jwtSecret = required('JWT_SECRET')
if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
  throw new Error('JWT_SECRET debe contener al menos 32 bytes.')
}
if (
  production &&
  (new Set(jwtSecret).size < 12 ||
    /change.?me|your.?secret|example|placeholder/i.test(jwtSecret))
) {
  throw new Error('JWT_SECRET de producción debe ser una clave aleatoria, no un ejemplo.')
}

const sessionSeconds = Number(process.env.AUTH_SESSION_SECONDS ?? '28800')
if (!Number.isInteger(sessionSeconds) || sessionSeconds < 300 || sessionSeconds > 86400) {
  throw new Error('AUTH_SESSION_SECONDS debe estar entre 300 y 86400.')
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim()
  if (!value) return fallback
  if (value !== 'true' && value !== 'false')
    throw new Error(`${name} debe ser true o false.`)
  return value === 'true'
}

const publicAppUrl = process.env.PUBLIC_APP_URL?.trim() || ''
if (publicAppUrl) {
  const url = new URL(publicAppUrl)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (production && url.protocol !== 'https:')
  )
    throw new Error('PUBLIC_APP_URL debe ser un origen HTTP/HTTPS; en produccion, HTTPS.')
}
if (
  production &&
  (!publicAppUrl ||
    !corsOrigins.includes(new URL(publicAppUrl).origin) ||
    corsOrigins.some((origin) => !origin.startsWith('https://')))
) {
  throw new Error(
    'Producción requiere PUBLIC_APP_URL HTTPS incluido en CORS_ORIGINS, con orígenes HTTPS.',
  )
}

// Sólo direcciones o subredes del proxy controlado; nunca confiar en todos.
const trustProxy = (process.env.TRUST_PROXY ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
if (
  trustProxy.some((value) => {
    if (['loopback', 'linklocal', 'uniquelocal'].includes(value)) return false
    const [address, prefix, ...extra] = value.split('/')
    const family = isIP(address ?? '')
    return (
      !family ||
      extra.length > 0 ||
      (prefix !== undefined &&
        (!/^\d{1,3}$/.test(prefix) ||
          Number(prefix) < 1 ||
          Number(prefix) > (family === 4 ? 32 : 128)))
    )
  })
) {
  throw new Error(
    'TRUST_PROXY debe contener IP/subredes de proxies confiables, no true ni un número de saltos.',
  )
}
const databaseSSL = booleanEnv('DB_SSL', false)
const databaseHost = required('DB_HOST')
if (/\.tidbcloud\.com$/i.test(databaseHost) && !databaseSSL) {
  throw new Error('TiDB Cloud requiere DB_SSL=true.')
}
// mysql2 omite su comprobación de identidad cuando host es una IP literal.
if (databaseSSL && isIP(databaseHost)) {
  throw new Error(
    'DB_HOST con TLS debe ser un nombre DNS que coincida con el certificado.',
  )
}
// Ruta absoluta (p. ej. /etc/secrets/isrgrootx1.pem en Render) o relativa a la raíz
// del backend (certs/isrgrootx1.pem, versionado: es el CA público de TiDB Cloud).
// Se aceptan separadores de Windows para que la misma ruta funcione en Linux.
const databaseCAPath = process.env.DB_SSL_CA?.trim().replace(/\\/g, '/')
if (databaseCAPath && !databaseSSL) throw new Error('DB_SSL_CA requiere DB_SSL=true.')
function readCertificate(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(__dirname, '../../', path)
  let content: string
  try {
    content = readFileSync(absolute, 'utf8')
  } catch {
    throw new Error(`No se pudo leer DB_SSL_CA (${absolute}). Revisá la ruta del certificado.`)
  }
  if (!content.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('DB_SSL_CA debe ser un certificado PEM.')
  }
  return content
}
const databaseCA = databaseCAPath ? readCertificate(databaseCAPath) : undefined
const smtpUser = process.env.SMTP_USER?.trim() || ''
const smtpPassword = process.env.SMTP_PASSWORD || ''
if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
  throw new Error('SMTP_USER y SMTP_PASSWORD deben configurarse juntos.')
}
const mailFrom = process.env.MAIL_FROM?.trim() || ''
const smtpSecure = booleanEnv('SMTP_SECURE', false)
const smtpRequireTLS = booleanEnv('SMTP_REQUIRE_TLS', true)
if (production && process.env.SMTP_HOST?.trim() && !smtpSecure && !smtpRequireTLS) {
  throw new Error('El transporte SMTP de produccion debe exigir TLS.')
}
if (
  mailFrom &&
  (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mailFrom) || /[\r\n]/.test(mailFrom))
) {
  throw new Error(
    'MAIL_FROM debe ser una direccion de correo valida, sin nombre visible.',
  )
}

// lax: frontend y API bajo el mismo sitio (dominio propio o rewrite /api del hosting).
// none: frontend en otro sitio (p. ej. *.vercel.app → *.onrender.com); exige HTTPS.
const cookieSameSite = (process.env.AUTH_COOKIE_SAME_SITE?.trim() || 'lax').toLowerCase()
if (cookieSameSite !== 'lax' && cookieSameSite !== 'strict' && cookieSameSite !== 'none') {
  throw new Error('AUTH_COOKIE_SAME_SITE debe ser lax, strict o none.')
}
if (cookieSameSite === 'none' && !production) {
  throw new Error('AUTH_COOKIE_SAME_SITE=none requiere NODE_ENV=production (cookies Secure).')
}

export const env = {
  production,
  auth: { secret: jwtSecret, sessionSeconds, cookieSameSite },
  // Render define RENDER=true y exige escuchar en todas las interfaces.
  host: process.env.HOST?.trim() || (process.env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1'),
  port: port('PORT', '3000'),
  corsOrigins,
  trustProxy,
  mail: {
    host: process.env.SMTP_HOST?.trim() || '',
    port: port('SMTP_PORT', '587'),
    secure: smtpSecure,
    requireTLS: smtpRequireTLS,
    user: smtpUser,
    password: smtpPassword,
    from: mailFrom,
    publicAppUrl: publicAppUrl.replace(/\/$/, ''),
  },
  database: {
    host: databaseHost,
    port: port('DB_PORT'),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD,
    name: databaseName,
    ssl: databaseSSL
      ? {
          rejectUnauthorized: true,
          verifyIdentity: true,
          minVersion: 'TLSv1.2',
          ...(databaseCA ? { ca: databaseCA } : {}),
        }
      : undefined,
  },
} as const
