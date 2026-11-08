import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { pool } from '../../config/database'
import { HttpError } from '../../shared/errors/HttpError'
import type { MovementInput, HistoryFilters } from './inventory.types'

interface InventoryRow extends RowDataPacket {
  productId: string
  name: string
  sku: string
  productStatus: 'active' | 'archived'
  warehouseId: string | null
  warehouse: string | null
  quantity: number
  minimum: number
}
interface WarehouseRow extends RowDataPacket {
  id: string
  name: string
  status: 'active' | 'archived'
}
interface StatusRow extends RowDataPacket {
  status: 'active' | 'archived'
}
interface QuantityRow extends RowDataPacket {
  quantity: number
}
interface CountRow extends RowDataPacket {
  total: number | string
}
interface MovementRow extends RowDataPacket {
  id: string
  productId: string
  name: string
  sku: string
  warehouse: string
  type: MovementInput['type'] | 'initial'
  delta: number
  reason: string
  createdBy: string
  createdAt: Date
}

export async function listInventory(companyId: string) {
  const [rows] = await pool.execute<InventoryRow[]>(
    `SELECT p.id AS productId, p.name, p.sku, p.status AS productStatus,
      w.id AS warehouseId, w.name AS warehouse,
      COALESCE(b.quantity, 0) AS quantity, COALESCE(b.minimum_quantity, s.default_minimum, 0) AS minimum
     FROM products p
     LEFT JOIN company_settings s ON s.company_id = p.company_id
     LEFT JOIN inventory_balances b ON b.company_id = p.company_id AND b.product_id = p.id
     LEFT JOIN warehouses w ON w.company_id = b.company_id AND w.id = b.warehouse_id
     WHERE p.company_id = ? AND (p.status = 'active' OR b.quantity > 0)
     ORDER BY p.name, w.name`,
    [companyId],
  )
  return rows.map((r) => ({
    ...r,
    productId: String(r.productId),
    warehouseId: r.warehouseId === null ? null : String(r.warehouseId),
    quantity: Number(r.quantity),
    minimum: Number(r.minimum),
  }))
}
export async function listWarehouses(companyId: string) {
  const [rows] = await pool.execute<WarehouseRow[]>(
    `SELECT id, name, status FROM warehouses WHERE company_id = ? ORDER BY name`,
    [companyId],
  )
  return rows.map((r) => ({ ...r, id: String(r.id) }))
}
export async function insertWarehouse(
  c: PoolConnection,
  companyId: string,
  name: string,
) {
  const [result] = await c.execute<ResultSetHeader>(
    'INSERT INTO warehouses (company_id, name) VALUES (?, ?)',
    [companyId, name],
  )
  return { warehouseId: String(result.insertId) }
}
export async function lockBalance(
  c: PoolConnection,
  companyId: string,
  productId: string,
  warehouseId: string,
  allowArchived = false,
  allowArchivedWarehouse = false,
) {
  const [products] = await c.execute<StatusRow[]>(
    'SELECT status FROM products WHERE company_id = ? AND id = ? FOR UPDATE',
    [companyId, productId],
  )
  const [warehouses] = await c.execute<StatusRow[]>(
    'SELECT status FROM warehouses WHERE company_id = ? AND id = ? FOR UPDATE',
    [companyId, warehouseId],
  )
  if (!products[0] || !warehouses[0])
    throw new HttpError(404, 'Producto o depósito no encontrado en esta empresa.')
  if (
    (!allowArchived && products[0].status !== 'active') ||
    (!allowArchivedWarehouse && warehouses[0].status !== 'active')
  ) {
    throw new HttpError(409, 'El producto o depósito está archivado.')
  }
  await c.execute(
    `INSERT INTO inventory_balances (company_id, warehouse_id, product_id, minimum_quantity)
     SELECT ?, ?, ?, COALESCE((SELECT default_minimum FROM company_settings WHERE company_id = ?), 0)
     ON DUPLICATE KEY UPDATE product_id = VALUES(product_id)`,
    [companyId, warehouseId, productId, companyId],
  )
  const [rows] = await c.execute<QuantityRow[]>(
    `SELECT quantity FROM inventory_balances WHERE company_id = ? AND warehouse_id = ? AND product_id = ? FOR UPDATE`,
    [companyId, warehouseId, productId],
  )
  return Number(rows[0]!.quantity)
}
export async function updateMinimum(
  c: PoolConnection,
  companyId: string,
  productId: string,
  warehouseId: string,
  minimum: number,
) {
  await c.execute(
    'UPDATE inventory_balances SET minimum_quantity = ? WHERE company_id = ? AND warehouse_id = ? AND product_id = ?',
    [minimum, companyId, warehouseId, productId],
  )
}
export async function writeMovement(
  c: PoolConnection,
  companyId: string,
  userId: string,
  input: MovementInput,
  delta: number,
  quantity: number,
  orderId: string | null = null,
) {
  await c.execute(
    'UPDATE inventory_balances SET quantity = ? WHERE company_id = ? AND warehouse_id = ? AND product_id = ?',
    [quantity, companyId, input.warehouseId, input.productId],
  )
  const [result] = await c.execute<ResultSetHeader>(
    `INSERT INTO inventory_movements (company_id, warehouse_id, product_id, type, quantity_delta, reason, created_by, order_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      input.warehouseId,
      input.productId,
      input.type,
      delta,
      input.reason,
      userId,
      orderId,
    ],
  )
  return { movementId: String(result.insertId), quantity, delta }
}
export async function listMovements(companyId: string, filters: HistoryFilters) {
  const where = `m.company_id = ? AND (? IS NULL OR m.product_id = ?) AND (? IS NULL OR m.warehouse_id = ?) AND (? IS NULL OR m.type = ?)
    AND (? = '' OR LOCATE(?, CONCAT_WS(' ', p.name, p.sku, m.reason, u.full_name)) > 0)`
  const params = [
    companyId,
    filters.productId,
    filters.productId,
    filters.warehouseId,
    filters.warehouseId,
    filters.type,
    filters.type,
    filters.query,
    filters.query,
  ]
  const joins = `FROM inventory_movements m JOIN products p ON p.company_id = m.company_id AND p.id = m.product_id
     JOIN warehouses w ON w.company_id = m.company_id AND w.id = m.warehouse_id JOIN users u ON u.id = m.created_by`
  const [counts] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS total ${joins} WHERE ${where}`,
    params,
  )
  const [rows] = await pool.query<MovementRow[]>(
    `SELECT m.id, m.product_id AS productId, p.name, p.sku, w.name AS warehouse,
      m.type, m.quantity_delta AS delta, m.reason, u.full_name AS createdBy, m.created_at AS createdAt
     ${joins} WHERE ${where}
     ORDER BY m.created_at DESC, m.id DESC LIMIT 30 OFFSET ?`,
    [...params, (filters.page - 1) * 30],
  )
  return {
    movements: rows.map((r) => ({
      ...r,
      id: String(r.id),
      productId: String(r.productId),
      delta: Number(r.delta),
      createdAt: r.createdAt.toISOString(),
    })),
    total: Number(counts[0]!.total),
    page: filters.page,
    pageSize: 30,
  }
}
