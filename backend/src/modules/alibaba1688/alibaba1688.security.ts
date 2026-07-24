const SENSITIVE_FIELD_PATTERN = /^(?:access[_-]?token|refresh[_-]?token|app[_-]?secret|client[_-]?secret|authorization|_aop_signature)$/i

export function redactAlibaba1688Sensitive(
  value: unknown,
  knownSecrets: Array<string | undefined> = [],
): unknown {
  const secrets = knownSecrets.flatMap((secret) =>
    typeof secret === 'string' && secret.trim() ? [secret] : [],
  )
  return redactValue(value, secrets, new WeakSet<object>())
}

export function sanitizeAlibaba1688Message(
  value: unknown,
  knownSecrets: Array<string | undefined> = [],
): string {
  const raw = typeof value === 'string' ? value : 'Alibaba 1688 provider request failed'
  let sanitized = raw
  for (const secret of knownSecrets.flatMap((candidate) =>
    typeof candidate === 'string' && candidate.trim() ? [candidate] : [],
  )) {
    sanitized = sanitized.split(secret).join('[REDACTED]')
  }
  sanitized = sanitized
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /(["']?(?:access[_-]?token|refresh[_-]?token|app[_-]?secret|client[_-]?secret|authorization|_aop_signature)["']?\s*[:=]\s*["']?)[^"',\s}&]+/gi,
      '$1[REDACTED]',
    )
  return sanitized.slice(0, 240)
}

function redactValue(value: unknown, secrets: string[], seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return sanitizeAlibaba1688Message(value, secrets)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)

  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets, seen))

  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_FIELD_PATTERN.test(key)
      ? '[REDACTED]'
      : redactValue(child, secrets, seen)
  }
  return output
}
