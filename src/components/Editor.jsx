import { motion } from 'motion/react'
import { useStore, MINUTE, MAX_STEPS } from '../store'
import { whenLabel } from '../lib/schedule'
import RepeatPicker from './RepeatPicker'

const PRIORITIES = ['Low', 'Normal', 'Urgent']
const PRESETS = [15, 25, 45, 60]

/** Task sheet: title, category, priority (mass), focus length, repeat, and the steps shown under the orb. */
export default function Editor({ task }) {
  const s = useStore.getState()
  const categories = useStore((st) => st.categories)
  const routine = task.repeat && task.routine
  const waiting = task.status === 'scheduled'
  const minutes = Math.round(task.durationMs / MINUTE)
  const stop = (e) => e.stopPropagation()

  return (
    <motion.div
      className="sheet glass backdrop-blur-3xl"
      role="dialog"
      aria-label="Edit task"
      data-testid="editor"
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.target.dataset.step) s.setEditor(null)
      }}
    >
      <input
        className="sheet-title"
        aria-label="Task title"
        autoFocus
        maxLength={200}
        value={task.title}
        onChange={(e) => s.updateTask(task.id, { title: e.target.value })}
        onBlur={(e) => !e.target.value.trim() && s.updateTask(task.id, { title: 'Untitled' })}
      />

      <div className="sheet-row">
        <span className="sheet-label">Category</span>
        <div className="cat-pills" role="radiogroup" aria-label="Category">
          {categories.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={task.categoryId === c.id}
              className={`cat-pill ${task.categoryId === c.id ? 'is-on' : ''}`}
              style={{ '--h': c.hue }}
              onClick={() => s.setCategory(task.id, c.id)}
            >
              <span className="cat-dot" />
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-row">
        <span className="sheet-label">Priority</span>
        <div className="seg" role="radiogroup" aria-label="Priority">
          {PRIORITIES.map((label, i) => (
            <button key={label} role="radio" aria-checked={task.priority === i} className={task.priority === i ? 'is-on' : ''} onClick={() => s.updateTask(task.id, { priority: i })}>
              <span className={`pip pip-${i}`} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-row">
        <span className="sheet-label">Focus</span>
        <div className="seg" aria-label="Focus length presets">
          {PRESETS.map((m) => (
            <button key={m} className={minutes === m ? 'is-on' : ''} onClick={() => s.updateTask(task.id, { durationMs: m * MINUTE })}>
              {m}m
            </button>
          ))}
        </div>
        <label className="sheet-min">
          <input
            type="number"
            min="1"
            max="600"
            aria-label="Focus length in minutes"
            value={minutes}
            onKeyDown={stop}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value))
              if (Number.isFinite(v) && v >= 1) s.updateTask(task.id, { durationMs: Math.min(600, v) * MINUTE })
            }}
          />
          min
        </label>
      </div>

      <RepeatPicker value={task.repeat} onChange={(rule) => s.setRepeat(task.id, rule)} showHint={!routine} />
      {routine && (
        <div className="routine-stats">
          {task.routine.streak > 0 ? (
            <span className="flame-stat" title="Times in a row">
              <Flame /> {task.routine.streak} in a row
            </span>
          ) : (
            <span>Finish it to start a streak</span>
          )}
          {task.routine.best > 0 && <span>Best {Math.max(task.routine.best, task.routine.streak)}</span>}
          <span className="flex-1" />
          <span className={task.routine.carried ? 'meta-warn' : ''}>
            {waiting ? `Next ${whenLabel(task.routine.due)}` : task.routine.carried ? 'Carried over' : task.routine.due > Date.now() ? `Early · counts for ${whenLabel(task.routine.due)}` : 'Due now'}
          </span>
        </div>
      )}

      <div className="sheet-steps">
        <div className="sheet-label">
          Steps <span className="sheet-note">Tick them off under the orb while you focus</span>
        </div>
        {task.subtasks.map((sub, i) => (
          <div className="step" key={sub.id}>
            <button
              className={`step-check ${sub.status === 'done' ? 'is-done' : ''}`}
              aria-label={sub.status === 'todo' ? `Mark step ${i + 1} done` : `Reopen step ${i + 1}`}
              title={sub.status === 'todo' ? 'Mark done' : 'Reopen'}
              onClick={() => s.toggleStep(task.id, sub.id)}
            >
              {sub.status === 'done' && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.2 4.2 7.5 8 2.8" /></svg>}
            </button>
            <input
              data-step="1"
              className={sub.status === 'done' ? 'is-done' : ''}
              placeholder={`Step ${i + 1}`}
              aria-label={`Step ${i + 1}`}
              maxLength={120}
              value={sub.title}
              autoFocus={sub.title === '' && i === task.subtasks.length - 1}
              onChange={(e) => s.updateStep(task.id, sub.id, { title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (task.subtasks.length < MAX_STEPS && e.currentTarget.value.trim()) s.addStep(task.id)
                }
              }}
            />
            <button className="step-x" aria-label={`Remove step ${i + 1}`} title="Remove step" onClick={() => s.removeStep(task.id, sub.id)}>
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m2 2 6 6M8 2 2 8" /></svg>
            </button>
          </div>
        ))}
        {task.subtasks.length < MAX_STEPS ? (
          <button className="step-add" onClick={() => s.addStep(task.id)}>+ Add step</button>
        ) : (
          <div className="sheet-note">Up to {MAX_STEPS} steps per task</div>
        )}
      </div>

      <div className="sheet-foot">
        {routine ? (
          <button className="btn btn-danger" onClick={() => s.deleteTask(task.id)}>Delete routine</button>
        ) : (
          <button className="btn btn-danger" onClick={() => s.resolve(task.id, 'cancelled')}>Cancel task</button>
        )}
        <span className="flex-1" />
        {waiting ? (
          <button className="btn" onClick={() => s.doNow(task.id)}>Do it now</button>
        ) : (
          <>
            {routine && <button className="btn" onClick={() => s.resolve(task.id, 'cancelled')}>Skip</button>}
            <button className="btn" onClick={() => s.resolve(task.id, 'done')}>Mark done</button>
          </>
        )}
        <button className="btn btn-primary" onClick={() => s.setEditor(null)}>Close</button>
      </div>
    </motion.div>
  )
}

export const Flame = ({ size = 11 }) => (
  <svg className="flame" width={size} height={size} viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
    <path d="M6.3.5c.3 2.2-1 3.3-2 4.4C3.2 6 2 7.3 2 9.2A4 4 0 0 0 6 13.5a4 4 0 0 0 4-4.1c0-1.6-.8-2.8-1.6-3.6.1 1.3-.4 2.2-1.2 2.5.5-2.6-.2-5.8-.9-7.8Z" />
  </svg>
)
