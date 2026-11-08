import { HttpError } from './errors/HttpError'

export const MAX_MONEY_CENTS = 999999999999999n

/** DECIMAL(15,2) se calcula en centavos enteros; nunca con coma flotante. */
export function moneyCents(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value)) {
    throw new HttpError(400, 'Ingresá un importe positivo con hasta dos decimales.')
  }
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))
}

export function moneyString(cents: bigint): string {
  if (cents < 0n || cents > MAX_MONEY_CENTS) {
    throw new HttpError(400, 'El importe excede el rango permitido.')
  }
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}
