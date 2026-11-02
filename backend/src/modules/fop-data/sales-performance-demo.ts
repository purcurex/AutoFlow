import { createHash } from 'crypto'
import { businessDate } from './fop-business-time'
import type { FopIdentity, FopOrderCandidate } from './fop-data.types'
import type { FopProfitCandidate } from './sales-performance.types'

/** Independent synthetic contribution facts, not a calculation from order/stock cash receipts.
 * Existing FOP realtime reports do not supply this historical, estimated-freight event contract.
 */
export function demoProfits(identity: Readonly<FopIdentity>, references: readonly FopOrderCandidate[], now = new Date()): FopProfitCandidate[] {
  const owners = [...new Map(references.filter(row => row.salesDepartmentCode && row.owner && row.department).map(row => [row.owner!.id, row])).values()].sort((a, b) => a.owner!.id.localeCompare(b.owner!.id))
  const today = businessDate(now), currentMonth = today.slice(0, 7), currentYear = Number(today.slice(0, 4))
  const rows: FopProfitCandidate[] = []
  for (const [ownerIndex, reference] of owners.entries()) {
    const owner = reference.owner!, department = reference.department!
    const base = (key: string, month: string, date: string | null, status: 'settled' | 'estimated', adjustment = 0): FopProfitCandidate => {
      const seed = createHash('sha256').update(`${identity.tenantId}:${owner.id}:${key}`).digest().readUInt32BE(0)
      const incomeAmount = ((key.endsWith('monthly') ? 60000 : 10000) + seed % 15000) / 100, productCost = (3200 + seed % 2400) / 100
      const freightCost = status === 'estimated' ? 8.5 : 9.25
      const refundCost = key.endsWith('refund') ? 30 : 0, returnCost = key.endsWith('refund') ? 5 : 0, otherCost = 1.5
      const amount = (Math.round(incomeAmount * 100) + adjustment * 100 - Math.round(productCost * 100) - Math.round(freightCost * 100) - refundCost * 100 - returnCost * 100 - otherCost * 100) / 100
      const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10)
      const approvedAt = status === 'settled' ? `${nextMonth.slice(0, 8)}03T09:00:00+08:00` : null
      const knownAt = approvedAt ?? `${date}T09:00:00+08:00`
      return {
        tenantId: identity.tenantId, departmentPathIds: [...(reference.departmentPathIds ?? [])], id: `${identity.tenantId}:profit:${owner.id}:${key}`, orderId: `${identity.tenantId}:profit-order:${owner.id}:${key}`,
        orderNumber: `GP${month.replace('-', '')}${date?.slice(-2) ?? '00'}-${String(ownerIndex + 1).padStart(3, '0')}${key.endsWith('refund') ? 'R' : ''}`, customerCode: reference.customerCode ?? 'DEMO', customerName: reference.customerName,
        owner: { ...owner }, department: { ...department }, salesDepartmentCode: reference.salesDepartmentCode!, recognitionMonth: month, recognitionDate: date, knownAt,
        status, settlementId: status === 'settled' ? `demo-settlement:${owner.id}:${month}` : null, settlementNumber: status === 'settled' ? `GP${month.replace('-', '')}${String(ownerIndex + 1).padStart(6, '0')}` : null, version: status === 'settled' ? 'settled-v1' : `event:${date}`, approvedAt,
        cutoffAt: status === 'settled' ? `${nextMonth}T00:00:00+08:00` : new Date(Date.parse(`${date}T00:00:00+08:00`) + 86_400_000).toISOString(), freightBasis: status === 'settled' ? 'frozen' : 'estimated',
        incomeAmount, adjustmentIncome: adjustment, productCost, freightCost, refundCost, returnCost, otherCost, previousRecognizedProfit: 0, roundingAdjustment: 0,
        amount, currency: 'USD', originalAmount: amount, originalCurrency: 'USD', fxRateToUsd: 1, fxRateDate: date ?? `${month}-01`, fxRateSource: 'demo-usd-independent-contribution',
      }
    }
    for (let year = Math.max(2020, currentYear - 2); year <= currentYear; year++) for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, '0')}`
      if (month >= currentMonth) continue
      // One approved undated monthly delta; a separate dated negative adjustment order.
      const monthly = base(`${month}:monthly`, month, null, 'settled')
      rows.push(monthly, base(`${month}:refund`, month, `${month}-18`, 'settled', -250))
      // Earlier estimate for this order is superseded by the approved settlement for its month.
      rows.push({ ...base(`${month}:prior-estimate`, month, `${month}-10`, 'estimated'), orderId: monthly.orderId, orderNumber: monthly.orderNumber })
    }
    const days = new Date(Date.UTC(currentYear, Number(currentMonth.slice(5, 7)), 0)).getUTCDate()
    for (let day = 1; day <= days; day++) {
      const date = `${currentMonth}-${String(day).padStart(2, '0')}`
      // Each row is a NEW event's income/cost contribution. It is never a daily cumulative snapshot.
      rows.push(base(`${date}:${day % 7 === 0 ? 'refund' : 'contribution'}`, currentMonth, date, 'estimated', day % 7 === 0 ? -250 : 0))
    }
  }
  return rows
}
