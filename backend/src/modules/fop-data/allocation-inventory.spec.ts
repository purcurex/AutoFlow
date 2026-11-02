import { inventoryTargets, inventorySnapshot, AllocationInventoryScope } from './allocation-inventory'
const scope = (id: string, customerId: string | null): AllocationInventoryScope => ({ id, sku: 'SKU-1', name: 'Lamp', warehouseCode: 'HZ', warehouse: '杭州仓', customer: customerId ? { id: customerId, name: customerId } : null, owner: { id: 'e1' }, department: { id: 'd1' } })
const scopes = [scope('public', null), scope('c1', 'c1'), scope('c2', 'c2')]
const business = { role: 'salesperson' as const, employeeId: 'e1', departmentId: null }
const request = [{ sku: 'SKU-1', warehouseCode: 'HZ', customerId: 'c1' }]
it('restricts selected inventory to public and corresponding customer and deduplicates public pools', () => {
  expect(inventoryTargets(scopes, business, request.concat(request)).map(s => s.id)).toEqual(['public', 'c1'])
})
it('requires independent grants for both pools even for zero balances', () => {
  expect(() => inventoryTargets([scopes[0]], business, request)).toThrow()
  expect(() => inventoryTargets(scopes.map(s => ({ ...s, owner: { id: 'other' } })), business, request)).toThrow()
})
it('searches authorized SKUs only, not other customer ownership or product names', () => {
  const rows = [...scopes, { ...scope('secret', 'c3'), owner: { id: 'other' } }]
  expect(inventoryTargets(rows, business, undefined, 'sku-1').map(s => s.id)).toEqual(['public', 'c1', 'c2'])
  expect(inventoryTargets(rows, business, undefined, 'Lamp')).toEqual([])
  expect(() => inventoryTargets(rows, business, undefined, ' ')).toThrow()
})
it('fills absent authorized pools with zero only after a complete successful snapshot', () => {
  const rows = inventorySnapshot(scopes, { complete: true, asOf: '2026-10-28T01:00:00Z', items: [{ scopeId: 'public', onHand: 10, occupied: 3 }] })
  expect(rows[0]).toMatchObject({ onHand: 10, occupied: 3, free: 7 })
  expect(rows[1]).toMatchObject({ onHand: 0, occupied: 0, free: 0 })
  expect(() => inventorySnapshot(scopes, { complete: false, asOf: '', items: [] })).toThrow()
})
it('rejects malformed, duplicate, unrequested and negative balances', () => {
  const row = { scopeId: 'public', onHand: 10, occupied: 3 }
  for (const items of [[row, row], [{ ...row, onHand: -1 }], [{ ...row, scopeId: 'unknown' }], [{ ...row, occupied: NaN }]]) expect(() => inventorySnapshot(scopes, { complete: true, asOf: '2026-10-28T01:00:00Z', items })).toThrow()
  expect(() => inventoryTargets([...scopes, scope('duplicate', null)], business, request)).toThrow()
})
