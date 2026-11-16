import { useState } from 'react'
import { useStore } from '../store'
import {
  PARTS,
  PART_LABEL,
  DAY_LETTER,
  DAY_SHORT,
  EVERY_DAY,
  WEEKDAYS,
  cleanRepeat,
  fmtHM,
  nextOccurrence,
  prevOccurrence,
  sameDay,
  whenLabel,
} from '../lib/schedule'

function modeOf(r) {
  if (!r) return 'off'
  const key = [...r.days].sort().join('')
  if (key === '0123456') return 'daily'
  if (key === '12345') return 'weekdays'
  return 'custom'
}

/**
 * Repeat rule editor: how often (Off / Daily / Weekdays / chosen days) and
 * when (a part of the day, optionally an exact time). Emits a clean rule or
 * null for "doesn't repeat".
 */
export default function RepeatPicker({ value, onChange, compact = false, showHint = true }) {
  const parts = useStore((s) => s.settings.partTimes)
  const [mode, setMode] = useState(() => modeOf(value))
  const [days, setDays] = useState(() => value?.days ?? [new Date().getDay()])
  const part = value?.part ?? 'evening'
  const time = value?.time ?? ''

  const emit = (patch) => {
    const next = { days: value?.days ?? days, part, time: time || null, ...patch }
    onChange(cleanRepeat(next))
  }
  const pickMode = (m) => {
    setMode(m)
    if (m === 'off') return onChange(null)
    const d = m === 'daily' ? EVERY_DAY : m === 'weekdays' ? WEEKDAYS : days
    emit({ days: d })
  }
  const toggleDay = (d) => {
    const nextDays = days.includes(d) ? days.filter((x) => x !== d) : [...days, d]
    setDays(nextDays)
    emit({ days: nextDays })
  }

  const rule = cleanRepeat(value)
  let hint = ''
  if (mode === 'custom' && !days.length) hint = 'Pick at least one day'
  else if (rule) {
    const now = Date.now()
    const prev = prevOccurrence(rule, now, parts)
    const next = nextOccurrence(rule, now, parts)
    hint =
      prev != null && sameDay(prev, now)
        ? `Today’s is already due, so it shows up now · then ${whenLabel(next, now)}`
        : `Shows up ${whenLabel(next, now)}`
  }

  return (
    <div className={`repeat ${compact ? 'is-compact' : ''}`}>
      <div className="sheet-row">
        <span className="sheet-label">Repeat</span>
        <div className="seg" role="radiogroup" aria-label="Repeat">
          {[
            ['off', 'Off'],
            ['daily', 'Daily'],
            ['weekdays', 'Weekdays'],
            ['custom', 'Days…'],
          ].map(([m, label]) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'is-on' : ''} onClick={() => pickMode(m)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'custom' && (
        <div className="sheet-row">
          <span className="sheet-label" />
          <div className="days" role="group" aria-label="Days">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button key={d} aria-pressed={days.includes(d)} aria-label={DAY_SHORT[d]} title={DAY_SHORT[d]} className={days.includes(d) ? 'is-on' : ''} onClick={() => toggleDay(d)}>
                {DAY_LETTER[d]}
              </button>
            ))}
          </div>
        </div>
      )}
      {mode !== 'off' && (
        <div className="sheet-row">
          <span className="sheet-label">When</span>
          <div className="seg" role="radiogroup" aria-label="Part of day">
            {PARTS.map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={!time && part === p}
                className={part === p ? (time ? 'is-soft' : 'is-on') : ''}
                title={`Starts ${fmtHM(parts[p])}`}
                onClick={() => emit({ part: p, time: null })}
              >
                {PART_LABEL[p]}
              </button>
            ))}
          </div>
          <label className={`time-field ${time ? 'is-set' : ''}`} title="Exact time (optional)">
            <input type="time" aria-label="Exact time" value={time} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => emit({ time: e.target.value || null })} />
            {time && (
              <button className="time-clear" aria-label="Clear exact time" onClick={(e) => (e.preventDefault(), emit({ time: null }))}>
                <svg width="8" height="8" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m2 2 6 6M8 2 2 8" /></svg>
              </button>
            )}
          </label>
        </div>
      )}
      {showHint && hint && <div className="repeat-hint">{hint}</div>}
    </div>
  )
}
