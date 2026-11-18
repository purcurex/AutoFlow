/** Keep each receipt notice's carrier, waybill and shipping time together. */
export function receiptLogistics(notices: Record<string, any>[]) {
  const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
  return [...new Map(notices.map(notice => {
    const source = text(notice.shippedAt)
    // FOP local datetime fields are Beijing time, independent of server timezone.
    const stamp = source && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(source) ? source.replace(' ', 'T') + '+08:00' : source
    const shippedAt = stamp && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : null
    return [String(notice.id), { noticeId: String(notice.id), noticeNumber: text(notice.number), shippedAt, carrier: text(notice.carrier), trackingNumber: text(notice.trackingNumber) }] as const
  })).values()].sort((a, b) => (b.shippedAt ?? '').localeCompare(a.shippedAt ?? '') || a.noticeId.localeCompare(b.noticeId))
}
