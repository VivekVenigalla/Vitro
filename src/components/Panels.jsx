import { useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store'
import { isApp } from '../lib/platform'

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
    .filter((t) => t.status !== 'active' && !t.parentId)
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
        <div className="panel-empty">Nothing here yet. Throw a focused task up or right to finish it.</div>
      ) : (
        <ul className="log-list">
          {list.map((t) => (
            <li key={t.id}>
              <span className={`log-mark ${t.status}`}>{t.status === 'done' ? '✓' : '✕'}</span>
              <span className="log-title">{t.title}</span>
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
  ['Summon / dismiss', isApp ? 'Double-tap ⌥ Option, or click the menu-bar icon' : 'Double-tap ⌥ Option (Alt), or click the menu-bar icon'],
  ['Focus', 'Drag a card to the center and let go'],
  ['Done', 'Throw the orb up or right'],
  ['Cancel', 'Throw the orb straight down'],
  ['Snooze', 'Throw the orb left'],
  ['Pause / resume', 'Click the orb'],
  ['Shatter into steps', '⌥ Option-click a card that has 2–4 steps'],
  ['Re-fuse', 'Drop a shard next to a sibling shard'],
  ['Rename', 'Double-click a card or shard'],
  ['New task', 'Press / or N, type, Return'],
]

export function HelpPanel() {
  useEffect(() => {
    useStore.getState().setSetting('helpSeen', true)
  }, [])
  return (
    <motion.div className="panel glass backdrop-blur-3xl" role="dialog" aria-label="Gestures" data-testid="help" {...pop}>
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
