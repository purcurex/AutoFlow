/** Sum displayed monetary values in cents instead of accumulating floating-point errors. */
export function sumMoney(values: readonly number[]): number {
  return values.reduce((cents, value) => {
    const [digits, exponent = '0'] = Math.abs(value).toString().split('e')
    return cents + Math.round(Number(`${digits}e${Number(exponent) + 2}`)) * Math.sign(value)
  }, 0) / 100
}

/** An incomplete quotation is unknown, not a zero-value quote. */
export function sumCompleteMoney(values: readonly unknown[]): number | null {
  if (!values.length) return null
  const amounts: number[] = []
  for (const value of values) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) return null
    amounts.push(Number(value))
  }
  return sumMoney(amounts)
}
