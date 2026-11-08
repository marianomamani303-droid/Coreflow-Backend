import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { pool } from '../../config/database'
import type {
  CompanySettings,
  GeneralSettings,
  InventorySettings,
  OrderSettings,
  UserPreferences,
} from './settings.types'
import { defaultInventory, defaultOrders, defaultPreferences } from './settings.types'
import { HttpError } from '../../shared/errors/HttpError'

type Reader = Pick<PoolConnection, 'execute'>
interface SettingsRow extends RowDataPacket {
  version: number
  date_format: GeneralSettings['dateFormat']
  default_minimum: number
  inventory_alerts: number
  inventory_view: InventorySettings['defaultView']
  product_view: InventorySettings['productView']
  auto_create_balances: number
  default_category: string
  order_initial_status: OrderSettings['initialStatus']
  order_view: OrderSettings['defaultView']
  order_after_save: OrderSettings['afterSave']
  default_warehouse_id: string | null
  default_customer_name: string
  default_quantity: number
  remember_warehouse: number
}
interface PreferencesRow extends RowDataPacket {
  version: number
  density: UserPreferences['density']
  date_format: UserPreferences['dateFormat']
  inventory_notifications: number
}
export async function readOperationalSettings(
  companyId: string,
  connection: Reader = pool,
) {
  const [rows] = await connection.execute<SettingsRow[]>(
    'SELECT * FROM company_settings WHERE company_id = ?',
    [companyId],
  )
  const row = rows[0]
  return {
    version: Number(row?.version ?? 1),
    dateFormat: row?.date_format ?? ('dmy' as const),
    inventory: row
      ? {
          defaultMinimum: Number(row.default_minimum),
          alertsEnabled: !!row.inventory_alerts,
          defaultView: row.inventory_view,
          productView: row.product_view,
          autoCreateBalances: !!row.auto_create_balances,
          defaultCategory: row.default_category,
        }
      : { ...defaultInventory },
    orders: row
      ? {
          initialStatus: row.order_initial_status,
          defaultView: row.order_view,
          afterSave: row.order_after_save,
          defaultWarehouseId:
            row.default_warehouse_id === null ? null : String(row.default_warehouse_id),
          defaultCustomerName: row.default_customer_name,
          defaultQuantity: Number(row.default_quantity),
          rememberWarehouse: !!row.remember_warehouse,
        }
      : { ...defaultOrders },
  }
}
export async function readSettings(
  companyId: string,
  connection: Reader = pool,
): Promise<CompanySettings> {
  const [rows] = await connection.execute<
    (RowDataPacket & Omit<GeneralSettings, 'dateFormat'> & { hasLogo: number })[]
  >(
    `SELECT name, sector, description, contact_email AS contactEmail, contact_phone AS contactPhone,
      address, currency, timezone, logo_data IS NOT NULL AS hasLogo FROM companies WHERE id = ?`,
    [companyId],
  )
  if (!rows[0]) throw new HttpError(404, 'Empresa no encontrada.')
  const { hasLogo, ...general } = rows[0]
  const operational = await readOperationalSettings(companyId, connection)
  return {
    version: operational.version,
    general: { ...general, dateFormat: operational.dateFormat },
    hasLogo: !!hasLogo,
    inventory: operational.inventory,
    orders: operational.orders,
  }
}
/** El bloqueo de empresa ya serializa todas las escrituras de sus módulos. */
export async function advanceVersion(
  connection: PoolConnection,
  companyId: string,
  version: number,
) {
  await connection.execute(
    'INSERT INTO company_settings (company_id) VALUES (?) ON DUPLICATE KEY UPDATE company_id = VALUES(company_id)',
    [companyId],
  )
  const current = await readOperationalSettings(companyId, connection)
  if (current.version !== version)
    throw new HttpError(
      409,
      'La configuración cambió en otra sesión. Actualizá los datos antes de guardar.',
    )
  await connection.execute(
    'UPDATE company_settings SET version = version + 1 WHERE company_id = ?',
    [companyId],
  )
}
export async function writeGeneral(
  connection: PoolConnection,
  companyId: string,
  value: GeneralSettings,
) {
  await connection.execute(
    `UPDATE companies SET name = ?, sector = ?, description = ?, contact_email = ?, contact_phone = ?, address = ?, currency = ?, timezone = ? WHERE id = ?`,
    [
      value.name,
      value.sector,
      value.description,
      value.contactEmail,
      value.contactPhone,
      value.address,
      value.currency,
      value.timezone,
      companyId,
    ],
  )
  await connection.execute(
    'UPDATE company_settings SET date_format = ? WHERE company_id = ?',
    [value.dateFormat, companyId],
  )
}
export async function writeInventory(
  connection: PoolConnection,
  companyId: string,
  value: InventorySettings,
) {
  await connection.execute(
    `UPDATE company_settings SET default_minimum = ?, inventory_alerts = ?, inventory_view = ?, product_view = ?, auto_create_balances = ?, default_category = ? WHERE company_id = ?`,
    [
      value.defaultMinimum,
      value.alertsEnabled,
      value.defaultView,
      value.productView,
      value.autoCreateBalances,
      value.defaultCategory,
      companyId,
    ],
  )
}
export async function writeOrders(
  connection: PoolConnection,
  companyId: string,
  value: OrderSettings,
) {
  await connection.execute(
    `UPDATE company_settings SET order_initial_status = ?, order_view = ?, order_after_save = ?, default_warehouse_id = ?, default_customer_name = ?, default_quantity = ?, remember_warehouse = ? WHERE company_id = ?`,
    [
      value.initialStatus,
      value.defaultView,
      value.afterSave,
      value.defaultWarehouseId,
      value.defaultCustomerName,
      value.defaultQuantity,
      value.rememberWarehouse,
      companyId,
    ],
  )
}
export async function writeLogo(
  connection: PoolConnection,
  companyId: string,
  data: Buffer | null,
) {
  await connection.execute(
    'UPDATE companies SET logo_data = ?, logo_mime = ? WHERE id = ?',
    [data, data ? 'image/png' : null, companyId],
  )
}
export async function readLogo(connection: Reader, companyId: string) {
  const [rows] = await connection.execute<(RowDataPacket & { data: Buffer | null })[]>(
    'SELECT logo_data AS data FROM companies WHERE id = ?',
    [companyId],
  )
  return rows[0]?.data ?? null
}
export async function readPreferences(
  userId: string,
  connection: Reader = pool,
): Promise<UserPreferences> {
  const [rows] = await connection.execute<PreferencesRow[]>(
    'SELECT version, density, date_format, inventory_notifications FROM user_preferences WHERE user_id = ?',
    [userId],
  )
  const row = rows[0]
  return row
    ? {
        version: Number(row.version),
        density: row.density,
        dateFormat: row.date_format,
        inventoryNotifications: !!row.inventory_notifications,
      }
    : { ...defaultPreferences }
}
export async function savePreferences(userId: string, value: UserPreferences) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [users] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM users WHERE id = ? AND status = 'active' FOR UPDATE",
      [userId],
    )
    if (!users[0]) throw new HttpError(401, 'Tu sesión ya no está disponible.')
    const previous = await readPreferences(userId, connection)
    if (previous.version !== value.version)
      throw new HttpError(
        409,
        'Tus preferencias cambiaron en otra sesión. Actualizá antes de guardar.',
      )
    await connection.execute(
      `INSERT INTO user_preferences (user_id, version, density, date_format, inventory_notifications) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE version = VALUES(version), density = VALUES(density), date_format = VALUES(date_format), inventory_notifications = VALUES(inventory_notifications)`,
      [
        userId,
        previous.version + 1,
        value.density,
        value.dateFormat,
        value.inventoryNotifications,
      ],
    )
    const result = await readPreferences(userId, connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
