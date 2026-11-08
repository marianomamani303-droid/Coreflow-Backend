export interface BalanceInput {
  productId: string
  warehouseId: string
  minimum: number
}
export interface MovementInput {
  productId: string
  warehouseId: string
  type: 'inbound' | 'outbound' | 'adjustment'
  quantity: number
  reason: string
}
export interface HistoryFilters {
  productId: string | null
  warehouseId: string | null
  type: string | null
  query: string
  page: number
}
