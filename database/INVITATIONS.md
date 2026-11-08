# Datos y funcionamiento de invitaciones

El esquema inicial y las migraciones 004–005 preparan `company_invitations`.
El módulo `src/features/invitations` implementa rutas HTTP, envío SMTP,
verificación del correo y aceptación transaccional. Crear una invitación no crea
una cuenta ni una membresía. Los comandos de pruebas y configuración
están en el [README del backend](../README.md).

## Aplicación

Desde `CoreFlow Backend`, con el servidor SQL de `.env` disponible:

```powershell
npm run db:setup
npm run db:verify
```

Para aplicar únicamente esta ampliación a una base ya preparada hasta 003,
seleccioná esa base y ejecutá `migrations/004_invitations.sql` y
`migrations/005_invitation_delivery_lock.sql` con tu cliente SQL, en ese orden.
No lleva `USE coreflow`: respeta la base seleccionada. Para instalaciones nuevas,
`schema.sql` ya contiene la estructura final. Las migraciones son repetibles.

## Campos

| Campo | Uso |
| --- | --- |
| `id`, `company_id` | Identidad de invitación y empresa. BIGINT: tratarlos como strings en la API. |
| `email` | Correo invitado; guardar con `trim().toLowerCase()`. No depende de una cuenta existente. |
| `role` | `admin` o `employee`; el backend debe autorizar el rol. |
| `department`, `job_title` | Textos opcionales de hasta 80 y 100 caracteres. Copiarlos a la membresía al aceptar. |
| `token_hash` | SHA-256 binario de 32 bytes, único. Generar el token aleatorio en el backend; guardar el Buffer del hash, nunca el token original. |
| `invited_by` | Usuario que invita; debe tener una membresía en esa misma empresa. La FK no comprueba que esté activa ni su rol. |
| `accepted_by`, `accepted_at` | Usuario y fecha de aceptación; ambos obligatorios cuando el estado es `accepted`, ambos NULL en los demás estados. |
| `status` | `pending`, `accepted`, `declined`, `revoked`, `expired`. Inicial: `pending`. |
| `expires_at` | Vencimiento obligatorio y posterior a `created_at`. El backend fija 48 horas al crear o reenviar. |
| `created_at`, `updated_at` | Fechas UTC; `updated_at` se actualiza al cambiar una fila. |
| `pending_email` | Columna generada con el correo normalizado solo si está pendiente. No enviarla en INSERT ni UPDATE. |
| `delivery_status` | `not_sent`, `sent`, `failed`. Inicial: `not_sent`, es decir, sin envío registrado. `sent` significa aceptado por el servicio de correo, no entrega garantizada al destinatario. |
| `send_attempts` | Intentos de envío registrados; entero sin signo, inicialmente 0. |
| `last_send_attempt_at` | Fecha UTC del último intento. |
| `last_sent_at` | Fecha del último envío exitoso, NULL si no se registró ninguno. Se puede conservar si falla un reenvío posterior. |
| `last_send_error` | Código de error opcional, hasta 100 caracteres, por ejemplo `SMTP_TIMEOUT`. No guardar respuestas crudas del proveedor, credenciales ni enlaces con tokens. |
| `delivery_lock_id`, `delivery_locked_until` | Reserva interna de envío durante dos minutos. Deben estar ambas en NULL o ambas presentes. Nunca contienen el token de invitación. |

Para registrar `sent` o `failed` se requieren `send_attempts > 0` y
`last_send_attempt_at`. `sent` requiere además `last_sent_at`. Actualizar los
campos relacionados juntos. Un envío exitoso debe limpiar `last_send_error`.
El estado de envío es independiente del estado de la invitación.

## Unicidad, vencimiento y reenvíos

`uq_invitations_pending (company_id, pending_email)` impide dos invitaciones
pendientes al mismo correo dentro de una empresa, incluso con mayúsculas,
espacios exteriores o solicitudes simultáneas. Permite invitar al mismo correo
a empresas diferentes y conservar múltiples invitaciones cerradas.

El tiempo por sí solo no cambia `status`. Antes de crear otra invitación para
el mismo correo, el servicio debe marcar como `expired` las pendientes vencidas.
La aceptación debe comprobar siempre `expires_at > UTC_TIMESTAMP(6)`, aunque
no se haya ejecutado una tarea de vencimientos. `idx_invitations_expiry
(status, expires_at)` permite buscar esos registros.

Para reenviar una invitación vigente, actualizar la misma fila con un token nuevo
y su vencimiento, e incrementar los intentos cuando se intente enviar. Esto
invalida el enlace anterior. Coordinar los reenvíos para que dos solicitudes no
manden enlaces contradictorios. La tabla conserva los datos del último intento
y el contador, no un historial de cada correo ni una cola de envío.

## Aceptación implementada en el backend

1. Iniciar una transacción y bloquear la empresa y la invitación de forma
   consistente con los demás cambios de permisos del proyecto.
2. Comprobar token, estado pendiente, vencimiento y empresa activa.
3. Comprobar una sesión activa cuyo correo normalizado coincida con el invitado.
   Leer usuario, empresa y rol desde datos confiables, no desde el body.
   Antes de aceptar, `/api/invitations/verify-email` usa la posesión del enlace
   recibido y esa sesión para registrar `users.email_verified_at`. La aceptación
   rechaza cuentas que todavía no tienen esa fecha. La pantalla pide confirmación
   explícita y realiza ambas solicitudes en ese orden.
4. Volver a comprobar la membresía y los permisos actuales del remitente.
   Solo el propietario puede invitar administradores.
5. Comprobar si ya existe una membresía para el destinatario. No reactivar una
   membresía suspendida ni cambiar sus permisos automáticamente.
6. Insertar la membresía con rol, área y puesto de la invitación y actualizar
   `status = 'accepted'`, `accepted_by` y `accepted_at` en la misma transacción.
7. Confirmar; ante cualquier fallo, hacer rollback. Gestionar reintentos de
   una aceptación ya completada sin duplicar membresías.

El invitado todavía no pertenece a la empresa: `companyTransaction` exige
pertenencia del usuario que lo llama. Por eso la aceptación usa `withToken`,
una transacción que autoriza mediante la invitación y bloquea la empresa antes
de modificar invitación y membresía.

Los CHECK y las FK garantizan integridad de almacenamiento. El servicio comprueba
coincidencia de correo, permisos, transiciones y vencimiento, y crea la membresía
junto con la aceptación. Los reenvíos tienen un minuto de espera y un máximo de
cinco intentos registrados. Se reintenta automáticamente una sola vez si la
conexión falla antes de enviar el mensaje; un timeout después de DATA no se repite
automáticamente para reducir duplicados.

## Datos existentes

No se borran filas ni se corrigen estados automáticamente. Los campos nuevos
opcionales quedan en NULL y el seguimiento de correo empieza en `not_sent`/0:
no implica que una invitación antigua nunca haya sido enviada.

Si existen conflictos, las nuevas restricciones rechazan su creación. Estas
consultas ayudan a revisarlos sin mostrar tokens:

```sql
SELECT company_id, LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS total
FROM company_invitations
WHERE status = 'pending'
GROUP BY company_id, LOWER(TRIM(email))
HAVING COUNT(*) > 1;

SELECT id, status, accepted_by, accepted_at
FROM company_invitations
WHERE (status = 'accepted' AND (accepted_by IS NULL OR accepted_at IS NULL))
   OR (status <> 'accepted' AND (accepted_by IS NOT NULL OR accepted_at IS NOT NULL));

SELECT id FROM company_invitations WHERE CHAR_LENGTH(TRIM(email)) <= 3;
```

La aplicación de DDL no es atómica: si una restricción falla, pueden haber quedado
columnas agregadas. Resolver los conflictos explícitamente y volver a ejecutar
la migración; las partes ya aplicadas se omiten.

## Verificación

`db:verify` comprueba los campos nuevos, la columna generada, restricciones e
índices y reserva de envío. `npm run test:invitations:db` usa bases temporales
`coreflow_invitations_test_*` y las elimina al terminar. Cubre instalación nueva,
migración anterior repetida, conservación de datos, duplicados simultáneos,
restricciones, seguimiento de correo y detección de índices faltantes.

`npm run test:invitations` agrega pruebas HTTP de permisos, aceptación, reenvíos,
concurrencia y SMTP local. `npm run test:invitations:browser` recorre el flujo con
React y un buzón SMTP aislado. No se usan correos reales para estas pruebas.
