import { useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store'
import { isApp } from '../lib/platform'
import { PARTS, PART_LABEL, describeRepeat, whenLabel } from '../lib/schedule'
import { useNow } from '../lib/time'
import { Flame } from './Editor'

const pop = {
  initial: { opacity: 0, y: 14, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.14 } },
  transition: { type: 'spring', stiffness: 400, damping: 30 },
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function LogPanel() {
  const tasks = useStore((s) => s.tasks)
  const list = Object.values(tasks)
    .filter((t) => t.status === 'done' || t.status === 'cancelled')
    .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
  const s = useStore.getState()
  return (
    <motion.div className="panel glass backdrop-blur-3xl" role="dialog" aria-label="Log" data-testid="log" {...pop}>
      <div className="panel-head">
        <span>Log</span>
        {list.length > 0 && (
          <button className="link" onClick={() => s.clearLog()}>Clear all</button>
        )}
      </div>
      {list.length === 0 ? (
        <div className="panel-empty">Nothing here yet. Flick a focused task up or right to finish it.</div>
      ) : (
        <ul className="log-list">
          {list.map((t) => (
            <li key={t.id}>
              <span className={`log-mark ${t.status}`}>{t.status === 'done' ? '✓' : '✕'}</span>
              <span className="log-title">
                {t.title}
                {t.routineOf && <span className="log-tag">{t.status === 'done' ? 'routine' : 'skipped'}</span>}
              </span>
              <span className="log-when">{ago(t.resolvedAt || t.createdAt)}</span>
              <button className="link" onClick={() => s.restore(t.id)} aria-label={`Restore ${t.title}`}>Restore</button>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  )
}

const GESTURES = [
  ['Summon / dismiss', isApp ? 'Double-tap ⌥ Option, ⌃⌥Space, or click the menu-bar icon' : 'Double-tap ⌥ Option (Alt), or click the menu-bar icon'],
  ['Focus', 'Drag a card to the center and let go'],
  ['Categories', 'Click a bubble at the top to open it, again for All. Keys 0–8 switch too'],
  ['File a task', 'Drag a card onto a category bubble'],
  ['Edit a category', 'Right-click or double-click its bubble. + adds one'],
  ['Done', 'Flick the orb up or right'],
  ['Cancel', 'Flick the orb down'],
  ['Snooze', 'Flick the orb left'],
  ['Gentler throw', 'Drag the orb past the ring until a label lights up, then let go'],
  ['Pause / resume', 'Click the orb'],
  ['Steps', 'Tick them off under the orb. The last one finishes the task'],
  ['Rename', 'Double-click a card'],
  ['New task', 'Press / or N, type, Return'],
  ['Routines', 'Tap ↻ in the dock before adding, or set Repeat in a task. It comes back at its time'],
]

export function HelpPanel() {
  useEffect(() => {
    useStore.getState().setSetting('helpSeen', true)
  }, [])
  return (
    <motion.div className="panel panel-help glass backdrop-blur-3xl" role="dialog" aria-label="Gestures" data-testid="help" {...pop}>
      <div className="panel-head">
        <span>Gestures</span>
        <button className="link" onClick={() => useStore.getState().setPanel(null)}>Close</button>
      </div>
      <dl className="help-list">
        {GESTURES.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="panel-note">Urgent tasks are heavier: they tilt less, glide farther and take longer to settle.</div>
    </motion.div>
  )
}

/** Every recurring task: when it's next due, its streak, and the times of day. */
export function RoutinesPanel() {
  const tasks = useStore((s) => s.tasks)
  const categories = useStore((s) => s.categories)
  const partTimes = useStore((s) => s.settings.partTimes)
  const now = useNow(true)
  const s = useStore.getState()
  const hue = Object.fromEntries(categories.map((c) => [c.id, c.hue]))
  const list = Object.values(tasks)
    .filter((t) => t.repeat && t.routine && (t.status === 'active' || t.status === 'scheduled'))
    .sort((a, b) => (b.status === 'active') - (a.status === 'active') || a.routine.due - b.routine.due)
  return (
    <motion.div className="panel glass backdrop-blur-3xl" role="dialog" aria-label="Routines" data-testid="routines" {...pop}>
      <div className="panel-head">
        <span>Routines</span>
        <button className="link" onClick={() => s.setPanel(null)}>Close</button>
      </div>
      {list.length === 0 ? (
        <div className="panel-empty">
          No routines yet. Tap ↻ in the dock before adding a task, or set Repeat in any task’s editor. Vitro brings it back at that time and lets you know.
        </div>
      ) : (
        <ul className="routine-list">
          {list.map((t) => {
            const r = t.routine
            const active = t.status === 'active'
            const status = !active
              ? `Next ${whenLabel(r.due, now)}`
              : r.carried
                ? 'Carried over'
                : r.due > now
                  ? 'On screen early'
                  : 'Due now'
            return (
              <li key={t.id} style={{ '--h': hue[t.categoryId] ?? 250 }}>
                <span className="cat-dot" />
                <div className="routine-main">
                  <div className="routine-title">{t.title}</div>
                  <div className="routine-sub">
                    {describeRepeat(t.repeat)} · <span className={active ? (r.carried ? 'meta-warn' : 'is-due') : ''}>{status}</span>
                  </div>
                </div>
                {r.streak > 0 && (
                  <span className="streak" title={`${r.streak} in a row · best ${Math.max(r.best || 0, r.streak)}`}>
                    <Flame /> {r.streak}
                  </span>
                )}
                {!active && (
                  <button className="link" onClick={() => s.doNow(t.id)} aria-label={`Do ${t.title} now`}>
                    Do now
                  </button>
                )}
                <button className="link" onClick={() => s.setEditor(t.id)} aria-label={`Edit ${t.title}`}>
                  Edit
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="panel-note part-times">
        <span>Times of day</span>
        {PARTS.map((p) => (
          <label key={p} className="time-field is-set">
            {PART_LABEL[p]}
            <input
              type="time"
              aria-label={`${PART_LABEL[p]} starts at`}
              value={partTimes[p]}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => e.target.value && s.setPartTimes({ [p]: e.target.value })}
            />
          </label>
        ))}
      </div>
    </motion.div>
  )
}

export function Toast() {
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => useStore.getState().dismissToast(toast.id), toast.snapshot ? 6000 : 3200)
    return () => clearTimeout(id)
  }, [toast])
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className="toast glass backdrop-blur-3xl"
          role="status"
          data-testid="toast"
          initial={{ opacity: 0, y: 12, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 8, x: '-50%', transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <span className="toast-text">{toast.text}</span>
          {toast.snapshot && (
            <button className="link" onClick={() => useStore.getState().undo()}>Undo</button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
