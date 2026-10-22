/** Shared display order for analytics, filters and the demo order ledger. */
export const FOP_CARRIERS = [
  { id: 'YT', label: '云途YT' }, { id: '4PX', label: '4PX' }, { id: 'WB', label: '万邦WB' },
  { id: 'YW', label: '燕文YW' }, { id: 'JS', label: '极速JS' }, { id: 'OTHER', label: '其他' },
] as const

export function normalizeCarrierCode(code?: string | null): string {
  return FOP_CARRIERS.some(carrier => carrier.id === code) ? code! : 'OTHER'
}
