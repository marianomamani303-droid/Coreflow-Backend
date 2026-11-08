import type { PoolConnection } from 'mysql2/promise'
import { companyTransaction, requireManager } from '../../shared/companyAccess'
import { HttpError } from '../../shared/errors/HttpError'
import * as repository from './settings.repository'
import type { parseGeneral, parseInventory, parseOrders } from './settings.validation'
import { requireActiveWarehouse } from '../orders/order.repository'
import type { UserPreferences } from './settings.types'

export const preferencesForUser = (userId: string) => repository.readPreferences(userId)
export const updatePreferencesForUser = (userId: string, value: UserPreferences) =>
  repository.savePreferences(userId, value)

export const settingsForUser = (userId: string, companyId: string) =>
  companyTransaction(userId, companyId, (connection) =>
    repository.readSettings(companyId, connection),
  )
function update(
  userId: string,
  companyId: string,
  version: number,
  work: (connection: PoolConnection) => Promise<void>,
) {
  return companyTransaction(userId, companyId, async (connection, role) => {
    requireManager(role)
    await repository.advanceVersion(connection, companyId, version)
    await work(connection)
    return repository.readSettings(companyId, connection)
  })
}
export function general(
  userId: string,
  companyId: string,
  value: ReturnType<typeof parseGeneral>,
) {
  return update(userId, companyId, value.version, async (connection) => {
    const previous = await repository.readSettings(companyId, connection)
    if (previous.general.currency !== value.currency && !value.confirmCurrencyChange)
      throw new HttpError(
        409,
        'Confirmá el cambio de moneda: los importes del catálogo no se convierten automáticamente.',
      )
    await repository.writeGeneral(connection, companyId, value)
  })
}
export function inventory(
  userId: string,
  companyId: string,
  value: ReturnType<typeof parseInventory>,
) {
  return update(userId, companyId, value.version, (connection) =>
    repository.writeInventory(connection, companyId, value),
  )
}
export function orders(
  userId: string,
  companyId: string,
  value: ReturnType<typeof parseOrders>,
) {
  return update(userId, companyId, value.version, async (connection) => {
    if (value.defaultWarehouseId)
      await requireActiveWarehouse(connection, companyId, value.defaultWarehouseId)
    await repository.writeOrders(connection, companyId, value)
  })
}
export function logo(
  userId: string,
  companyId: string,
  data: Buffer | null,
  version: number,
) {
  return update(userId, companyId, version, (connection) =>
    repository.writeLogo(connection, companyId, data),
  )
}
export const logoForUser = (userId: string, companyId: string) =>
  companyTransaction(userId, companyId, async (connection) => {
    const data = await repository.readLogo(connection, companyId)
    if (!data) throw new HttpError(404, 'Esta empresa no tiene logo.')
    return data
  })
