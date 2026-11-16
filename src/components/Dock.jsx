import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore, MINUTE } from '../store'
import { sound } from '../lib/sound'
import { PART_LABEL, daysLabel, fmtHM } from '../lib/schedule'
import RepeatPicker from './RepeatPicker'

const DURATIONS = [15, 25, 45, 60]
const PRIORITY_LABEL = ['Low', 'Normal', 'Urgent']

export const RepeatIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7.2V6.5A2.5 2.5 0 0 1 5.5 4H12m0 0-2-2m2 2-2 2M13 8.8v.7A2.5 2.5 0 0 1 10.5 12H4m0 0 2 2m-2-2 2-2" />
  </svg>
)

/** Bottom-center composer: add tasks (with category and repeat), open routines, the log and help, toggle sound. */
export default function Dock() {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(1)
  const [minutes, setMinutes] = useState(25)
  const [repeat, setRepeat] = useState(null)
  const [repeatOpen, setRepeatOpen] = useState(false)
  const input = useRef(null)
  const panel = useStore((s) => s.panel)
  const view = useStore((s) => s.view)
  const categories = useStore((s) => s.categories)
  const soundOn = useStore((s) => s.settings.sound)
  const resolvedCount = useStore((s) => Object.values(s.tasks).filter((t) => t.status === 'done' || t.status === 'cancelled').length)
  const dueCount = useStore((s) => Object.values(s.tasks).filter((t) => t.status === 'active' && t.routine?.fresh).length)
  const [catId, setCatId] = useState(() => (view !== 'all' ? view : categories.some((c) => c.id === 'misc') ? 'misc' : categories[0]?.id))
  const cat = categories.find((c) => c.id === catId) || categories[0]

  // Esc closes the repeat popover before anything else.
  useEffect(() => {
    if (!repeatOpen) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setRepeatOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [repeatOpen])

  // The composer files new tasks into whichever category is open.
  useEffect(() => {
    if (view !== 'all') setCatId(view)
  }, [view])

  // "/" or "n" jumps to the composer from anywhere in the overlay.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/' || e.key === 'n') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (e) => {
    e.preventDefault()
    const id = useStore.getState().addTask({ title, priority, durationMs: minutes * MINUTE, categoryId: cat?.id, repeat })
    if (id) {
      setTitle('')
      setRepeat(null)
      setRepeatOpen(false)
      sound.latch()
    }
  }

  const cycleCat = () => {
    const i = categories.findIndex((c) => c.id === cat?.id)
    setCatId(categories[(i + 1) % categories.length].id)
  }

  return (
    <>
    <AnimatePresence>
      {repeatOpen && (
        <motion.div
          key="repeat"
          className="dock-pop glass backdrop-blur-3xl"
          role="dialog"
          aria-label="Repeat new task"
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.12 } }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <div className="panel-head">
            <span>Make it a routine</span>
            <button className="link" onClick={() => setRepeatOpen(false)}>Done</button>
          </div>
          <RepeatPicker value={repeat} onChange={setRepeat} compact />
          <div className="panel-note">Vitro brings the task back at that time and sends a notification.</div>
        </motion.div>
      )}
    </AnimatePresence>
    <motion.form
      className="dock glass backdrop-blur-3xl"
      data-testid="dock"
      onSubmit={submit}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26, delay: 0.12 }}
    >
      {cat && (
        <button
          type="button"
          className="dock-chip dock-cat"
          style={{ '--h': cat.hue }}
          title="Category (click to change)"
          aria-label={`Category: ${cat.name}`}
          onClick={cycleCat}
        >
          <span className="cat-dot" />
          <span className="dock-cat-name">{cat.name}</span>
        </button>
      )}
      <button
        type="button"
        className={`dock-icon dock-pri pri-${priority}`}
        title={`${PRIORITY_LABEL[priority]} priority (click to change; heavier tasks carry more momentum)`}
        aria-label={`Priority: ${PRIORITY_LABEL[priority]}`}
        onClick={() => setPriority((p) => (p + 1) % 3)}
      >
        <span className={`pip pip-${priority}`} />
      </button>
      <input
        ref={input}
        className="dock-input"
        placeholder={repeat ? 'New routine…' : 'New task…'}
        aria-label="New task title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            if (title) setTitle('')
            else e.currentTarget.blur()
          }
        }}
      />
      <button
        type="button"
        className={`dock-chip dock-repeat ${repeat ? 'is-set' : ''} ${repeatOpen ? 'is-open' : ''}`}
        title={repeat ? 'Repeats (click to change)' : 'Make it a routine'}
        aria-label={repeat ? `Repeats ${daysLabel(repeat.days)}` : 'Repeat'}
        aria-expanded={repeatOpen}
        onClick={() => setRepeatOpen((o) => !o)}
      >
        <RepeatIcon />
        {repeat && <span>{repeat.time ? fmtHM(repeat.time) : PART_LABEL[repeat.part]}</span>}
      </button>
      <button
        type="button"
        className="dock-chip"
        title="Focus length"
        aria-label={`Focus length: ${minutes} minutes`}
        onClick={() => setMinutes((m) => DURATIONS[(DURATIONS.indexOf(m) + 1) % DURATIONS.length])}
      >
        {minutes}m
      </button>
      <button type="submit" className="dock-add" disabled={!title.trim()} aria-label="Add task" title="Add task (Return)">
        <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M7 2v10M2 7h10" /></svg>
      </button>
      <span className="dock-sep" />
      <button
        type="button"
        className={`dock-icon ${panel === 'routines' ? 'is-on' : ''}`}
        title="Routines"
        aria-label="Open routines"
        onClick={() => useStore.getState().setPanel('routines')}
      >
        <RepeatIcon size={16} />
        {dueCount > 0 && <span className="badge badge-due">{dueCount}</span>}
      </button>
      <button
        type="button"
        className={`dock-icon ${panel === 'log' ? 'is-on' : ''}`}
        title="Finished and cancelled tasks"
        aria-label="Open log"
        onClick={() => useStore.getState().setPanel('log')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
        {resolvedCount > 0 && <span className="badge">{resolvedCount}</span>}
      </button>
      <button
        type="button"
        className="dock-icon"
        title={soundOn ? 'Sound on' : 'Sound off'}
        aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}
        aria-pressed={soundOn}
        onClick={() => useStore.getState().setSetting('sound', !soundOn)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.2h2.2L8 3.5v9L4.7 9.8H2.5z" />
          {soundOn ? <path d="M10.5 5.8a3 3 0 0 1 0 4.4M12.3 4a5.5 5.5 0 0 1 0 8" /> : <path d="m10.8 6.2 3.2 3.6m0-3.6-3.2 3.6" />}
        </svg>
      </button>
      <button
        type="button"
        className={`dock-icon ${panel === 'help' ? 'is-on' : ''}`}
        title="Gestures"
        aria-label="Show gestures"
        onClick={() => useStore.getState().setPanel('help')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 6.2a2 2 0 1 1 2.9 1.8c-.6.3-.9.8-.9 1.4" /><circle cx="8" cy="11.9" r=".5" fill="currentColor" /></svg>
      </button>
    </motion.form>
    </>
  )
}
