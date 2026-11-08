import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { pool } from '../../config/database'
import { HttpError } from '../../shared/errors/HttpError'
import { moneyCents, moneyString } from '../../shared/money'
import type {
  OrderDetail,
  OrderFilters,
  OrderInput,
  OrderItem,
  OrderStatus,
  OrderSummary,
} from './order.types'

type Reader = Pick<PoolConnection, 'execute'>
interface OrderRow extends RowDataPacket, Omit<OrderSummary, 'createdAt' | 'updatedAt'> {
  createdAt: Date
  updatedAt: Date
}
const summaryQuery = `SELECT o.id, o.order_number AS orderNumber, o.customer_name AS customerName,
  o.customer_email AS customerEmail, o.status, o.currency, o.total_amount AS total,
  o.discount_amount AS discount, o.notes, o.warehouse_id AS warehouseId, w.name AS warehouse,
  o.created_by AS createdById, u.full_name AS createdBy, o.created_at AS createdAt,
  o.updated_at AS updatedAt, o.version,
  (SELECT SUM(i.quantity) FROM order_items i WHERE i.company_id = o.company_id AND i.order_id = o.id) AS itemCount
  FROM orders o JOIN users u ON u.id = o.created_by
  LEFT JOIN warehouses w ON w.company_id = o.company_id AND w.id = o.warehouse_id`

function summary(row: OrderRow): OrderSummary {
  return {
    ...row,
    id: String(row.id),
    createdById: String(row.createdById),
    warehouseId: row.warehouseId === null ? null : String(row.warehouseId),
    total: String(row.total),
    discount: String(row.discount),
    version: Number(row.version),
    itemCount: Number(row.itemCount ?? 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listOrders(companyId: string, filters: OrderFilters) {
  const where = `o.company_id = ? AND (? IS NULL OR o.status = ?)
    AND (? IS NULL OR o.created_at >= ?) AND (? IS NULL OR o.created_at < DATE_ADD(?, INTERVAL 1 DAY))
    AND (? = '' OR LOCATE(?, CONCAT_WS(' ', o.order_number, o.customer_name, o.customer_email, u.full_name)) > 0
      OR EXISTS (SELECT 1 FROM order_items i WHERE i.company_id = o.company_id AND i.order_id = o.id
        AND LOCATE(?, CONCAT_WS(' ', i.product_name, i.product_sku)) > 0))`
  const params = [
    companyId,
    filters.status,
    filters.status,
    filters.from,
    filters.from,
    filters.to,
    filters.to,
    filters.query,
    filters.query,
    filters.query,
  ]
  const [count] = await pool.execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM orders o JOIN users u ON u.id = o.created_by WHERE ${where}`,
    params,
  )
  const [rows] = await pool.query<OrderRow[]>(
    `${summaryQuery} WHERE ${where}
    ORDER BY o.created_at DESC, o.id DESC LIMIT 30 OFFSET ?`,
    [...params, (filters.page - 1) * 30],
  )
  return {
    orders: rows.map(summary),
    total: Number(count[0]!.total),
    page: filters.page,
    pageSize: 30,
  }
}

export async function getOrder(
  companyId: string,
  orderId: string,
  connection: Reader = pool,
): Promise<OrderDetail> {
  const [rows] = await connection.execute<OrderRow[]>(
    `${summaryQuery} WHERE o.company_id = ? AND o.id = ?`,
    [companyId, orderId],
  )
  if (!rows[0]) throw new HttpError(404, 'Pedido no encontrado en esta empresa.')
  const [items] = await connection.execute<(RowDataPacket & OrderItem)[]>(
    `SELECT product_id AS productId, product_name AS productName, product_sku AS productSku,
      quantity, unit_price AS unitPrice, line_total AS lineTotal FROM order_items
      WHERE company_id = ? AND order_id = ? ORDER BY id`,
    [companyId, orderId],
  )
  const [events] = await connection.execute<
    (RowDataPacket & {
      action: 'created' | 'edited' | 'status'
      status: OrderStatus
      createdBy: string
      createdAt: Date
    })[]
  >(
    `SELECT e.action, e.status, u.full_name AS createdBy, e.created_at AS createdAt
      FROM order_events e JOIN users u ON u.id = e.created_by
      WHERE e.company_id = ? AND e.order_id = ? ORDER BY e.id`,
    [companyId, orderId],
  )
  return {
    ...summary(rows[0]),
    subtotal: moneyString(
      items.reduce((sum, item) => sum + moneyCents(String(item.lineTotal)), 0n),
    ),
    items: items.map((item) => ({
      ...item,
      productId: String(item.productId),
      quantity: Number(item.quantity),
      unitPrice: String(item.unitPrice),
      lineTotal: String(item.lineTotal),
    })),
    events: events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  }
}

export async function lockOrder(
  connection: PoolConnection,
  companyId: string,
  orderId: string,
) {
  await connection.execute(
    'SELECT id FROM orders WHERE company_id = ? AND id = ? FOR UPDATE',
    [companyId, orderId],
  )
  return getOrder(companyId, orderId, connection)
}
export async function findRequest(
  connection: PoolConnection,
  companyId: string,
  key: string,
) {
  const [rows] = await connection.execute<
    (RowDataPacket & { id: string; requestHash: string; createdBy: string })[]
  >(
    'SELECT id, request_hash AS requestHash, created_by AS createdBy FROM orders WHERE company_id = ? AND request_key = ?',
    [companyId, key],
  )
  return rows[0]
}
export async function productSnapshot(
  connection: PoolConnection,
  companyId: string,
  productId: string,
) {
  const [rows] = await connection.execute<
    (RowDataPacket & { name: string; sku: string; price: string; status: string })[]
  >(
    'SELECT name, sku, price, status FROM products WHERE company_id = ? AND id = ? FOR UPDATE',
    [companyId, productId],
  )
  if (!rows[0]) throw new HttpError(404, 'Producto no encontrado en esta empresa.')
  return rows[0]
}
export async function companyCurrency(connection: PoolConnection, companyId: string) {
  const [rows] = await connection.execute<(RowDataPacket & { currency: string })[]>(
    'SELECT currency FROM companies WHERE id = ?',
    [companyId],
  )
  return rows[0]!.currency
}
export async function requireActiveWarehouse(
  connection: PoolConnection,
  companyId: string,
  warehouseId: string,
) {
  const [rows] = await connection.execute<(RowDataPacket & { status: string })[]>(
    'SELECT status FROM warehouses WHERE company_id = ? AND id = ? FOR UPDATE',
    [companyId, warehouseId],
  )
  if (!rows[0]) throw new HttpError(404, 'Depósito no encontrado en esta empresa.')
  if (rows[0].status !== 'active') throw new HttpError(409, 'El depósito está archivado.')
}
export async function insertOrder(
  connection: PoolConnection,
  companyId: string,
  userId: string,
  input: OrderInput,
  requestKey: string,
  requestHash: string,
  orderNumber: string,
  currency: string,
  total: string,
) {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO orders (company_id, order_number, customer_name, customer_email, notes, created_by,
      warehouse_id, discount_amount, total_amount, request_key, request_hash, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      orderNumber,
      input.customerName,
      input.customerEmail,
      input.notes,
      userId,
      input.warehouseId,
      input.discount,
      total,
      requestKey,
      requestHash,
      currency,
    ],
  )
  return String(result.insertId)
}
export async function updateOrder(
  connection: PoolConnection,
  companyId: string,
  orderId: string,
  input: OrderInput,
  total: string,
) {
  await connection.execute(
    `UPDATE orders SET customer_name = ?, customer_email = ?, notes = ?, discount_amount = ?, total_amount = ?, version = version + 1
    WHERE company_id = ? AND id = ?`,
    [
      input.customerName,
      input.customerEmail,
      input.notes,
      input.discount,
      total,
      companyId,
      orderId,
    ],
  )
}
export async function replaceItems(
  connection: PoolConnection,
  companyId: string,
  orderId: string,
  items: OrderItem[],
) {
  // Sólo se reemplazan líneas de una orden editable, dentro de su transacción.
  await connection.execute(
    'DELETE FROM order_items WHERE company_id = ? AND order_id = ?',
    [companyId, orderId],
  )
  for (const item of items) {
    await connection.execute(
      `INSERT INTO order_items (company_id, order_id, product_id, product_name, product_sku, quantity, unit_price)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        orderId,
        item.productId,
        item.productName,
        item.productSku,
        item.quantity,
        item.unitPrice,
      ],
    )
  }
}
export async function setInitialStatus(
  connection: PoolConnection,
  companyId: string,
  orderId: string,
  status: 'pending' | 'processing',
) {
  await connection.execute(
    'UPDATE orders SET status = ? WHERE company_id = ? AND id = ?',
    [status, companyId, orderId],
  )
}
export async function setStatus(
  connection: PoolConnection,
  companyId: string,
  orderId: string,
  status: OrderStatus,
) {
  await connection.execute(
    'UPDATE orders SET status = ?, version = version + 1 WHERE company_id = ? AND id = ?',
    [status, companyId, orderId],
  )
}
export async function appendEvent(
  connection: PoolConnection,
  companyId: string,
  orderId: string,
  userId: string,
  action: 'created' | 'edited' | 'status',
  status: OrderStatus,
) {
  await connection.execute(
    'INSERT INTO order_events (company_id, order_id, created_by, action, status) VALUES (?, ?, ?, ?, ?)',
    [companyId, orderId, userId, action, status],
  )
}
