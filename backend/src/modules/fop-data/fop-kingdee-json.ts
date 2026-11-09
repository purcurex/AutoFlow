/** 只修正旧金蝶包裹数量映射的数字类型；金额、版本、页码和其他字段保持原契约。 */
export function parseKingdeeEnvelope(text: string): unknown {
  const sourceNumbers = new WeakMap<object, Map<string, string>>()
  return JSON.parse(text, function (this: object, key: string, value: unknown, context?: { source?: string }) {
    // reviver先访问子字段，保存其原始JSON数字文本，不能用已转换的Number重建高精度数量。
    if (typeof value === 'number' && !Array.isArray(this) && context?.source) {
      const fields = sourceNumbers.get(this) ?? new Map<string, string>()
      fields.set(key, context.source); sourceNumbers.set(this, fields)
    }
    if (key !== 'lineQuantities' || !value || typeof value !== 'object' || Array.isArray(value)) return value
    const fields = sourceNumbers.get(value)
    return Object.fromEntries(Object.entries(value).map(([lineId, quantity]) => {
      if (typeof quantity !== 'number') return [lineId, quantity]
      const source = fields?.get(lineId)
      // 运行环境不提供原始数字文本时拒绝，不把已舍入的数字冒充精确数量。
      if (source === undefined) throw new Error('Lossless Kingdee decimal parsing unavailable')
      return [lineId, source]
    }))
  }) as unknown
}
