// Recurring tasks ("routines"): when each occurrence is due.
//
// A repeat rule is { days: [0..6] (Sunday = 0), part: 'morning' | 'afternoon' |
// 'evening', time: 'HH:MM' | null }. An occurrence falls on each listed day at
// `time`, or at the start of `part` when no exact time is set. All arithmetic
// is in local time, so DST changes keep "6:00 PM" at 6:00 PM.

export const PARTS = ['morning', 'afternoon', 'evening']
export const PART_LABEL = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }
export const DEFAULT_PART_TIMES = { morning: '08:00', afternoon: '13:00', evening: '18:00' }
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS = [1, 2, 3, 4, 5]

/** 'HH:MM' → minutes after midnight, or null when malformed. */
export function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function fmtHM(s) {
  const mins = parseHM(s)
  if (mins == null) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** A valid rule, or null. */
export function cleanRepeat(r) {
  if (!r || typeof r !== 'object') return null
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : []
  if (!days.length) return null
  const part = PARTS.includes(r.part) ? r.part : 'morning'
  const time = parseHM(r.time) == null ? null : r.time.trim().padStart(5, '0')
  return { days, part, time }
}

export function cleanPartTimes(p) {
  const out = { ...DEFAULT_PART_TIMES }
  if (p && typeof p === 'object') for (const k of PARTS) if (parseHM(p[k]) != null) out[k] = p[k].trim().padStart(5, '0')
  return out
}

function minutesOf(repeat, parts) {
  return parseHM(repeat.time) ?? parseHM(parts?.[repeat.part]) ?? parseHM(DEFAULT_PART_TIMES[repeat.part])
}

/** The occurrence on the calendar day containing `day` (ms), or null when that day is not in the rule. */
export function occurrenceOn(day, repeat, parts) {
  const d = new Date(day)
  if (!repeat.days.includes(d.getDay())) return null
  const mins = minutesOf(repeat, parts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60, 0, 0).getTime()
}

function shiftDays(t, n) {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12).getTime()
}

/** First occurrence strictly after `after`. */
export function nextOccurrence(repeat, after, parts) {
  for (let i = 0; i <= 8; i++) {
    const t = occurrenceOn(shiftDays(after, i), repeat, parts)
    if (t != null && t > after) return t
  }
  return null
}

/** Last occurrence at or before `at`. */
export function prevOccurrence(repeat, at, parts) {
  for (let i = 0; i <= 8; i++) {
    const t = occurrenceOn(shiftDays(at, -i), repeat, parts)
    if (t != null && t <= at) return t
  }
  return null
}

export function sameDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export function daysLabel(days) {
  const key = [...days].sort().join('')
  if (key === '0123456') return 'Every day'
  if (key === '12345') return 'Weekdays'
  if (key === '06') return 'Weekends'
  if (days.length === 1) return `${DAY_SHORT[days[0]]}s`
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_SHORT[d]).join(' ')
}

/** "Every day · Evening" or "Weekdays · 9:30 PM" */
export function describeRepeat(repeat) {
  return `${daysLabel(repeat.days)} · ${repeat.time ? fmtHM(repeat.time) : PART_LABEL[repeat.part]}`
}

/** "Today 6:00 PM", "Tomorrow 8:00 AM", "Tue 8:00 AM" */
export function whenLabel(ts, now = Date.now()) {
  const d = new Date(ts)
  const hm = fmtHM(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`)
  if (sameDay(ts, now)) return `Today ${hm}`
  if (sameDay(ts, shiftDays(now, 1))) return `Tomorrow ${hm}`
  if (sameDay(ts, shiftDays(now, -1))) return `Yesterday ${hm}`
  return `${DAY_SHORT[d.getDay()]} ${hm}`
}
