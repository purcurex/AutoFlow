import { validateChangeGroup, type ReplicaChangeGroup } from './replica-change-contract'

const fixture = (): ReplicaChangeGroup => ({
  groupKey: 'commit-1', afterCursor: 'opaque-start', endCursor: 'opaque-end',
  committedAt: '2026-11-11T01:00:00Z', expectedCount: 1,
  events: [{ eventId: 'e-1', entityCode: 'hzkj_order', sourceId: '90071992547409931',
    sourceVersion: '999999999999999999999', operation: 'delete', localDocumentId: '0f050af6-799a-4c71-bfe6-77837f573ae5',
    documentNumber: 'TO-test', linesComplete: true, rows: [], affectedOrderIds: [] }],
  projections: [],
})

it('keeps large source identifiers and versions exact', () => {
  expect(validateChangeGroup(fixture()).events[0].sourceVersion).toBe('999999999999999999999')
})
it('rejects incomplete manifests, duplicate identities and missing source versions', () => {
  const missing = fixture(); missing.expectedCount = 2
  expect(() => validateChangeGroup(missing)).toThrow('manifest')
  const repeated = fixture(); repeated.expectedCount = 2; repeated.events.push(repeated.events[0])
  expect(() => validateChangeGroup(repeated)).toThrow('duplicate')
  const bad = fixture(); bad.events[0].sourceVersion = '1e12'
  expect(() => validateChangeGroup(bad)).toThrow('version')
})
it('rejects an unbounded group and invalid timestamps before opening a transaction', () => {
  const bad = fixture(); bad.committedAt = 'invalid'
  expect(() => validateChangeGroup(bad)).toThrow('time')
  const tooLarge = fixture(); tooLarge.expectedCount = 1001
  expect(() => validateChangeGroup(tooLarge)).toThrow('manifest')
})
