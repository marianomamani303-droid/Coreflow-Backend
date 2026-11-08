import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { CreateProductInput, Product } from './product.types'
import { pool } from '../../config/database'

export async function findOrInsertProductCategory(
  connection: PoolConnection,
  companyId: string,
  name: string,
): Promise<string> {
  // UNIQUE(company_id, name) evita categorías duplicadas, incluso con concurrencia.
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO categories (company_id, name) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [companyId, name],
  )
  return String(result.insertId)
}

export async function insertProduct(
  connection: PoolConnection,
  companyId: string,
  categoryId: string,
  input: CreateProductInput,
): Promise<string> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO products (company_id, category_id, sku, name, price)
     VALUES (?, ?, ?, ?, ?)`,
    [companyId, categoryId, input.sku, input.name, input.price],
  )
  return String(result.insertId)
}

interface ProductRow extends RowDataPacket, Omit<Product, 'stock'> {
  stock: number | string
}

export async function getProducts(companyId: string): Promise<ProductRow[]> {
  const [rows] = await pool.execute<ProductRow[]>(
    `SELECT p.id, p.company_id, p.category_id, p.sku, p.name, p.description,
      p.price, p.status, c.name AS category,
      COALESCE((SELECT SUM(b.quantity) FROM inventory_balances b
        WHERE b.company_id = p.company_id AND b.product_id = p.id), 0) AS stock
     FROM products p LEFT JOIN categories c ON c.company_id = p.company_id AND c.id = p.category_id
     WHERE p.company_id = ? ORDER BY p.created_at DESC, p.id DESC`,
    [companyId],
  )

  return rows
}
