import { companyForUser } from '../companies/companies.service'
import { companyTransaction, requireManager } from '../../shared/companyAccess'
import { HttpError } from '../../shared/errors/HttpError'
import * as repository from './inventory.repository'
import type { BalanceInput, MovementInput, HistoryFilters } from './inventory.types'

export async function inventoryForUser(userId: string, companyId: string) {
  await companyForUser(userId, companyId)
  const [inventory, warehouses] = await Promise.all([
    repository.listInventory(companyId),
    repository.listWarehouses(companyId),
  ])
  return { inventory, warehouses }
}
export async function movementsForUser(
  userId: string,
  companyId: string,
  filters: HistoryFilters,
) {
  await companyForUser(userId, companyId)
  return repository.listMovements(companyId, filters)
}
export async function createWarehouse(userId: string, companyId: string, name: string) {
  try {
    return await companyTransaction(userId, companyId, async (c, role) => {
      requireManager(role)
      return repository.insertWarehouse(c, companyId, name)
    })
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ER_DUP_ENTRY'
    ) {
      throw new HttpError(409, 'Ya existe un depósito con ese nombre.')
    }
    throw error
  }
}
export async function setMinimum(userId: string, companyId: string, input: BalanceInput) {
  return companyTransaction(userId, companyId, async (c, role) => {
    requireManager(role)
    await repository.lockBalance(c, companyId, input.productId, input.warehouseId)
    await repository.updateMinimum(
      c,
      companyId,
      input.productId,
      input.warehouseId,
      input.minimum,
    )
  })
}
export async function recordMovement(
  userId: string,
  companyId: string,
  input: MovementInput,
) {
  return companyTransaction(userId, companyId, async (c, role) => {
    requireManager(role)
    const current = await repository.lockBalance(
      c,
      companyId,
      input.productId,
      input.warehouseId,
      input.type !== 'inbound',
    )
    const delta =
      input.type === 'adjustment'
        ? input.quantity - current
        : input.type === 'outbound'
          ? -input.quantity
          : input.quantity
    const next = current + delta
    if (next < 0) throw new HttpError(409, 'Stock insuficiente para registrar la salida.')
    if (next > 2147483647 || Math.abs(delta) > 2147483647)
      throw new HttpError(400, 'El saldo excede el límite permitido.')
    if (delta === 0)
      throw new HttpError(
        409,
        'El conteo coincide con el saldo actual; no hay un ajuste para registrar.',
      )
    return repository.writeMovement(c, companyId, userId, input, delta, next)
  })
}
