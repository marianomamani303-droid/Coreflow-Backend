import { HttpError } from '../../shared/errors/HttpError'
import { findOrInsertProductCategory, insertProduct } from './product.repository'
import type { CreateProductInput, CreateProductResult, Product } from './product.types'
import { companyForUser } from '../companies/companies.service'
import { getProducts } from './product.repository'
import { companyTransaction, requireManager } from '../../shared/companyAccess'
import { readOperationalSettings } from '../settings/settings.repository'

export async function productsForUser(
  userId: string,
  companyId: string,
): Promise<Product[]> {
  await companyForUser(userId, companyId)
  return (await getProducts(companyId)).map((row) => ({
    ...row,
    id: String(row.id),
    company_id: String(row.company_id),
    category_id: row.category_id === null ? null : String(row.category_id),
    price: String(row.price),
    stock: Number(row.stock),
  }))
}

export async function createProductForUser(
  userId: string,
  companyId: string,
  input: CreateProductInput,
): Promise<CreateProductResult> {
  try {
    return await companyTransaction(userId, companyId, async (connection, role) => {
      requireManager(role)
      const categoryId = await findOrInsertProductCategory(
        connection,
        companyId,
        input.category,
      )
      const productId = await insertProduct(connection, companyId, categoryId, input)
      const settings = await readOperationalSettings(companyId, connection)
      if (settings.inventory.autoCreateBalances) {
        // Crea ubicaciones con saldo cero; nunca fabrica entradas de mercadería.
        await connection.execute(
          `INSERT INTO inventory_balances (company_id, warehouse_id, product_id, minimum_quantity)
          SELECT company_id, id, ?, ? FROM warehouses WHERE company_id = ? AND status = 'active'`,
          [productId, settings.inventory.defaultMinimum, companyId],
        )
      }
      return { productId }
    })
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ER_DUP_ENTRY'
    ) {
      throw new HttpError(409, 'Ya existe un producto con ese SKU en esta empresa.')
    }
    throw error
  }
}
