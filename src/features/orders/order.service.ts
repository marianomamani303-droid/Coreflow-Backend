import { createHash, randomUUID } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import type { CompanyRole } from '../companies/companies.types'
import { companyForUser } from '../companies/companies.service'
import { companyTransaction } from '../../shared/companyAccess'
import { HttpError } from '../../shared/errors/HttpError'
import { moneyCents, moneyString } from '../../shared/money'
import { reconcileStock } from './order.inventory'
import { readOperationalSettings } from '../settings/settings.repository'
import * as repository from './order.repository'
import type {
  CreateOrderInput,
  OrderDetail,
  OrderFilters,
  OrderInput,
  OrderItem,
  OrderStatus,
  UpdateOrderInput,
} from './order.types'

function requireEditable(
  order: OrderDetail,
  userId: string,
  role: CompanyRole,
  version: number,
) {
  if (role === 'employee' && order.createdById !== userId)
    throw new HttpError(403, 'Sólo podés gestionar tus propios pedidos.')
  if (order.version !== version)
    throw new HttpError(
      409,
      'Otra persona modificó el pedido. Cerrá el detalle y volvé a abrirlo antes de continuar.',
    )
  if (order.status === 'completed' || order.status === 'cancelled')
    throw new HttpError(
      409,
      'Los pedidos completados o cancelados conservan su historial y no se pueden modificar.',
    )
  return order.status
}

async function priceItems(
  connection: PoolConnection,
  companyId: string,
  input: OrderInput,
  previous: OrderItem[] = [],
) {
  const items: OrderItem[] = []
  for (const line of input.items) {
    const product = await repository.productSnapshot(
      connection,
      companyId,
      line.productId,
    )
    const old = previous.find((item) => item.productId === line.productId)
    if (product.status !== 'active' && (!old || line.quantity > old.quantity))
      throw new HttpError(409, `El producto ${product.name} está archivado.`)
    const unitPrice = old?.unitPrice ?? String(product.price)
    items.push({
      ...line,
      productName: old?.productName ?? product.name,
      productSku: old?.productSku ?? product.sku,
      unitPrice,
      lineTotal: moneyString(moneyCents(unitPrice) * BigInt(line.quantity)),
    })
  }
  const subtotal = items.reduce((sum, item) => sum + moneyCents(item.lineTotal), 0n)
  moneyString(subtotal)
  const discount = moneyCents(input.discount)
  if (discount > subtotal)
    throw new HttpError(400, 'El descuento no puede superar el subtotal.')
  return { items, total: moneyString(subtotal - discount) }
}

export async function ordersForUser(
  userId: string,
  companyId: string,
  filters: OrderFilters,
) {
  await companyForUser(userId, companyId)
  return repository.listOrders(companyId, filters)
}
export function orderForUser(userId: string, companyId: string, orderId: string) {
  return companyTransaction(userId, companyId, (connection) =>
    repository.getOrder(companyId, orderId, connection),
  )
}
export function createOrder(userId: string, companyId: string, input: CreateOrderInput) {
  return companyTransaction(userId, companyId, async (connection) => {
    const { requestKey, useDefaultCustomer, ...orderInput } = input
    const hash = createHash('sha256').update(JSON.stringify(orderInput)).digest('hex')
    const existing = await repository.findRequest(connection, companyId, requestKey)
    if (existing) {
      if (existing.requestHash !== hash || String(existing.createdBy) !== userId)
        throw new HttpError(
          409,
          'La clave de este pedido ya se usó con otros datos. Revisá los pedidos registrados.',
        )
      return {
        order: await repository.getOrder(companyId, String(existing.id), connection),
        replayed: true,
      }
    }
    await repository.requireActiveWarehouse(connection, companyId, input.warehouseId)
    const defaults = (await readOperationalSettings(companyId, connection)).orders
    const resolved = {
      ...orderInput,
      customerName: useDefaultCustomer
        ? defaults.defaultCustomerName
        : input.customerName,
    }
    const { items, total } = await priceItems(connection, companyId, input)
    const currency = await repository.companyCurrency(connection, companyId)
    const number = `CF-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`
    const orderId = await repository.insertOrder(
      connection,
      companyId,
      userId,
      resolved,
      requestKey,
      hash,
      number,
      currency,
      total,
    )
    if (defaults.initialStatus !== 'pending')
      await repository.setInitialStatus(
        connection,
        companyId,
        orderId,
        defaults.initialStatus,
      )
    await repository.replaceItems(connection, companyId, orderId, items)
    await reconcileStock(
      connection,
      companyId,
      userId,
      orderId,
      number,
      input.warehouseId,
      [],
      items,
    )
    await repository.appendEvent(
      connection,
      companyId,
      orderId,
      userId,
      'created',
      defaults.initialStatus,
    )
    return {
      order: await repository.getOrder(companyId, orderId, connection),
      replayed: false,
    }
  })
}
export function editOrder(
  userId: string,
  companyId: string,
  orderId: string,
  input: UpdateOrderInput,
) {
  return companyTransaction(userId, companyId, async (connection, role) => {
    const order = await repository.lockOrder(connection, companyId, orderId)
    requireEditable(order, userId, role, input.version)
    if (order.warehouseId !== input.warehouseId)
      throw new HttpError(
        409,
        'El depósito de un pedido registrado no se puede cambiar. Cancelá el pedido y creá uno nuevo si necesitás otro origen.',
      )
    if (
      order.currency !== (await repository.companyCurrency(connection, companyId)) &&
      input.items.some(
        (item) => !order.items.some((old) => old.productId === item.productId),
      )
    ) {
      throw new HttpError(
        409,
        'La moneda de la empresa cambió. Este pedido conserva su moneda y sólo admite productos que ya tenía incluidos.',
      )
    }
    const { items, total } = await priceItems(connection, companyId, input, order.items)
    await reconcileStock(
      connection,
      companyId,
      userId,
      orderId,
      order.orderNumber,
      input.warehouseId,
      order.items,
      items,
    )
    await repository.replaceItems(connection, companyId, orderId, items)
    await repository.updateOrder(connection, companyId, orderId, input, total)
    await repository.appendEvent(
      connection,
      companyId,
      orderId,
      userId,
      'edited',
      order.status,
    )
    return { order: await repository.getOrder(companyId, orderId, connection) }
  })
}
export function changeStatus(
  userId: string,
  companyId: string,
  orderId: string,
  status: OrderStatus,
  version: number,
) {
  return companyTransaction(userId, companyId, async (connection, role) => {
    const order = await repository.lockOrder(connection, companyId, orderId)
    const currentStatus = requireEditable(order, userId, role, version)
    const allowed: Record<'pending' | 'processing', OrderStatus[]> = {
      pending: ['processing', 'completed', 'cancelled'],
      processing: ['completed', 'cancelled'],
    }
    if (!allowed[currentStatus].includes(status))
      throw new HttpError(409, 'El cambio de estado no está permitido.')
    if (status === 'cancelled') {
      if (!order.warehouseId)
        throw new HttpError(
          409,
          'Este pedido antiguo no tiene depósito de origen. Requiere revisión de inventario antes de cancelarlo.',
        )
      await reconcileStock(
        connection,
        companyId,
        userId,
        orderId,
        order.orderNumber,
        order.warehouseId,
        order.items,
        [],
      )
    }
    await repository.setStatus(connection, companyId, orderId, status)
    await repository.appendEvent(connection, companyId, orderId, userId, 'status', status)
    return { order: await repository.getOrder(companyId, orderId, connection) }
  })
}
