export const WORK_REGIONS = [
  { code: 'US', zone: 'America/New_York', name: '美东 · 纽约', englishName: 'New York · US East', color: '#768bc6' },
  { code: 'EUR', zone: 'Europe/Berlin', name: '中欧 · 柏林', englishName: 'Berlin · Central Europe', color: '#3aab9c' },
  { code: 'AUD', zone: 'Australia/Sydney', name: '澳东 · 悉尼', englishName: 'Sydney · AU East', color: '#cf9b53' },
] as const

const BEIJING_ZONE = 'Asia/Shanghai'
const HOUR = 3_600_000, DAY = 24 * HOUR
const pad = (value: number) => String(value).padStart(2, '0')
const formatters = new Map<string, Intl.DateTimeFormat>()

function zonedTime(instant: Date, zone: string) {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    formatters.set(zone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]))
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day)
  const hour = Number(parts.hour), minute = Number(parts.minute), second = Number(parts.second)
  const dayStamp = Date.UTC(year, month - 1, day)
  const utcOffsetMinutes = (dayStamp + hour * HOUR + minute * 60_000 + second * 1000 - Math.floor(instant.getTime() / 1000) * 1000) / 60_000
  return {
    year, month, day, hour, minute, second, dayStamp, utcOffsetMinutes,
    date: `${year}-${pad(month)}-${pad(day)}`, shortDate: `${pad(month)}/${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}:${pad(second)}`, weekday: new Date(dayStamp).getUTCDay(),
  }
}

// Resolve a daytime wall clock using that date's zone rules, not today's fixed offset.
// 09:00 / 17:00 are outside DST's repeated or skipped early-morning hours in these cities.
function workBoundary(dayStamp: number, hour: number, zone: string) {
  const wallClock = dayStamp + hour * HOUR
  let instant = wallClock
  for (let attempt = 0; attempt < 3; attempt++) {
    const offset = zonedTime(new Date(instant), zone).utcOffsetMinutes
    const resolved = wallClock - offset * 60_000
    if (resolved === instant) break
    instant = resolved
  }
  return new Date(instant)
}

export function getWorkCalendar(now: Date) {
  const beijing = zonedTime(now, BEIJING_ZONE)
  return {
    beijing,
    regions: WORK_REGIONS.map(region => {
      const local = zonedTime(now, region.zone)
      const start = workBoundary(local.dayStamp, 9, region.zone), end = workBoundary(local.dayStamp, 17, region.zone)
      const startInBeijing = zonedTime(start, BEIJING_ZONE), endInBeijing = zonedTime(end, BEIJING_ZONE)
      const isWeekday = local.weekday > 0 && local.weekday < 6
      const status = !isWeekday ? 'weekend' : now >= start && now < end ? 'working' : 'off'
      const startHour = startInBeijing.hour + startInBeijing.minute / 60
      const endHour = endInBeijing.hour + endInBeijing.minute / 60
      const endDayOffset = Math.round((endInBeijing.dayStamp - startInBeijing.dayStamp) / DAY)
      const segments = endDayOffset > 0
        ? [...(endHour > 0 ? [{ start: 0, end: endHour }] : []), { start: startHour, end: 24 }]
        : [{ start: startHour, end: endHour }]
      return {
        ...region, local, status, segments, endDayOffset,
        beijingStart: startInBeijing.time.slice(0, 5), beijingEnd: endInBeijing.time.slice(0, 5),
        beijingDate: startInBeijing.date,
        differenceHours: (local.utcOffsetMinutes - beijing.utcOffsetMinutes) / 60,
      }
    }),
  }
}
