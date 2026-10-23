import { createHash } from 'crypto'
import { businessDate } from './fop-business-time'
import { FOP_CARRIERS } from './fop-carriers'
import type { FopIdentity, FopOrderCandidate } from './fop-data.types'
import type { FopFreightCandidate } from './fop-freight.types'
import { convertFreightAmount } from './fop-freight'

/** Independent delivery cost fixtures; customer order/receipt amounts are never used. */
export function demoFreight(identity: FopIdentity, orders: FopOrderCandidate[], now = new Date()): FopFreightCandidate[] {
  const owners = [...new Map(orders.filter(r => r.owner && r.salesDepartmentCode).map(r => [r.owner!.id, r])).values()]
  if (!owners.length) return []
  const year = Number(businessDate(now).slice(0, 4)), rows: FopFreightCandidate[] = []
  for (let y = Math.max(2019, year - 5); y <= year; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let c = 0; c < FOP_CARRIERS.length; c++) {
        for (let week = 0; week < 4; week++) {
          const day = 2 + week * 7, date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const confirmedAt = `${date}T10:00:00+08:00`
          if (Date.parse(confirmedAt) > now.getTime()) continue
          const key = `${y}${String(m).padStart(2, '0')}${String(day).padStart(2, '0')}-${c}`
          const hash = createHash('sha256').update(`${identity.tenantId}:freight:${key}`).digest().readUInt32BE(0)
          const owner = owners[hash % owners.length], carrier = FOP_CARRIERS[c]
          const originalCurrency = c === 1 ? 'USD' : c === 5 ? 'EUR' : 'CNY'
          const fxRateToUsd = originalCurrency === 'USD' ? 1 : originalCurrency === 'EUR' ? 1.09 : 1 / 7.12
          const originalAmount = (originalCurrency === 'CNY' ? 4500 + hash % 28500 : 600 + hash % 4300) / 100
          const warehouseCode = hash % 3 === 0 ? 'SZ' as const : 'HZ' as const
          rows.push({
            tenantId: identity.tenantId, departmentPathIds: owner.departmentPathIds,
            id: `${identity.tenantId}:freight:${key}`, documentNumber: `DL-${key}`, orderNumber: `SO-DEMO-FRT-${key}`, trackingNumber: `${carrier.id}${hash}${y}`,
            carrierCode: carrier.id, carrierName: carrier.id === 'OTHER' ? '顺友物流' : carrier.label, channelName: `${carrier.label}标准专线`,
            warehouseCode, warehouse: warehouseCode === 'HZ' ? '杭州仓' : '深圳仓',
            customerId: owner.customerId!, customerCode: owner.customerCode!, customerName: owner.customerName,
            organization: owner.organization, department: owner.department, owner: owner.owner, salesDepartmentCode: owner.salesDepartmentCode,
            originalAmount, originalCurrency, fxRateToUsd, fxRateDate: date, fxRateSource: 'DEMO 固定示例汇率', amount: convertFreightAmount(originalAmount, fxRateToUsd), currency: 'USD',
            confirmedAt, reviewStatus: 'approved', costStatus: 'confirmed',
          })
        }
      }
    }
  }
  // Exclusion cases are explicitly pending, not a fictitious free delivery.
  for (const row of rows.slice(-6)) rows.push({ ...row, id: `${row.id}:pending`, documentNumber: `${row.documentNumber}-P`, originalAmount: 0, amount: 0, confirmedAt: null, costStatus: 'pending' })
  return rows
}
