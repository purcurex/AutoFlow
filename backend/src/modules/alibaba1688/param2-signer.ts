import { createHmac } from 'node:crypto'

export type Param2Value = string | number | boolean | null | undefined | object

export function buildParam2SignaturePath(
  version: string,
  namespace: string,
  method: string,
  appKey: string,
): string {
  return `param2/${version}/${namespace}/${method}/${appKey}`
}
export function serializeParam2Parameters(
  values: Record<string, Param2Value>,
): Record<string, string> {
  const serialized: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue
    serialized[name] = serializeParam2Value(value)
  }
  return serialized
}

export function serializeParam2Value(value: Exclude<Param2Value, null | undefined>): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(canonicalizeJson(value))
}

export function signParam2Request(
  signaturePath: string,
  parameters: Record<string, string>,
  appSecret: string,
): string {
  const sortedPairs = Object.entries(parameters)
    .filter(([name]) => name !== '_aop_signature')
    .map(([name, value]) => `${name}${value}`)
    .sort()
  const content = `${signaturePath}${sortedPairs.join('')}`
  return createHmac('sha1', appSecret)
    .update(content, 'utf8')
    .digest('hex')
    .toUpperCase()
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key]
    if (child !== undefined) output[key] = canonicalizeJson(child)
  }
  return output
}
