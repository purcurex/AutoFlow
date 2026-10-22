import { describe, expect, it } from 'vitest'
import { latestVolumeWindow, volumeColor } from '@/utils/order-volume'

describe('order volume presentation', () => {
  it('opens latest six months and latest fourteen elapsed days, leaving future days reachable', () => {
    const periods = Array.from({ length: 31 }, (_, i) => ({ future: i >= 22 }))
    expect(latestVolumeWindow('day', periods)).toEqual({ startValue: 8, endValue: 21 })
    expect(latestVolumeWindow('month', periods.slice(0, 10))).toEqual({ startValue: 4, endValue: 9 })
    expect(latestVolumeWindow('week', periods.slice(0, 4))).toEqual({ startValue: 0, endValue: 3 })
  })
  it('uses one aggregate color and stable object colors in both warehouse charts', () => {
    expect(volumeColor({ id: 'total', kind: 'total' })).toBe('#94A5DD')
    expect(volumeColor({ id: 'other', kind: 'other' })).toBe('#B5BFCE')
    expect(volumeColor({ id: 'employee:u1', kind: 'detail' })).toBe(volumeColor({ id: 'employee:u1', kind: 'detail' }))
  })
  it('gives each carrier its own consistent color and reserves gray for Other', () => {
    const colors = ['YT', '4PX', 'WB', 'YW', 'JS', 'OTHER'].map(id => volumeColor({ id: `carrier:${id}`, kind: 'detail' }))
    expect(new Set(colors).size).toBe(6)
    expect(colors).not.toContain(volumeColor({ id: 'total', kind: 'total' }))
    expect(colors[5]).toBe('#B5BFCE')
  })
})
