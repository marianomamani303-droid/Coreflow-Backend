const { execFileSync } = require('node:child_process')
const { readFileSync, existsSync, readdirSync } = require('node:fs')
const { resolve, join } = require('node:path')
const dotenv = require('dotenv')

const root = resolve(__dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))]
const findings = []
const secrets = []

for (const name of readdirSync(root).filter((name) => /^\.env(?:\.|$)/.test(name) && !name.endsWith('.example'))) {
  const values = dotenv.parse(readFileSync(join(root, name)))
  for (const [key, value] of Object.entries(values)) {
    if (/(?:PASSWORD|SECRET|TOKEN|API_KEY)$|^(?:DB_USER|SMTP_USER)$/.test(key) && value.length >= 8) {
      secrets.push(value)
    }
  }
}

for (const entry of git('ls-files', '--stage', '-z').split('\0')) {
  if (entry.startsWith('160000 ')) findings.push(`${entry.split('\t')[1]}: submódulo accidental`)
}

// Único PEM permitido: el CA raíz público ISRG Root X1 que exige TiDB Cloud.
const publicCA = 'certs/isrgrootx1.pem'
const publicCAFingerprint =
  '96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6'

for (const file of files) {
  if (file === publicCA) {
    const pem = readFileSync(resolve(root, file), 'utf8')
    const { X509Certificate } = require('node:crypto')
    let fingerprint = ''
    try { fingerprint = new X509Certificate(pem).fingerprint256 } catch {}
    if (/PRIVATE KEY/.test(pem) || fingerprint !== publicCAFingerprint)
      findings.push(`${file}: no es el CA público ISRG Root X1`)
    continue
  }
  if (
    /(^|\/)(node_modules|dist|logs|coverage|backups|\.audit|\.git)(\/|$)/.test(file) ||
    (/(^|\/)\.env(?:\.|$)/.test(file) && !/\.env(?:\.test)?\.example$/.test(file)) ||
    /\.(?:pem|key|p12|pfx|dump|bak|db|sqlite3?|sql\.gz|sql\.zip)$/.test(file) ||
    /(^|\/)\.npmrc$/.test(file) ||
    (file.endsWith('.sql') && !/^database\/(schema\.sql|migrations\/[^/]+\.sql)$/.test(file))
  ) {
    findings.push(`${file}: archivo privado o generado incluido`)
    continue
  }
  const path = resolve(root, file)
  if (!existsSync(path)) continue
  const content = readFileSync(path, 'utf8')
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) ||
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/.test(content) ||
    secrets.some((secret) => content.includes(secret))
  ) findings.push(`${file}: posible secreto; revisar antes de publicar`)
}

for (const file of ['.env', '.env.xampp', '.env.test', 'certs/private.pem', 'certs/server.key', 'node_modules/example', 'dist/example', 'database/backups/example.sql']) {
  try { git('check-ignore', '--quiet', '--no-index', file) }
  catch { findings.push(`${file}: no está protegido por .gitignore`) }
}

if (findings.length) {
  console.error(findings.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Repositorio backend: ${files.length} archivos revisados; sin secretos conocidos, archivos privados ni submódulos. Revisión heurística.`)
}
