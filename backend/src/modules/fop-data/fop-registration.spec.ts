import { aggregateRegistrations } from './fop-registration'
import { FopRegistrationEntry } from './fop-data.types'

const entry: FopRegistrationEntry = { date: '2026-10-20', salesDepartmentCode: 'sales1', owner: { id: 'employee-a', name: 'Alice' }, count: 3 }
describe('registration attribution contract', () => {
  it('filters dates, fills missing days, and keeps same-name employees distinct', () => {
    const result = aggregateRegistrations([entry, { ...entry, owner: { id: 'employee-b', name: 'Alice' }, count: 2 }, { ...entry, date: '2026-10-19', count: 100 }], '2026-10-20', '2026-10-21')
    expect(result.registrations).toEqual([{ date: '2026-10-20', count: 5 }, { date: '2026-10-21', count: 0 }])
    expect(result.registrationDepartments[0].salespeople.map(person => person.counts)).toEqual([[3, 0], [2, 0]])
  })
  it('rejects duplicate attribution and malformed values rather than presenting incorrect counts', () => {
    expect(() => aggregateRegistrations([entry, entry], '2026-10-20', '2026-10-21')).toThrow('Duplicate')
    for (const bad of [{ ...entry, count: -1 }, { ...entry, count: NaN }, { ...entry, date: '2026-02-30' }, { ...entry, salesDepartmentCode: 'other' }, { ...entry, owner: { id: '', name: 'Alice' } }]) {
      expect(() => aggregateRegistrations([bad as FopRegistrationEntry], '2026-10-20', '2026-10-21')).toThrow()
    }
  })
})
