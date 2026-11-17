import { describe, expect, it } from 'vitest'
import { isUncollectedPage } from '@/utils/workbench-data'
import type { WorkbenchDataAvailability } from '@/api/workbench-replica'

const availability = (extra: Partial<WorkbenchDataAvailability> = {}): WorkbenchDataAvailability => ({
  mode: 'collected', complete: false, missingDatasets: ['allocation', 'rma'], ...extra,
})

describe('collected queue availability', () => {
  it('preserves an explicitly available queue when a filter returns no rows', () => {
    expect(isUncollectedPage({ items: [], dataAvailability: availability({ queueAvailable: true }) })).toBe(false)
  })
  it('distinguishes a blocked queue from a complete empty result', () => {
    expect(isUncollectedPage({ items: [], dataAvailability: availability({ queueAvailable: false }) })).toBe(true)
    expect(isUncollectedPage({ items: [], dataAvailability: availability({ missingDatasets: [] }) })).toBe(false)
  })
  it('keeps legacy missing-dataset responses unavailable without hiding known rows', () => {
    expect(isUncollectedPage({ items: [], dataAvailability: availability() })).toBe(true)
    expect(isUncollectedPage({ items: [{ id: 'known' }], dataAvailability: availability() })).toBe(false)
  })
})
