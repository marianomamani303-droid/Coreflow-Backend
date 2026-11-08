import { HttpError } from '../../shared/errors/HttpError'
import { identifier, integer, objectBody, text } from '../../shared/validation'
import type {
  GeneralSettings,
  InventorySettings,
  OrderSettings,
  UserPreferences,
} from './settings.types'

function choice<T extends string>(value: unknown, values: readonly T[]): T {
  const found = values.find((option) => option === value)
  if (!found) throw new HttpError(400, 'La opción seleccionada no es válida.')
  return found
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new HttpError(400, 'La opción debe ser verdadera o falsa.')
  return value
}
function optional(value: unknown, label: string, max: number) {
  return value === null ? null : text(value, label, 0, max) || null
}
export function parseGeneral(
  value: unknown,
): GeneralSettings & { version: number; confirmCurrencyChange: boolean } {
  const body = objectBody(value, [
    'version',
    'name',
    'sector',
    'description',
    'contactEmail',
    'contactPhone',
    'address',
    'currency',
    'timezone',
    'dateFormat',
    'confirmCurrencyChange',
  ])
  const currency = text(body.currency, 'Moneda', 3, 3)
  if (!Intl.supportedValuesOf('currency').includes(currency))
    throw new HttpError(400, 'Elegí una moneda admitida.')
  const timezone = text(body.timezone, 'Zona horaria', 1, 64)
  try {
    new Intl.DateTimeFormat('es-AR', { timeZone: timezone }).format()
  } catch {
    throw new HttpError(400, 'La zona horaria no es válida.')
  }
  const contactEmail = optional(body.contactEmail, 'Correo de contacto', 254)
  const name = text(body.name, 'Nombre comercial', 2, 120)
  if (Array.from(name).length < 2)
    throw new HttpError(400, 'El nombre comercial debe tener al menos dos caracteres.')
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))
    throw new HttpError(400, 'El correo de contacto no es válido.')
  return {
    version: integer(body.version, 1),
    name,
    sector: optional(body.sector, 'Rubro', 80),
    description: optional(body.description, 'Descripción', 1000),
    contactEmail,
    contactPhone: optional(body.contactPhone, 'Teléfono', 40),
    address: optional(body.address, 'Dirección', 255),
    currency,
    timezone,
    dateFormat: choice(body.dateFormat, ['dmy', 'mdy', 'iso']),
    confirmCurrencyChange:
      body.confirmCurrencyChange === undefined
        ? false
        : boolean(body.confirmCurrencyChange),
  }
}
export function parseInventory(value: unknown): InventorySettings & { version: number } {
  const body = objectBody(value, [
    'version',
    'defaultMinimum',
    'alertsEnabled',
    'defaultView',
    'productView',
    'autoCreateBalances',
    'defaultCategory',
  ])
  return {
    version: integer(body.version, 1),
    defaultMinimum: integer(body.defaultMinimum),
    alertsEnabled: boolean(body.alertsEnabled),
    defaultView: choice(body.defaultView, ['all', 'low', 'zero', 'available']),
    productView: choice(body.productView, ['table', 'cards']),
    autoCreateBalances: boolean(body.autoCreateBalances),
    defaultCategory: text(body.defaultCategory, 'Categoría predeterminada', 0, 80),
  }
}
export function parseOrders(value: unknown): OrderSettings & { version: number } {
  const body = objectBody(value, [
    'version',
    'initialStatus',
    'defaultView',
    'afterSave',
    'defaultWarehouseId',
    'defaultCustomerName',
    'defaultQuantity',
    'rememberWarehouse',
  ])
  return {
    version: integer(body.version, 1),
    initialStatus: choice(body.initialStatus, ['pending', 'processing']),
    defaultView: choice(body.defaultView, [
      'all',
      'pending',
      'processing',
      'completed',
      'cancelled',
    ]),
    afterSave: choice(body.afterSave, ['confirm', 'new', 'close']),
    defaultWarehouseId:
      body.defaultWarehouseId === null ? null : identifier(body.defaultWarehouseId),
    defaultCustomerName: text(body.defaultCustomerName, 'Cliente predeterminado', 1, 160),
    defaultQuantity: integer(body.defaultQuantity, 1, 1000000),
    rememberWarehouse: boolean(body.rememberWarehouse),
  }
}
export function parsePreferences(value: unknown): UserPreferences {
  const body = objectBody(value, [
    'version',
    'density',
    'dateFormat',
    'inventoryNotifications',
  ])
  return {
    version: integer(body.version, 1),
    density: choice(body.density, ['comfortable', 'compact']),
    dateFormat: choice(body.dateFormat, ['company', 'dmy', 'mdy', 'iso']),
    inventoryNotifications: boolean(body.inventoryNotifications),
  }
}
