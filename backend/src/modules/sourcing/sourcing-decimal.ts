import { Decimal } from 'decimal.js'

function parseNonNegativeDecimal(value: unknown): Decimal | null {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
  if (!text) return null
  try {
    const decimal = new Decimal(text)
    return decimal.isFinite() && !decimal.isNegative() ? decimal : null
  } catch {
    return null
  }
}

/** 将金额或数量规范化为固定小数位字符串，绝不经过JavaScript浮点数。 */
export function decimalOrNull(value: unknown, scale = 4): string | null {
  const decimal = parseNonNegativeDecimal(value)
  return decimal
    ? decimal.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale)
    : null
}

/** 使用Decimal比较一组值并返回不丢精度的最小值与最大值。 */
export function decimalMinMax(values: unknown[]): {
  minimum: string | null
  maximum: string | null
} {
  const decimals = values
    .map(parseNonNegativeDecimal)
    .filter((value): value is Decimal => value !== null)
  if (!decimals.length) return { minimum: null, maximum: null }
  const minimum = decimals.reduce((current, value) => Decimal.min(current, value))
  const maximum = decimals.reduce((current, value) => Decimal.max(current, value))
  return { minimum: minimum.toString(), maximum: maximum.toString() }
}

/** 将0到100之间的百分比规范化为四位小数字符串。 */
export function decimalPercentOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().replace(/%$/, '') : value
  const decimal = parseNonNegativeDecimal(text)
  if (!decimal || decimal.greaterThan(100)) return null
  return decimal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4)
}

export function decimalCompare(left: unknown, right: unknown): number | null {
  const leftDecimal = parseNonNegativeDecimal(left)
  const rightDecimal = parseNonNegativeDecimal(right)
  return leftDecimal && rightDecimal ? leftDecimal.comparedTo(rightDecimal) : null
}

export function decimalToNumber(value: unknown): number | null {
  const decimal = parseNonNegativeDecimal(value)
  if (!decimal) return null
  const numberValue = decimal.toNumber()
  return Number.isFinite(numberValue) ? numberValue : null
}
