import { create } from 'zustand'
import { platform } from './lib/platform'

export const MINUTE = 60_000
export const MAX_STEPS = 6

const uid = () => Math.random().toString(36).slice(2, 10) + (Date.now() % 1e6).toString(36)

export const elapsedOf = (t, now = Date.now()) =>
  t.timer.elapsedMs + (t.timer.startedAt ? Math.max(0, now - t.timer.startedAt) : 0)
export const remainingOf = (t, now = Date.now()) => t.durationMs - elapsedOf(t, now)
export const isRunning = (t) => !!t.timer.startedAt
export const stepsDone = (t) => t.subtasks.filter((s) => s.status === 'done').length

function makeTask(p = {}) {
  return {
    id: uid(),
    title: 'Untitled',
    priority: 1, // 0 low · 1 normal · 2 urgent
    durationMs: 25 * MINUTE,
    subtasks: [], // [{ id, title, status: 'todo' | 'done' }]
    status: 'active', // 'active' | 'done' | 'cancelled'
    slot: 0,
    pos: null, // { fx, fy } once the user has placed it by hand
    createdAt: Date.now(),
    resolvedAt: null,
    ...p,
    timer: { elapsedMs: 0, startedAt: null, notified: false, ...(p.timer || {}) },
  }
}

const pause = (t, now) =>
  t.timer.startedAt ? { ...t, timer: { ...t.timer, elapsedMs: elapsedOf(t, now), startedAt: null } } : t

function nextSlot(tasks, ignoreId) {
  const used = new Set()
  for (const t of Object.values(tasks)) if (t.status === 'active' && t.id !== ignoreId) used.add(t.slot)
  let i = 0
  while (used.has(i)) i++
  return i
}

function seedTasks() {
  const sub = (title) => ({ id: uid(), title, status: 'todo' })
  const list = [
    makeTask({
      title: 'Ship the Q4 roadmap draft',
      priority: 2,
      durationMs: 45 * MINUTE,
      subtasks: [sub('Outline milestones'), sub('Estimate effort'), sub('Write the summary')],
    }),
    makeTask({
      title: 'Reply to the design review',
      priority: 1,
      durationMs: 25 * MINUTE,
      subtasks: [sub('Read the comments'), sub('Post responses')],
    }),
    makeTask({ title: 'Book a dentist appointment', priority: 0, durationMs: 15 * MINUTE }),
    makeTask({
      title: 'Refactor the auth module',
      priority: 2,
      durationMs: 60 * MINUTE,
      subtasks: [sub('Map current flows'), sub('Extract token service'), sub('Update call sites'), sub('Run the test suite')],
    }),
    makeTask({ title: 'Plan the weekend hike', priority: 0, durationMs: 25 * MINUTE }),
  ]
  const tasks = {}
  list.forEach((t, i) => {
    tasks[t.id] = { ...t, slot: i, createdAt: Date.now() + i }
  })
  return tasks
}

/** Repair anything inconsistent in saved data so a bad file can never brick the app. */
export function sanitize(data) {
  if (!data || typeof data !== 'object' || typeof data.tasks !== 'object' || !data.tasks) return null
  const tasks = {}
  for (const raw of Object.values(data.tasks)) {
    if (!raw || typeof raw.id !== 'string') continue
    if (raw.parentId) continue // shards from older versions: their steps still live on the parent
    const { shattered, parentId, subId, shape, ...rest } = raw // eslint-disable-line no-unused-vars
    const t = makeTask(rest)
    t.title = String(t.title || 'Untitled').slice(0, 200)
    t.priority = [0, 1, 2].includes(t.priority) ? t.priority : 1
    t.durationMs = Math.max(MINUTE, Number(t.durationMs) || 25 * MINUTE)
    t.subtasks = Array.isArray(t.subtasks)
      ? t.subtasks
          .filter((s) => s && typeof s.id === 'string')
          .slice(0, MAX_STEPS)
          .map((s) => ({ id: s.id, title: String(s.title || ''), status: s.status === 'done' ? 'done' : 'todo' }))
      : []
    t.status = ['active', 'done', 'cancelled'].includes(t.status) ? t.status : 'active'
    if (t.pos && !(Number.isFinite(t.pos.fx) && Number.isFinite(t.pos.fy))) t.pos = null
    // A timer left running when the app last closed stops at the last heartbeat.
    if (t.timer.startedAt) {
      const until = Math.max(t.timer.startedAt, Math.min(Date.now(), Number(data.beat) || t.timer.startedAt))
      t.timer = { ...t.timer, elapsedMs: t.timer.elapsedMs + (until - t.timer.startedAt), startedAt: null }
    }
    tasks[t.id] = t
  }
  const seen = new Set()
  for (const t of Object.values(tasks)) {
    if (t.status !== 'active') continue
    if (seen.has(t.slot) || !Number.isInteger(t.slot) || t.slot < 0) {
      let i = 0
      while (seen.has(i)) i++
      t.slot = i
    }
    seen.add(t.slot)
  }
  let focusId = data.focusId
  if (!tasks[focusId] || tasks[focusId].status !== 'active') focusId = null
  return {
    tasks,
    focusId,
    settings: { sound: true, helpSeen: false, ...(data.settings || {}) },
  }
}

export const useStore = create((set, get) => ({
  // ----- persisted -----
  tasks: {},
  focusId: null,
  settings: { sound: true, helpSeen: false },
  // ----- session only -----
  hydrated: false,
  open: false,
  editorId: null,
  panel: null, // 'log' | 'help' | null
  toast: null,
  fx: [],
  draggingId: null,
  dropHot: false,
  throwIntent: null, // { dir: 'done' | 'cancel' | 'snooze', committed: bool } while the orb is held
  autoFinish: null, // task id whose last step was just ticked off

  hydrate(data) {
    const clean = sanitize(data)
    if (clean) set({ ...clean, hydrated: true })
    else set({ tasks: seedTasks(), focusId: null, hydrated: true })
  },

  setOpen: (open) =>
    set(open ? { open } : { open, editorId: null, panel: null, draggingId: null, dropHot: false, throwIntent: null }),
  setEditor: (editorId) => set({ editorId, panel: null }),
  setPanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel, editorId: null })),
  setDragging: (draggingId) => set({ draggingId, ...(draggingId ? {} : { dropHot: false, throwIntent: null }) }),
  setDropHot: (dropHot) => get().dropHot !== dropHot && set({ dropHot }),
  setThrowIntent(intent) {
    const cur = get().throwIntent
    if (cur?.dir === intent?.dir && cur?.committed === intent?.committed) return
    set({ throwIntent: intent })
  },
  setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
  clearAutoFinish: () => set({ autoFinish: null }),

  addFx(fx) {
    const id = uid()
    set((s) => ({ fx: [...s.fx, { id, ...fx }] }))
    setTimeout(() => set((s) => ({ fx: s.fx.filter((f) => f.id !== id) })), 1400)
  },
  showToast: (text, snapshot = null) => set({ toast: { id: uid(), text, snapshot } }),
  dismissToast: (id) => set((s) => (s.toast && (!id || s.toast.id === id) ? { toast: null } : s)),

  // ----- task CRUD -----
  addTask({ title, priority = 1, durationMs = 25 * MINUTE }) {
    const clean = String(title || '').trim().slice(0, 200)
    if (!clean) return null
    const s = get()
    const t = makeTask({ title: clean, priority, durationMs, slot: nextSlot(s.tasks) })
    set({ tasks: { ...s.tasks, [t.id]: t } })
    return t.id
  },
  updateTask(id, patch) {
    const s = get()
    const t = s.tasks[id]
    if (!t) return
    const next = { ...t, ...patch }
    if (patch.title !== undefined) next.title = String(patch.title).slice(0, 200)
    if (patch.durationMs !== undefined) {
      next.durationMs = Math.max(MINUTE, Math.min(24 * 60 * MINUTE, Math.round(patch.durationMs)))
      next.timer = { ...next.timer, notified: false }
    }
    set({ tasks: { ...s.tasks, [id]: next } })
  },
  addStep(id) {
    const t = get().tasks[id]
    if (!t || t.subtasks.length >= MAX_STEPS) return
    get().updateTask(id, { subtasks: [...t.subtasks, { id: uid(), title: '', status: 'todo' }] })
  },
  updateStep(id, subId, patch) {
    const t = get().tasks[id]
    if (!t) return
    get().updateTask(id, { subtasks: t.subtasks.map((x) => (x.id === subId ? { ...x, ...patch } : x)) })
  },
  removeStep(id, subId) {
    const t = get().tasks[id]
    if (!t) return
    get().updateTask(id, { subtasks: t.subtasks.filter((x) => x.id !== subId) })
  },
  /** Tick a step on or off. Ticking the last open step of the focused task flags it to finish. */
  toggleStep(id, subId) {
    const s = get()
    const t = s.tasks[id]
    if (!t) return
    const subtasks = t.subtasks.map((x) => (x.id === subId ? { ...x, status: x.status === 'done' ? 'todo' : 'done' } : x))
    const wasAll = t.subtasks.length > 0 && t.subtasks.every((x) => x.status === 'done')
    const nowAll = subtasks.length > 0 && subtasks.every((x) => x.status === 'done')
    set({
      tasks: { ...s.tasks, [id]: { ...t, subtasks } },
      autoFinish: !wasAll && nowAll && s.focusId === id ? id : s.autoFinish === id ? null : s.autoFinish,
    })
  },
  setPos(id, pos) {
    const s = get()
    const t = s.tasks[id]
    if (t) set({ tasks: { ...s.tasks, [id]: { ...t, pos } } })
  },

  // ----- focus + timer -----
  focus(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.status !== 'active') return
    const now = Date.now()
    const tasks = { ...s.tasks }
    if (s.focusId && s.focusId !== id && tasks[s.focusId]) tasks[s.focusId] = pause(tasks[s.focusId], now)
    const done = remainingOf(t, now) <= 0
    tasks[id] = { ...t, timer: { ...t.timer, startedAt: done ? null : t.timer.startedAt || now } }
    set({ tasks, focusId: id })
  },
  /** Send the focused task back to its edge slot, timer paused, progress kept. */
  snooze(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t) return
    set({
      tasks: { ...s.tasks, [id]: { ...pause(t, Date.now()), pos: null } },
      focusId: s.focusId === id ? null : s.focusId,
      autoFinish: s.autoFinish === id ? null : s.autoFinish,
    })
  },
  togglePause(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t) return
    const now = Date.now()
    if (t.timer.startedAt) set({ tasks: { ...s.tasks, [id]: pause(t, now) } })
    else if (remainingOf(t, now) > 0) set({ tasks: { ...s.tasks, [id]: { ...t, timer: { ...t.timer, startedAt: now } } } })
  },
  addTime(id, ms) {
    const s = get()
    const t = s.tasks[id]
    if (!t) return
    const now = Date.now()
    // Extending an expired timer continues from "now", not from the overtime.
    const base = pause(t, now)
    const elapsed = Math.min(base.timer.elapsedMs, base.durationMs)
    const wasFocused = s.focusId === id
    set({
      tasks: {
        ...s.tasks,
        [id]: {
          ...base,
          durationMs: Math.min(24 * 60 * MINUTE, base.durationMs + ms),
          timer: { elapsedMs: elapsed, startedAt: wasFocused && (t.timer.startedAt || remainingOf(t, now) <= 0) ? now : null, notified: false },
        },
      },
    })
  },
  markNotified(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t) return
    // The clock stops at zero; the orb stays put until the user triages it.
    set({ tasks: { ...s.tasks, [id]: { ...t, timer: { elapsedMs: t.durationMs, startedAt: null, notified: true } } } })
  },

  // ----- triage -----
  /** outcome: 'done' | 'cancelled' */
  resolve(id, outcome) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.status !== 'active') return false
    const now = Date.now()
    const snapshot = snap(s, now)
    set({
      tasks: { ...s.tasks, [id]: { ...pause(t, now), status: outcome === 'done' ? 'done' : 'cancelled', resolvedAt: now } },
      focusId: s.focusId === id ? null : s.focusId,
      autoFinish: s.autoFinish === id ? null : s.autoFinish,
      toast: { id: uid(), text: `${outcome === 'done' ? 'Done' : 'Cancelled'} · ${t.title}`, snapshot },
      editorId: null,
    })
    return true
  },
  undo() {
    const s = get()
    if (!s.toast?.snapshot) return
    set({ tasks: s.toast.snapshot.tasks, focusId: s.toast.snapshot.focusId, toast: null, autoFinish: null })
  },
  restore(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.status === 'active') return
    const allDone = t.subtasks.length > 0 && t.subtasks.every((x) => x.status === 'done')
    const spent = t.timer.elapsedMs >= t.durationMs
    set({
      tasks: {
        ...s.tasks,
        [id]: {
          ...t,
          status: 'active',
          resolvedAt: null,
          pos: null,
          slot: nextSlot(s.tasks),
          subtasks: allDone ? t.subtasks.map((x) => ({ ...x, status: 'todo' })) : t.subtasks,
          timer: { elapsedMs: spent ? 0 : t.timer.elapsedMs, startedAt: null, notified: false },
        },
      },
    })
  },
  clearLog() {
    const s = get()
    const tasks = {}
    for (const t of Object.values(s.tasks)) if (t.status === 'active') tasks[t.id] = t
    set({ tasks, toast: null })
  },
}))

function snap(s, now) {
  const tasks = {}
  for (const t of Object.values(s.tasks)) tasks[t.id] = pause(t, now)
  return { tasks, focusId: s.focusId }
}

// ----- persistence -----
export const persistable = (s) => ({ v: 2, tasks: s.tasks, focusId: s.focusId, settings: s.settings, beat: Date.now() })

let saveTimer = null
export function saveNow() {
  clearTimeout(saveTimer)
  saveTimer = null
  const s = useStore.getState()
  if (s.hydrated) platform.save(persistable(s))
}
useStore.subscribe((s, prev) => {
  if (!s.hydrated) return
  if (s.tasks === prev.tasks && s.focusId === prev.focusId && s.settings === prev.settings && prev.hydrated) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 250)
})
