import type { PoolConnection } from 'mysql2/promise'
import { lockBalance, writeMovement } from '../inventory/inventory.repository'
import { HttpError } from '../../shared/errors/HttpError'
import type { OrderItem } from './order.types'

/** Aplica sólo diferencias: editar no vuelve a descontar las unidades ya reservadas. */
export async function reconcileStock(
  connection: PoolConnection,
  companyId: string,
  userId: string,
  orderId: string,
  orderNumber: string,
  warehouseId: string,
  previous: OrderItem[],
  next: OrderItem[],
) {
  const products = [
    ...new Set([...previous, ...next].map((item) => item.productId)),
  ].sort()
  for (const productId of products) {
    const before = previous.find((item) => item.productId === productId)
    const after = next.find((item) => item.productId === productId)
    const delta = (before?.quantity ?? 0) - (after?.quantity ?? 0)
    if (!delta) continue
    // Una devolución admite productos archivados; una nueva reserva exige activos.
    const current = await lockBalance(
      connection,
      companyId,
      productId,
      warehouseId,
      delta > 0,
      delta > 0,
    )
    const quantity = current + delta
    if (quantity < 0)
      throw new HttpError(
        409,
        `Stock insuficiente de ${after?.productName ?? productId}. Disponible: ${current}.`,
      )
    if (quantity > 2147483647)
      throw new HttpError(409, 'La devolución excede el saldo máximo permitido.')
    await writeMovement(
      connection,
      companyId,
      userId,
      {
        productId,
        warehouseId,
        type: delta > 0 ? 'inbound' : 'outbound',
        quantity: Math.abs(delta),
        reason: `Pedido ${orderNumber}: ${delta > 0 ? 'devolución de reserva' : 'reserva de stock'}`,
      },
      delta,
      quantity,
      orderId,
    )
  }
}
