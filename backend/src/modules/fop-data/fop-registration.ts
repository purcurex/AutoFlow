import { FopRegistrationEntry, SALES_DEPARTMENTS } from './fop-data.types'

/** Input must already belong to the authenticated analytics subject. */
export function aggregateRegistrations(entries: FopRegistrationEntry[], from: string, to: string) {
  if (!Array.isArray(entries)) throw new Error('Invalid registration ledger')
  const dates: string[] = []
  for (let time = Date.parse(`${from}T00:00:00Z`); time <= Date.parse(`${to}T00:00:00Z`); time += 86_400_000) dates.push(new Date(time).toISOString().slice(0, 10))
  const departments = SALES_DEPARTMENTS.map(item => ({ ...item, counts: dates.map(() => 0), salespeople: new Map<string, { id: string; name: string; counts: number[] }>() }))
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0, 10) !== entry.date
      || !Number.isSafeInteger(entry.count) || entry.count < 0 || !entry.owner || typeof entry.owner.id !== 'string' || !entry.owner.id.trim()
      || typeof entry.owner.name !== 'string' || !entry.owner.name.trim()) throw new Error('Invalid registration attribution')
    const department = departments.find(item => item.id === entry.salesDepartmentCode)
    if (!department) throw new Error('Unknown registration department')
    const key = JSON.stringify([entry.date, entry.salesDepartmentCode, entry.owner.id])
    if (seen.has(key)) throw new Error('Duplicate registration attribution')
    seen.add(key)
    const day = dates.indexOf(entry.date)
    if (day < 0) continue
    let person = department.salespeople.get(entry.owner.id)
    if (!person) {
      person = { id: entry.owner.id, name: entry.owner.name, counts: dates.map(() => 0) }
      department.salespeople.set(person.id, person)
    }
    department.counts[day] += entry.count
    person.counts[day] += entry.count
  }
  const registrations = dates.map((date, day) => ({ date, count: departments.reduce((sum, department) => sum + department.counts[day], 0) }))
  if (registrations.some(item => !Number.isSafeInteger(item.count))) throw new Error('Registration total overflow')
  return {
    registrations,
    registrationDepartments: departments.map(department => ({ ...department, salespeople: [...department.salespeople.values()].sort((a, b) => a.id.localeCompare(b.id)) })),
  }
}
