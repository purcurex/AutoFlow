import { describe, expect, it } from 'vitest'
import { getWorkCalendar } from '@/utils/workCalendar'

describe('regional work calendar', () => {
  it('uses each region’s local weekday, including a US workday after Beijing midnight', () => {
    const calendar = getWorkCalendar(new Date('2026-10-23T16:30:00Z'))
    expect(calendar.beijing).toMatchObject({ date: '2026-10-24', time: '00:30:00', weekday: 6 })
    expect(calendar.regions.map(region => [region.code, region.local.time, region.status])).toEqual([
      ['US', '12:30:00', 'working'], ['EUR', '18:30:00', 'off'], ['AUD', '03:30:00', 'weekend'],
    ])
    expect(calendar.regions[0]).toMatchObject({ beijingStart: '21:00', beijingEnd: '05:00', endDayOffset: 1 })
    expect(calendar.regions[0]!.segments).toEqual([{ start: 0, end: 5 }, { start: 21, end: 24 }])
  })

  it.each([
    ['2026-01-15T12:00:00Z', [['22:00', '06:00'], ['16:00', '00:00'], ['06:00', '14:00']]],
    ['2026-07-15T12:00:00Z', [['21:00', '05:00'], ['15:00', '23:00'], ['07:00', '15:00']]],
    // Europe has switched back while the US is still on daylight saving time.
    ['2026-10-26T12:00:00Z', [['21:00', '05:00'], ['16:00', '00:00'], ['06:00', '14:00']]],
  ])('converts the eight-hour work window using seasonal time-zone rules (%s)', (instant, windows) => {
    const regions = getWorkCalendar(new Date(instant)).regions
    expect(regions.map(region => [region.beijingStart, region.beijingEnd])).toEqual(windows)
    for (const region of regions) expect(region.segments.reduce((hours, segment) => hours + segment.end - segment.start, 0)).toBe(8)
  })

  it('includes 09:00, excludes 17:00, and excludes weekends in the local zone', () => {
    const us = (instant: string) => getWorkCalendar(new Date(instant)).regions[0]!
    expect(us('2026-10-22T12:59:59Z').status).toBe('off')
    expect(us('2026-10-22T13:00:00Z').status).toBe('working')
    expect(us('2026-10-22T20:59:59Z').status).toBe('working')
    expect(us('2026-10-22T21:00:00Z').status).toBe('off')
    expect(us('2026-10-24T14:00:00Z').status).toBe('weekend')
  })
})
