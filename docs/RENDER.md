# Desplegar el backend en Render

Este repositorio tiene `package.json` directamente en la raíz. No contiene el
frontend, archivos `.env`, claves privadas ni dependencias instaladas. Sí incluye el
CA raíz público de TiDB Cloud en `certs/isrgrootx1.pem` (ISRG Root X1).

## Servicio

Web Service de tipo Node desde la rama `main` de
`marianomamani303-droid/Coreflow-Backend`. `render.yaml` documenta la misma
configuración como Blueprint; un servicio creado a mano no lo lee.

| Campo | Valor |
| --- | --- |
| Root Directory | Vacío: la raíz del repositorio ya es el backend |
| Node | 24, definido en `.nvmrc` |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |

La compilación necesita TypeScript y los tipos de `devDependencies`; por eso el
build incluye `--include=dev` aunque `NODE_ENV=production`. `npm start` ejecuta
`node dist/server.js`; `dist` se genera en el build y no se publica en Git.

El servidor escucha en `HOST` (usar `0.0.0.0`; si falta, se usa `0.0.0.0` cuando
Render define `RENDER=true`) y en el `PORT` que asigna Render. No definir `PORT`.
El proceso sólo abre HTTP después de comprobar la conexión con TiDB: si `/healthz`
responde, la base estaba disponible al arrancar. `/api/health` verifica la base en
cada petición y responde `{"status":"ok","database":"ok"}` o 503 sin detalles.

## Variables de entorno

| Variable | Valor | Secreto |
| --- | --- | --- |
| `NODE_ENV` | `production` | No |
| `HOST` | `0.0.0.0` | No |
| `PUBLIC_APP_URL` | Origen HTTPS del frontend, p. ej. `https://timely-beignet-719e37.netlify.app` | No |
| `CORS_ORIGINS` | El mismo origen (varios separados por comas) | No |
| `AUTH_COOKIE_SAME_SITE` | `none` si el frontend llama directo a `*.onrender.com` | No |
| `TRUST_PROXY` | `uniquelocal` | No |
| `JWT_SECRET` | Clave aleatoria ≥ 32 bytes | **Sí** |
| `AUTH_SESSION_SECONDS` | `28800` | No |
| `DB_HOST` | Host de TiDB Cloud | No |
| `DB_PORT` | `4000` | No |
| `DB_USER` | Usuario de TiDB Cloud | **Sí** |
| `DB_PASSWORD` | Contraseña de TiDB Cloud | **Sí** |
| `DB_NAME` | `coreflow` | No |
| `DB_SSL` | `true` | No |
| `DB_SSL_CA` | `certs/isrgrootx1.pem` | No |

Opcionales para invitaciones por correo: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_REQUIRE_TLS`, `SMTP_USER` (secreto), `SMTP_PASSWORD` (secreto) y `MAIL_FROM`.

`PUBLIC_APP_URL` y `CORS_ORIGINS` admiten una barra final, pero no rutas. En
producción ambas deben ser HTTPS; si faltan o no coinciden, el proceso no arranca.
`TRUST_PROXY` no acepta `true` ni números de saltos: `uniquelocal` confía sólo en
proxies de redes privadas (la red interna de Render) para leer la IP real del
cliente en los límites de intentos.

## Cookies entre dominios

La sesión usa una cookie `HttpOnly` y `Secure` en producción. Con el frontend en otro
sitio (Netlify, Vercel) y `AUTH_COOKIE_SAME_SITE=none` se emite como
`SameSite=None; Secure; Partitioned`. Navegadores que bloquean todas las cookies de
terceros (Safari por defecto, modos estrictos) no la enviarán: para máxima
compatibilidad, publicar el frontend con un rewrite `/api/*` hacia Render (mismo
sitio) y dejar `AUTH_COOKIE_SAME_SITE=lax`. Configurar CORS por sí solo no cambia
`SameSite`.

## TiDB Cloud

- El clúster debe estar activo y permitir conexiones públicas desde Render
  (Networking → IP Access List, o permitir todos los orígenes con TLS obligatorio).
- TLS se valida siempre (`rejectUnauthorized`, `verifyIdentity`, TLS ≥ 1.2).
- Si falla la conexión, el log muestra sólo el código del driver, por ejemplo
  `ER_ACCESS_DENIED_ERROR` (usuario/contraseña), `ENOTFOUND` (host) o
  `ETIMEDOUT` (red o lista de IP), sin credenciales.
- Las migraciones no se ejecutan al arrancar. Para una base nueva, ejecutar
  `npm run db:setup` desde un entorno confiable.

## Verificación

```sh
npm ci
npm run build
node scripts/check-repository.cjs
```

Después del despliegue:

- `https://<servicio>.onrender.com/healthz` → 200 `{"status":"ok"}`
- `https://<servicio>.onrender.com/api/health` → 200 `{"status":"ok","database":"ok"}`

Hasta esa comprobación, el despliegue en Render no está verificado.

Documentación oficial: [Node/Express](https://render.com/docs/deploy-node-express-app),
[versión de Node](https://render.com/docs/node-version),
[variables y Secret Files](https://render.com/docs/configure-environment-variables)
y [puerto de escucha](https://render.com/docs/web-services#port-binding).
