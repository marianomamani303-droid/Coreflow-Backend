export type DateFormat = 'dmy' | 'mdy' | 'iso'
export interface GeneralSettings {
  name: string
  sector: string | null
  description: string | null
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  currency: string
  timezone: string
  dateFormat: DateFormat
}
export interface InventorySettings {
  defaultMinimum: number
  alertsEnabled: boolean
  defaultView: 'all' | 'low' | 'zero' | 'available'
  productView: 'table' | 'cards'
  autoCreateBalances: boolean
  defaultCategory: string
}
export interface OrderSettings {
  initialStatus: 'pending' | 'processing'
  defaultView: 'all' | 'pending' | 'processing' | 'completed' | 'cancelled'
  afterSave: 'confirm' | 'new' | 'close'
  defaultWarehouseId: string | null
  defaultCustomerName: string
  defaultQuantity: number
  rememberWarehouse: boolean
}
export interface CompanySettings {
  version: number
  general: GeneralSettings
  inventory: InventorySettings
  orders: OrderSettings
  hasLogo: boolean
}
export interface UserPreferences {
  version: number
  density: 'comfortable' | 'compact'
  dateFormat: 'company' | DateFormat
  inventoryNotifications: boolean
}
export const defaultInventory: InventorySettings = {
  defaultMinimum: 0,
  alertsEnabled: true,
  defaultView: 'all',
  productView: 'table',
  autoCreateBalances: false,
  defaultCategory: '',
}
export const defaultOrders: OrderSettings = {
  initialStatus: 'pending',
  defaultView: 'all',
  afterSave: 'confirm',
  defaultWarehouseId: null,
  defaultCustomerName: 'Consumidor final',
  defaultQuantity: 1,
  rememberWarehouse: true,
}
export const defaultPreferences: UserPreferences = {
  version: 1,
  density: 'comfortable',
  dateFormat: 'company',
  inventoryNotifications: true,
}
