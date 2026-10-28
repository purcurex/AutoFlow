import type { LogisticsChannel } from './fop-data.types'

/** The trusted gateway supplies the FOP-maintained English name; never translate or infer it here. */
export function normalizeCustomLogisticsChannelName(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null
}

/** Only actual channel names/codes from the trusted gateway are public. */
export function normalizeLogisticsChannels(value: unknown): LogisticsChannel[] | null {
  if (!Array.isArray(value)) return null
  const clean = (text: unknown): string | null => typeof text === 'string' ? text.trim() || null : null
  const channels = new Map<string, LogisticsChannel>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const name = clean(item.name), code = clean(item.code)
    if (name || code) channels.set(JSON.stringify([name, code]), { name, code })
  }
  return channels.size ? [...channels.values()] : null
}

export function logisticsChannelLabel(channel: LogisticsChannel): string {
  return channel.name && channel.code ? `${channel.name}（${channel.code}）` : channel.name || channel.code || '—'
}
