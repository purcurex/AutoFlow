const BLOCKED_KEYS =
  /^(?:access_?token|refresh_?token|appsecret|_aop_signature|imagebase64|token|traceinfo)$/i
const HTTP_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_SNAPSHOT_STRING_BYTES = 64 * 1024
const TRUNCATION_SUFFIX = '...[truncated]'
const CIRCULAR_REFERENCE_MARKER = '[circular]'

/**
 * 将未知的1688响应转换为可持久化的脱敏快照。
 *
 * 核心约束：始终创建新对象，不修改Provider返回值；根节点不是普通记录时返回空记录。
 */
export function sanitizeSourcingSnapshot(
  value: unknown,
): Record<string, unknown> {
  const sanitized = sanitizeValue(value, new WeakSet<object>())
  return isPlainRecord(sanitized) ? sanitized : {}
}

/**
 * 递归复制数组和对象，并在当前递归路径中识别循环引用，避免深层响应导致栈无限递归。
 */
function sanitizeValue(
  value: unknown,
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value)
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  if (ancestors.has(value)) {
    return CIRCULAR_REFERENCE_MARKER
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, ancestors))
    }

    const sanitizedRecord: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      // 敏感键在任意嵌套层级均整项删除，不能把值替换后继续持久化。
      if (BLOCKED_KEYS.test(key)) {
        continue
      }
      // 使用数据属性复制任意Provider键，避免`__proto__`触发对象原型写入器。
      Object.defineProperty(sanitizedRecord, key, {
        configurable: true,
        enumerable: true,
        value: sanitizeValue(nestedValue, ancestors),
        writable: true,
      })
    }
    return sanitizedRecord
  } finally {
    ancestors.delete(value)
  }
}

/**
 * 清除HTTP(S) URL中的认证信息和全部查询参数，并限制单个字符串的快照体积。
 */
function sanitizeString(value: string): string {
  let sanitizedValue = value

  try {
    const parsedUrl = new URL(value)
    if (HTTP_PROTOCOLS.has(parsedUrl.protocol)) {
      parsedUrl.username = ''
      parsedUrl.password = ''
      parsedUrl.search = ''
      sanitizedValue = parsedUrl.toString()
    }
  } catch {
    // 普通文本不是URL，继续按快照字符串处理即可。
  }

  if (
    Buffer.byteLength(sanitizedValue, 'utf8') <= MAX_SNAPSHOT_STRING_BYTES
  ) {
    return sanitizedValue
  }

  let prefixBytes = 0
  let prefixEnd = 0
  for (const character of sanitizedValue) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (prefixBytes + characterBytes > MAX_SNAPSHOT_STRING_BYTES) {
      break
    }
    prefixBytes += characterBytes
    prefixEnd += character.length
  }
  return `${sanitizedValue.slice(0, prefixEnd)}${TRUNCATION_SUFFIX}`
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
