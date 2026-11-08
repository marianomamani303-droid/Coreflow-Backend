export type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled'

export interface OrderLineInput {
  productId: string
  quantity: number
}
export interface OrderInput {
  warehouseId: string
  items: OrderLineInput[]
  customerName: string
  customerEmail: string | null
  notes: string | null
  discount: string
}
export interface CreateOrderInput extends OrderInput {
  requestKey: string
  useDefaultCustomer: boolean
}
export interface UpdateOrderInput extends OrderInput {
  version: number
}
export interface OrderFilters {
  query: string
  status: OrderStatus | null
  from: string | null
  to: string | null
  page: number
}
export interface OrderItem {
  productId: string
  productName: string
  productSku: string
  quantity: number
  unitPrice: string
  lineTotal: string
}
export interface OrderSummary {
  id: string
  orderNumber: string
  customerName: string
  customerEmail: string | null
  status: OrderStatus
  currency: string
  total: string
  discount: string
  notes: string | null
  warehouseId: string | null
  warehouse: string | null
  createdBy: string
  createdById: string
  createdAt: string
  updatedAt: string
  version: number
  itemCount: number
}
export interface OrderDetail extends OrderSummary {
  subtotal: string
  items: OrderItem[]
  events: {
    action: 'created' | 'edited' | 'status'
    status: OrderStatus
    createdBy: string
    createdAt: string
  }[]
}
