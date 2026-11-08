import { HttpError } from '../../shared/errors/HttpError'
import type { CreateProductInput } from './product.types'

export function parseCreateProduct(input: unknown): CreateProductInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new HttpError(400, 'Enviá los datos del producto como un objeto JSON.')
  }

  const body = input as Record<string, unknown>
  const allowedFields = ['name', 'sku', 'category', 'price']
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    throw new HttpError(400, 'El formulario contiene campos no admitidos.')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const price = typeof body.price === 'string' ? body.price.trim() : ''

  if (Array.from(name).length < 2 || name.length > 160) {
    throw new HttpError(
      400,
      'El nombre del producto debe tener entre 2 y 160 caracteres.',
    )
  }
  if (!sku || sku.length > 64) {
    throw new HttpError(400, 'El código SKU debe tener entre 1 y 64 caracteres.')
  }
  if (!category || category.length > 80) {
    throw new HttpError(400, 'La categoría debe tener entre 1 y 80 caracteres.')
  }
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(price)) {
    throw new HttpError(
      400,
      'Ingresá un precio entre 0 y 9999999999999.99, con hasta 2 decimales.',
    )
  }

  return { name, sku, category, price }
}
