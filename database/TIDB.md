# CoreFlow con TiDB Cloud

La aplicación usa `src/config/env.ts` y un único pool `mysql2/promise` en
`src/config/database.ts`. Los repositorios y el frontend conservan su organización.

## Configuración local

Los parámetros de la captura son:

| Parámetro | Valor |
| --- | --- |
| HOST | `gateway01.sa-east-1.prod.aws.tidbcloud.com` |
| PORT | `4000` |
| USERNAME | Configurado localmente; obtenerlo desde TiDB Cloud |
| DATABASE de la captura | `sys` (base del sistema; no se utiliza) |
| Base de la aplicación | `coreflow` (nombre del esquema existente) |

La contraseña queda únicamente en `.env`. La configuración XAMPP anterior se
conserva en `.env.xampp`. Ambos archivos están excluidos de Git.
El certificado público adjunto se copió a `certs/isrgrootx1.pem`, también excluido.
No se necesita una clave privada del cliente.

```dotenv
DB_HOST=gateway01.sa-east-1.prod.aws.tidbcloud.com
DB_PORT=4000
DB_USER=your_tidb_user
DB_NAME=coreflow
DB_SSL=true
DB_SSL_CA=certs/isrgrootx1.pem
```

Agregar `DB_PASSWORD` mediante el gestor de secretos o el `.env` local.
Se verifican CA y nombre DNS (`rejectUnauthorized=true`, `verifyIdentity=true`)
con TLS mínimo 1.2. Un error TLS debe corregirse sin desactivar estas validaciones.

Las variables del proceso tienen prioridad sobre `.env`. Para volver temporalmente
a XAMPP, configurar `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_USER=root`,
la contraseña local, `DB_NAME=coreflow`, `DB_SSL=false` y `DB_SSL_CA` vacía.
Consultar `.env.xampp` para recuperar los valores originales. Esto no copia datos
entre los dos servidores.

## Esquema e importación

Ejecutar desde la carpeta backend:

```sh
npm ci
npm run db:setup
npm run db:verify
npm run db:check
npm start
```

`db:setup` crea `coreflow` si falta, aplica el esquema y las migraciones 001–005,
y verifica 14 tablas, 24 claves foráneas y las 49 restricciones CHECK/FK.
No ejecuta DROP, TRUNCATE, DELETE ni reemplaza filas. El DDL no es una transacción
atómica; si se interrumpe, corregir el error y repetir el comando. Para una base
con datos, respaldar y ensayar las migraciones antes de ejecutarlas.
Los datos que ya estén en XAMPP no se transfieren con este comando.

Compatibilidad comprobada con `8.0.11-TiDB-v8.5.3-serverless`:

- TiDB necesita `tidb_enable_check_constraint=ON` antes de crear restricciones.
  El comando de preparación lo habilita si hace falta; la verificación solo lo lee.
  Esta operación requiere permisos de administración para la preparación inicial.
- Las migraciones consultan `INFORMATION_SCHEMA.CHECK_CONSTRAINTS` para detectar
  CHECK existentes. TiDB 8.5 no los incluye en `TABLE_CONSTRAINTS`; la verificación
  usa también `TIDB_CHECK_CONSTRAINTS`.
- `fk_invitations_recipient` usa la acción restrictiva predeterminada, equivalente
  a RESTRICT, porque TiDB rechaza las cláusulas explícitas sobre `accepted_by`
  cuando la columna también participa en un CHECK. Se conservan ambas restricciones.
- Se mantienen las columnas generadas STORED, ENUM, DECIMAL, BIGINT, utf8mb4,
  las claves compuestas, los índices y las sesiones UTC.

Referencias oficiales: [mysql2 y TLS](https://docs.pingcap.com/developer/dev-guide-sample-application-nodejs-mysql2/),
[CHECK](https://docs.pingcap.com/tidb/stable/constraints/) y
[acciones de claves foráneas](https://docs.pingcap.com/tidb/stable/foreign-key/).

## Validación realizada

- `npm run build`: compilación TypeScript correcta.
- `npm run db:check`: `SELECT 1 = 1` sobre `coreflow`, consulta preparada desde
  el pool y TLS 1.3 con `authorized=true`.
- `db:setup` repetido y `db:verify`: 14 tablas, 24 FK y 25 CHECK presentes.
- `node --test tests/infrastructure.test.cjs`: 6 pruebas aprobadas contra TiDB,
  incluyendo HTTP `/api/health` con estado 200, UTC y manejo de indisponibilidad.
- Intentos de INSERT inválidos en una transacción: TiDB rechazó el CHECK con
  `ER_CHECK_CONSTRAINT_VIOLATED` y la FK con `ER_NO_REFERENCED_ROW_2`.
  Se hizo rollback; no quedaron filas de validación.
- Comprobaciones de configuración: rechazo de `DB_NAME=sys` y TiDB sin TLS;
  aceptación del perfil local mediante variables del proceso.
- `node scripts/check-repository.cjs` desde la raíz: sin secretos detectados.
  `.env`, `.env.xampp` y el PEM están ignorados y no están versionados.

No se ejecutó la suite completa de negocio ni se transfirieron datos de XAMPP.

## Archivos modificados o creados

Rutas relativas a `CoreFlow Backend`:

| Archivos | Cambio |
| --- | --- |
| `.env` | Conexión TiDB y contraseña local; ignorado por Git |
| `.env.xampp` | Copia de la configuración anterior; ignorada por Git |
| `certs/isrgrootx1.pem` | Copia del CA adjunto; ignorada por Git |
| `src/config/database.ts` | Pool de promesas, inicialización UTC y timeout de conexión remota |
| `src/config/env.ts` | TLS mínimo 1.2, TLS obligatorio en TiDB y rechazo de bases del sistema |
| `src/server.ts` | Mensaje de fallo válido también para SQL remoto |
| `scripts/database.cjs` | Preparación y verificación compatibles con metadatos de TiDB |
| `scripts/check-database.cjs` | Prueba reproducible del pool, TLS y SELECT 1 |
| `database/schema.sql` | Compatibilidad del CHECK/FK de invitaciones |
| `database/migrations/002_orders.sql` | Detección portable de CHECK existente |
| `database/migrations/004_invitations.sql` | Detección portable de CHECK existentes |
| `database/migrations/005_invitation_delivery_lock.sql` | Detección portable de CHECK existente |
| `package.json` | Comando `db:check` |
| `.env.example` | Plantilla TiDB sin contraseña y alternativa local |
| `.gitignore` | Exclusión de certificados y claves también al usar solo el backend |
| `README.md`, `database/TIDB.md` | Uso, validación y configuración del hosting |

## Hosting

Configurar un servicio Node con directorio raíz vacío (este repositorio ya es el backend), Node 24 LTS,
build `npm ci --include=dev && npm run build`, inicio `npm start` y health `/api/health`.
Aplicar `npm run db:setup` una vez desde un entorno confiable antes del inicio;
las migraciones no se ejecutan en cada arranque HTTP.

Variables de base: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
`DB_SSL=true`, `DB_SSL_CA`. Subir el CA público como archivo del proveedor y usar
su ruta real en `DB_SSL_CA`; no usar una ruta de Windows en Linux.

Variables de aplicación: `NODE_ENV=production`, `HOST=0.0.0.0`, el `PORT` asignado
por el proveedor, `JWT_SECRET` aleatorio de al menos 32 bytes,
`PUBLIC_APP_URL` con el origen HTTPS real del frontend y ese mismo origen en
`CORS_ORIGINS`. Ajustar `TRUST_PROXY` a las IP/subredes documentadas del proveedor;
ver [despliegue en Render](../docs/RENDER.md). Configurar las variables SMTP existentes
si se utilizará el envío de invitaciones.

Para el runtime usar preferentemente un usuario de TiDB limitado a SELECT, INSERT,
UPDATE y DELETE sobre `coreflow`; reservar la cuenta con DDL para migraciones.
El proveedor debe permitir salida TCP al puerto 4000 y TiDB debe permitir su origen.
La conexión a TiDB elimina la dependencia de XAMPP para SQL. La API seguirá
dependiendo de la computadora hasta desplegar el proceso Node en el hosting.
No se realizó un despliegue ni se modificó el frontend en esta tarea.
