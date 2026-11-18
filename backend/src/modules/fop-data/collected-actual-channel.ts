type Row = Record<string, any>
const text = (value: unknown): string | null => typeof value === 'string' ? value.trim() || null : null

/** Plain names are supplied by the Chinese-language FOP session; never translate an English fallback. */
export function actualChannelChineseName(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return text((value as Row).zh_CN)
  return text(value)
}

function channelValue(channel: Row | null | undefined) {
  const name = actualChannelChineseName(channel?.name), code = text(channel?.number)
  return name || code ? { name, code } : null
}

const owns = (row: Row | undefined, key: string) => !!row && Object.prototype.hasOwnProperty.call(row, key)
const packageRows = (raw: Row | undefined): Row[] => Array.isArray(raw?.hzkj_logistics_info)
  ? raw.hzkj_logistics_info.filter((row: unknown) => row && typeof row === 'object' && !Array.isArray(row)) : []
const hasPackageChannel = (row: Row) => owns(row, 'hzkj_channel_name') || owns(row, 'hzkj_channel')

/** Freight-calculation package rows are the actual channels selected before review. */
export function collectedActualChannels(raw: Row | undefined) {
  const packages = packageRows(raw)
  const values = packages.some(hasPackageChannel)
    ? packages.map(row => owns(row, 'hzkj_channel_name') ? channelValue({ name: row.hzkj_channel_name }) : channelValue(row.hzkj_channel))
    : [channelValue(raw?.hzkj_logistics_channel)]
  const channels = values.filter((channel): channel is NonNullable<typeof channel> => channel !== null)
  const unique = channels.filter((channel, index) => channels.findIndex(other => other.name === channel.name && other.code === channel.code) === index)
  return unique.length ? unique : null
}

/** Shared by display and exception classification, including same-document supplemental capture. */
export function collectedPackageSource(display: Row, raw: Row | undefined, companyId?: string): Row | undefined {
  const capture = display?.moneyCapture
  if (raw && !owns(raw, 'hzkj_logistics_info') && companyId && capture?.sourceId === raw.id && capture?.orderNumber === raw.billno && capture?.companyId === companyId
    && ['order-detail', 'order-list'].includes(capture?.operation) && owns(capture.values, 'hzkj_logistics_info')) {
    raw = { ...raw, hzkj_logistics_info: capture.values.hzkj_logistics_info }
  }
  return raw
}

/** Prefer this fulfillment's package facts; legacy supplements must remain unambiguous. */
export function withCollectedActualChannel(display: Row, raw: Row | undefined, companyId?: string): Row {
  raw = collectedPackageSource(display, raw, companyId)
  const packages = packageRows(raw)
  if (owns(raw, 'hzkj_logistics_info') && !packages.length) return { ...display, logisticsChannels: null, logisticsInfo: [], trackingNumber: null }
  const hasPackages = packages.some(row => hasPackageChannel(row) || owns(row, 'hzkj_tracking_number'))
  if (!owns(raw, 'hzkj_logistics_channel') && !hasPackages) return display
  const channels = collectedActualChannels(raw)
  // FOP's own package facts are authoritative; do not re-prove them through dispatch/Shopify.
  if (hasPackages) return { ...display, logisticsChannels: channels,
    trackingNumber: packages.length === 1 ? text(packages[0].hzkj_tracking_number) : null,
    logisticsInfo: packages.map(row => {
    const channel = owns(row, 'hzkj_channel_name') ? channelValue({name: row.hzkj_channel_name}) : channelValue(row.hzkj_channel)
    return { carrierName: null, channelName: channel?.name ?? null, channelCode: channel?.code ?? null,
      packageNumber: text(row.hzkj_combofield), packageTrackingNumber: text(row.hzkj_tracking_number),
      trackingFieldProvided: owns(row, 'hzkj_tracking_number'), source: 'fulfillment_package' }
  }) }
  const channel = channels?.length === 1 && packages.length <= 1 ? channels[0] : null
  const groups = display.logisticsInfo
  const logisticsInfo = channel?.name && Array.isArray(groups) && groups.length === 1
    ? groups.map((group: Row) => group.channelName || (group.channelCode && group.channelCode !== channel.code) ? group : { ...group, channelName: channel.name, channelCode: channel.code })
    : channels && (groups == null || (Array.isArray(groups) && groups.length === 0))
      ? channels.map(item => ({ channelName: item.name, channelCode: item.code, trackingNumbers: [] }))
      : groups
  return { ...display, logisticsChannels: channels, logisticsInfo }
}

/** Pending fulfillment follows the current linked dispatch header, before package writeback. */
export function withCollectedOrderLogistics(display: Row, raw: Row | undefined, companyId: string | undefined, query: {queue?: string; completed?: boolean}): Row {
  if (query.queue !== 'dispatch' || query.completed) return withCollectedActualChannel(display, raw, companyId)
  const documents: Row[] = Array.isArray(display.dispatchDocuments) ? display.dispatchDocuments : []
  const logisticsInfo = documents.filter(doc => (doc.association?.state ?? 'verified') === 'verified'
    && doc.rawInterceptStatus !== 'CANCELLED' && doc.deliveryStatus !== 'CANCELLED').map(doc => ({
      channelName: text(doc.channelName), channelCode: text(doc.channelCode),
      trackingNumbers: (Array.isArray(doc.trackingNumbers) ? doc.trackingNumbers : [])
        .filter((t: Row) => t.type === 'full' && text(t.number))
        .map((t: Row) => ({type: 'full', number: text(t.number)!})),
    }))
  const numbers = [...new Set(logisticsInfo.flatMap(group => group.trackingNumbers.map((t: Row) => t.number)))]
  return {...display, logisticsInfo, logisticsChannels: logisticsInfo.map(group => ({name: group.channelName, code: group.channelCode})),
    trackingNumber: numbers.length === 1 ? numbers[0] : null}
}
