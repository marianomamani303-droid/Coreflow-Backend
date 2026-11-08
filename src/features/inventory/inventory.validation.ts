import { HttpError } from '../../shared/errors/HttpError'
import { identifier, integer, objectBody, text } from '../../shared/validation'
import type { BalanceInput, MovementInput, HistoryFilters } from './inventory.types'

export function parseMovement(input: unknown): MovementInput {
  const b = objectBody(input, ['productId', 'warehouseId', 'type', 'quantity', 'reason'])
  if (b.type !== 'inbound' && b.type !== 'outbound' && b.type !== 'adjustment') {
    throw new HttpError(400, 'El tipo de movimiento no es válido.')
  }
  return {
    productId: identifier(b.productId),
    warehouseId: identifier(b.warehouseId),
    type: b.type,
    quantity: integer(b.quantity, b.type === 'adjustment' ? 0 : 1),
    reason: text(b.reason, 'Motivo', 3, 255),
  }
}
export function parseMinimum(input: unknown): BalanceInput {
  const b = objectBody(input, ['productId', 'warehouseId', 'minimum'])
  return {
    productId: identifier(b.productId),
    warehouseId: identifier(b.warehouseId),
    minimum: integer(b.minimum),
  }
}
export function parseWarehouse(input: unknown): string {
  return text(objectBody(input, ['name']).name, 'Nombre del depósito', 1, 100)
}
export function parseHistoryQuery(query: Record<string, unknown>): HistoryFilters {
  if (
    Object.keys(query).some(
      (key) => !['productId', 'warehouseId', 'type', 'page', 'q'].includes(key),
    )
  ) {
    throw new HttpError(400, 'Filtro de movimientos no admitido.')
  }
  const { productId, warehouseId, type, page } = query
  if (
    type !== undefined &&
    (typeof type !== 'string' ||
      !['initial', 'inbound', 'outbound', 'adjustment'].includes(type))
  ) {
    throw new HttpError(400, 'Tipo de movimiento no válido.')
  }
  if (page !== undefined && (typeof page !== 'string' || !/^[1-9]\d{0,5}$/.test(page))) {
    throw new HttpError(400, 'Página no válida.')
  }
  return {
    query: query.q === undefined ? '' : text(query.q, 'Búsqueda', 0, 160),
    productId: productId === undefined ? null : identifier(productId),
    warehouseId: warehouseId === undefined ? null : identifier(warehouseId),
    type: type === undefined ? null : String(type),
    page: Number(page ?? 1),
  }
}
