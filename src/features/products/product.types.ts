export interface CreateProductInput {
  name: string
  sku: string
  category: string
  // DECIMAL(15, 2): se conserva como texto para evitar redondeos binarios.
  price: string
}

export interface CreateProductResult {
  productId: string
}

export interface Product {
  id: string
  company_id: string
  category_id: string | null
  sku: string
  name: string
  description: string | null
  price: string
  status: 'active' | 'archived'
  category: string | null
  stock: number
}
