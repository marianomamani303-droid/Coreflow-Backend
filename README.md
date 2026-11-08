# CoreFlow — API

API Express 5 y TypeScript con persistencia MySQL/MariaDB/TiDB Cloud. Este repositorio contiene únicamente el backend: `package.json`, `src`, `database`, `scripts` y `tests` están en su raíz. Ver [despliegue en Render](docs/RENDER.md) y [configuración de TiDB](database/TIDB.md).

## Comandos

| Comando                            | Acción                                                         |
| ---------------------------------- | -------------------------------------------------------------- |
| `npm ci`                           | Instalar versiones del lockfile                                |
| `npm run dev`                      | Servidor de desarrollo con tsx                                 |
| `npm run typecheck`                | TypeScript estricto sin emitir archivos                        |
| `npm run build`                    | Compilar `src` a `dist`                                        |
| `npm start`                        | Ejecutar `dist/server.js` ya compilado                         |
| `npm run db:setup`                 | Crear tablas faltantes y aplicar migraciones 001–005           |
| `npm run db:verify`                | Consultar metadatos, sin modificar esquema ni datos            |
| `npm run db:check`                 | Probar SELECT 1 y consultas preparadas con el pool de la API   |
| `node scripts/check-repository.cjs` | Revisar archivos Git, secretos conocidos y submódulos accidentales |
| `npm test`                         | Compilar y ejecutar integración/seguridad con bases temporales |
| `npm run test:browser`             | Compilar y ejecutar seis escenarios Playwright                 |
| `npm run test:invitations`         | Subconjunto de integración, migraciones y correo               |
| `npm run test:invitations:db`      | Migraciones y restricciones de invitaciones                    |
| `npm run test:invitations:browser` | Flujo de invitación en navegador                               |

Requiere Node 22.12 o superior; usar Node 24 LTS. El backend no tiene una configuración ESLint propia: su comprobación estática disponible es TypeScript estricto.

## Configuración y pruebas

Usar `.env.example` para la aplicación y `.env.test.example` para un servidor SQL descartable. No sobrescribir un `.env` existente. `npm test` exige `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER` y `TEST_DB_PASSWORD` (puede ser vacía sólo en el servidor descartable). No utiliza las credenciales `DB_*` de negocio. Las pruebas crean y eliminan únicamente bases temporales generadas por ellas; no envían correo real.

Los valores `DB_SSL=true` y `DB_SSL_CA` habilitan TLS SQL con verificación de certificado e identidad. El pool usa UTC, `utf8mb4`, consultas múltiples deshabilitadas y límites de conexiones/cola. Los BIGINT se transportan como strings y los importes se calculan con centavos enteros.

Para TiDB Cloud, ver [parámetros, compatibilidad e instrucciones de hosting](database/TIDB.md).

En producción configurar `NODE_ENV=production`, `PUBLIC_APP_URL=https://...`, ese mismo origen en `CORS_ORIGINS` y una clave JWT aleatoria. Usar `TRUST_PROXY=loopback` únicamente con un proxy local controlado que sobrescriba cabeceras reenviadas. Detalles en [RENDER.md](docs/RENDER.md).

Las pruebas de navegador también requieren el frontend en una carpeta hermana `mi-proyecto`; ese código se mantiene en un repositorio separado y no se publica aquí.

## API y permisos

| Prefijo                                 | Función                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `/api/health`                           | Readiness SQL; 200 o 503, sin detalles privados                         |
| `/api/auth`                             | Registro, login, usuario actual y logout                                |
| `/api/companies`                        | Listado, creación y detalle de empresas accesibles                      |
| `/api/companies/:companyId/products`    | Consulta de catálogo; creación para owner/admin                         |
| `/api/companies/:companyId/inventory`   | Consulta, depósitos, mínimos y movimientos; mutaciones para owner/admin |
| `/api/companies/:companyId/employees`   | Equipo y administración de membresías; restricciones de rol             |
| `/api/companies/:companyId/orders`      | Pedidos; employee administra sólo sus propios pedidos                   |
| `/api/companies/:companyId/settings`    | Configuración y logo; mutaciones para owner/admin                       |
| `/api/companies/:companyId/invitations` | Gestión de invitaciones por administradores autorizados                 |
| `/api/invitations`                      | Previsualizar por token y responder con la cuenta destinataria          |
| `/api/me/preferences`                   | Preferencias del usuario autenticado                                    |

Las mutaciones requieren `X-CoreFlow-Request: 1`; si llega `Origin`, debe coincidir exactamente con `CORS_ORIGINS`. Todas las rutas privadas validan sesión, membresía y empresa activa en servidor. El cliente no decide el propietario ni los permisos. Owner es el único que puede administrar administradores. No se devuelven hashes de contraseña ni JWT en JSON.

Las cookies son HttpOnly, SameSite=Lax, Path=/ y Secure en producción. El inicio de sesión limita intentos fallidos; el registro cuenta también los éxitos. Los límites son locales al proceso. Logout elimina la cookie, sin revocar copias del JWT en servidor.

## Datos y migraciones

El esquema contiene 14 tablas y 24 claves foráneas en una instalación nueva. Las relaciones compuestas incluyen `company_id` para impedir referencias entre empresas. Las operaciones de stock, pedidos y cambios de permisos utilizan transacciones y bloqueos.

Las migraciones se ejecutan explícitamente y son repetibles; no se aplican al iniciar HTTP. Requieren respaldo, permisos DDL separados y ensayo en una copia de datos antes de producción. Los conflictos de invitaciones heredadas detienen la migración para revisión, sin eliminar registros: ver [database/INVITATIONS.md](database/INVITATIONS.md).

La migración 001 conserva `full_name=NULL` en usuarios anteriores cuando falta el dato. Completar esos nombres reales antes de una puesta en producción; no inventar identidades. Las órdenes antiguas sin depósito requieren revisión de inventario antes de cancelarlas.
