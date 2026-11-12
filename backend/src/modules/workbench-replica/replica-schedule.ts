import { REPLICA_BUSINESS_INTERVAL_MINUTES } from './replica-sync-policy'

const OFFSET = 8 * 3600_000
const MINUTE = 60_000
const slots = [30, 150, 270, 390, 510, ...Array.from({ length: 20 }, (_, i) => 540 + i * REPLICA_BUSINESS_INTERVAL_MINUTES), 1230, 1350]

function candidates(now: Date): Date[] {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid schedule time')
  const shifted = new Date(now.getTime() + OFFSET)
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - OFFSET
  return [-1, 0, 1].flatMap(day => slots.map(slot => new Date(midnight + day * 86400_000 + slot * MINUTE)))
}

/** Daily schedule is independent of the process timezone, browser and login state. */
export function nextReplicaSync(now: Date): Date {
  return candidates(now).find(slot => slot > now)!
}

/** Missed slots coalesce into the latest due increment, never replay one full job per missed slot. */
export function dueReplicaSync(now: Date, lastScheduled: Date): Date | null {
  const due = candidates(now).filter(slot => slot <= now && slot > lastScheduled)
  return due[due.length - 1] ?? null
}
