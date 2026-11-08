import { HttpError } from '../../shared/errors/HttpError'
import { moneyCents, moneyString } from '../../shared/money'
import { identifier, integer, objectBody, text } from '../../shared/validation'
import type {
  CreateOrderInput,
  OrderFilters,
  OrderInput,
  OrderStatus,
  UpdateOrderInput,
} from './order.types'

const orderFields = [
  'warehouseId',
  'items',
  'customerName',
  'customerEmail',
  'notes',
  'discount',
]

function optionalText(value: unknown, label: string, max: number): string | null {
  return value === undefined || value === null ? null : text(value, label, 0, max) || null
}

function orderInput(body: Record<string, unknown>): OrderInput {
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    throw new HttpError(400, 'Agregá entre 1 y 100 productos al pedido.')
  }
  const items = body.items
    .map((value: unknown) => {
      const line = objectBody(value, ['productId', 'quantity'])
      return {
        productId: identifier(line.productId),
        quantity: integer(line.quantity, 1, 1000000),
      }
    })
    .sort((a, b) => a.productId.localeCompare(b.productId))
  if (new Set(items.map((line) => line.productId)).size !== items.length) {
    throw new HttpError(
      400,
      'Cada producto debe aparecer una sola vez; ajustá su cantidad.',
    )
  }
  const email = optionalText(body.customerEmail, 'Correo del cliente', 254)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Ingresá un correo válido para el cliente.')
  }
  const discount = body.discount ?? '0'
  if (typeof discount !== 'string')
    throw new HttpError(400, 'El descuento debe ser un importe decimal.')
  return {
    warehouseId: identifier(body.warehouseId),
    items,
    customerName: optionalText(body.customerName, 'Cliente', 160) ?? 'Consumidor final',
    customerEmail: email?.toLowerCase() ?? null,
    notes: optionalText(body.notes, 'Observaciones', 2000),
    discount: moneyString(moneyCents(discount)),
  }
}

export function parseCreateOrder(value: unknown): CreateOrderInput {
  const body = objectBody(value, [...orderFields, 'requestKey'])
  if (
    typeof body.requestKey !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      body.requestKey,
    )
  ) {
    throw new HttpError(400, 'Falta una clave válida para evitar pedidos duplicados.')
  }
  return {
    ...orderInput(body),
    requestKey: body.requestKey.toLowerCase(),
    useDefaultCustomer:
      typeof body.customerName !== 'string' || !body.customerName.trim(),
  }
}
export function parseUpdateOrder(value: unknown): UpdateOrderInput {
  const body = objectBody(value, [...orderFields, 'version'])
  return { ...orderInput(body), version: integer(body.version, 1) }
}
export function orderStatus(value: unknown): OrderStatus {
  if (
    value !== 'pending' &&
    value !== 'processing' &&
    value !== 'completed' &&
    value !== 'cancelled'
  ) {
    throw new HttpError(400, 'Estado de pedido no válido.')
  }
  return value
}
export function parseStatus(value: unknown) {
  const body = objectBody(value, ['status', 'version'])
  return { status: orderStatus(body.status), version: integer(body.version, 1) }
}
function date(value: unknown): string | null {
  if (value === undefined) return null
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) {
    throw new HttpError(400, 'La fecha debe tener el formato AAAA-MM-DD y ser válida.')
  }
  return value
}
export function parseOrderQuery(query: Record<string, unknown>): OrderFilters {
  objectBody(query, ['q', 'status', 'from', 'to', 'page'])
  const from = date(query.from),
    to = date(query.to)
  if (from && to && from > to)
    throw new HttpError(400, 'El inicio debe ser anterior al fin.')
  if (
    query.page !== undefined &&
    (typeof query.page !== 'string' || !/^[1-9]\d{0,5}$/.test(query.page))
  ) {
    throw new HttpError(400, 'Página no válida.')
  }
  return {
    query: query.q === undefined ? '' : text(query.q, 'Búsqueda', 0, 160),
    status: query.status === undefined ? null : orderStatus(query.status),
    from,
    to,
    page: Number(query.page ?? 1),
  }
}
