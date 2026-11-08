# Desplegar el backend en Render

Este repositorio tiene `package.json` directamente en la raíz. No contiene el
frontend, archivos `.env`, certificados ni dependencias instaladas.

## Servicio

Crear un Web Service de tipo Node desde la rama `main` de
`marianomamani303-droid/Coreflow-Backend`.

| Campo | Valor |
| --- | --- |
| Root Directory | Dejar vacío: la raíz del repositorio ya es el backend |
| Node | 24 LTS, definido en `.nvmrc` |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

La compilación necesita TypeScript y los paquetes de tipos de `devDependencies`.
Por eso el build incluye `--include=dev`, incluso con `NODE_ENV=production`.
El runtime ejecuta `dist/server.js`; `dist` se genera en el build y no se publica
en Git. El proveedor asigna `PORT`; el backend lo lee del entorno.

## Variables y certificado

Cargar las variables desde Environment en el panel de Render. `.env.example`
es solo una plantilla y no contiene contraseñas válidas. Usar los valores locales
de `.env` para `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`.
Además configurar:

| Variable | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `DB_SSL` | `true` |
| `DB_SSL_CA` | `/etc/secrets/isrgrootx1.pem` |
| `JWT_SECRET` | Clave aleatoria de al menos 32 bytes, guardada como secreto |
| `PUBLIC_APP_URL` | Origen HTTPS real del frontend, sin rutas |
| `CORS_ORIGINS` | Incluir exactamente ese origen HTTPS |
| `TRUST_PROXY` | IP/subredes de proxies confiables según la configuración real |

En Environment → Secret Files crear `isrgrootx1.pem` y pegar el contenido del
CA público que se conserva localmente en `certs/isrgrootx1.pem`. Render lo expone
en `/etc/secrets/isrgrootx1.pem`. No usar la ruta de Windows ni desactivar TLS.
Las credenciales y el CA permanecen fuera de GitHub.

No configurar `TRUST_PROXY=true` ni un número de saltos. La lista de proxies debe
corresponder al tráfico real del proveedor para que los límites por IP funcionen.
Si se usarán invitaciones por correo, completar también `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD` y `MAIL_FROM`.

La autenticación usa cookies `HttpOnly`, `Secure` (en producción) y, por defecto,
`SameSite=Lax`. Con `Lax` el frontend y la API deben integrarse bajo el mismo sitio
HTTPS (dominios propios adecuados o un rewrite `/api/*` del hosting del frontend).
Configurar CORS por sí solo no cambia `SameSite`.

Si el frontend se publica en otro dominio y llama directamente a
`https://<servicio>.onrender.com` (por ejemplo `VITE_API_URL` apuntando a Render),
configurar `AUTH_COOKIE_SAME_SITE=none`. La cookie se emite entonces como
`SameSite=None; Secure; Partitioned`. Aun así, navegadores que bloquean todas las
cookies de terceros (Safari por defecto, modos estrictos) no enviarán la sesión; para
máxima compatibilidad preferir el rewrite del mismo sitio con `SameSite=Lax`.

## Base de datos y verificación

El esquema de TiDB ya se preparó durante la configuración local. Para una base
nueva, ejecutar `npm run db:setup` desde un entorno confiable antes del despliegue.
Las migraciones no se ejecutan automáticamente al arrancar HTTP. No se necesitan
archivos ni servicios XAMPP en Render.

Validaciones locales disponibles:

```sh
npm run build
node scripts/check-repository.cjs
npm run db:verify
npm run db:check
node --test tests/infrastructure.test.cjs
```

Para integración completa usar `.env.test.example` y un servidor SQL descartable.
No apuntar la suite completa a los datos de producción. Las pruebas de navegador
requieren además el frontend separado en `../mi-proyecto`.

Después del despliegue comprobar la URL pública `/api/health`: debe responder
HTTP 200 con `{"status":"ok","database":"ok"}`. Hasta esa comprobación, el despliegue
en Render no está verificado. El proceso de publicación en GitHub no crea un
servicio ni carga secretos automáticamente en Render.

Documentación oficial: [Node/Express](https://render.com/docs/deploy-node-express-app),
[versión de Node](https://render.com/docs/node-version),
[variables y Secret Files](https://render.com/docs/configure-environment-variables)
y [puerto de escucha](https://render.com/docs/web-services#port-binding).
