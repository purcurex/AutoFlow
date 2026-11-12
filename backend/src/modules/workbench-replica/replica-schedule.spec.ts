import { nextReplicaSync, dueReplicaSync } from './replica-schedule'

describe('Beijing replica schedule', () => {
  it('includes the morning, business endpoints, weekends and two-hour night slots', () => {
    expect(nextReplicaSync(new Date('2026-11-13T00:29:59Z')).toISOString()).toBe('2026-11-13T00:30:00.000Z')
    expect(nextReplicaSync(new Date('2026-11-13T00:30:00Z')).toISOString()).toBe('2026-11-13T01:00:00.000Z')
    expect(nextReplicaSync(new Date('2026-11-13T10:29:00Z')).toISOString()).toBe('2026-11-13T10:30:00.000Z')
    expect(nextReplicaSync(new Date('2026-11-13T10:30:00Z')).toISOString()).toBe('2026-11-13T12:30:00.000Z')
    expect(nextReplicaSync(new Date('2026-11-13T22:30:00Z')).toISOString()).toBe('2026-11-14T00:30:00.000Z')
  })
  it('only returns a due slot once and never invents frequent off-hour work', () => {
    expect(dueReplicaSync(new Date('2026-11-13T11:00:00Z'), new Date('2026-11-13T10:30:00Z'))).toBeNull()
    expect(dueReplicaSync(new Date('2026-11-13T01:13:00Z'), new Date('2026-11-13T01:00:00Z'))).toBeNull()
    expect(dueReplicaSync(new Date('2026-11-13T01:33:00Z'), new Date('2026-11-13T01:00:00Z'))?.toISOString()).toBe('2026-11-13T01:30:00.000Z')
  })
  it('uses 30-minute business intervals rather than a timer for every page', () => {
    expect(nextReplicaSync(new Date('2026-11-13T01:01:00Z')).toISOString()).toBe('2026-11-13T01:30:00.000Z')
    expect(nextReplicaSync(new Date('2026-11-13T09:31:00Z')).toISOString()).toBe('2026-11-13T10:00:00.000Z')
  })
})
