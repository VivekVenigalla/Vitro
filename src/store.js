import { create } from 'zustand'
import { platform } from './lib/platform'

export const MINUTE = 60_000
export const MAX_STEPS = 4
const FUSE_MS = 380

const uid = () => Math.random().toString(36).slice(2, 10) + (Date.now() % 1e6).toString(36)

export const elapsedOf = (t, now = Date.now()) =>
  t.timer.elapsedMs + (t.timer.startedAt ? Math.max(0, now - t.timer.startedAt) : 0)
export const remainingOf = (t, now = Date.now()) => t.durationMs - elapsedOf(t, now)
export const isRunning = (t) => !!t.timer.startedAt

function makeTask(p = {}) {
  return {
    id: uid(),
    title: 'Untitled',
    priority: 1, // 0 low · 1 normal · 2 urgent
    durationMs: 25 * MINUTE,
    subtasks: [], // [{ id, title, status: 'todo' | 'done' | 'skipped' }]
    parentId: null, // set on shards
    subId: null,
    shape: 0,
    status: 'active', // 'active' | 'done' | 'cancelled'
    shattered: false,
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
  for (const t of Object.values(tasks)) {
    if (t.status === 'active' && !t.parentId && t.id !== ignoreId) used.add(t.slot)
  }
  let i = 0
  while (used.has(i)) i++
  return i
}

const liveShards = (tasks, parentId) => Object.values(tasks).filter((t) => t.parentId === parentId)

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
    const t = makeTask(raw)
    t.title = String(t.title || 'Untitled').slice(0, 200)
    t.priority = [0, 1, 2].includes(t.priority) ? t.priority : 1
    t.durationMs = Math.max(MINUTE, Number(t.durationMs) || 25 * MINUTE)
    t.subtasks = Array.isArray(t.subtasks)
      ? t.subtasks
          .filter((s) => s && typeof s.id === 'string')
          .map((s) => ({ id: s.id, title: String(s.title || ''), status: ['todo', 'done', 'skipped'].includes(s.status) ? s.status : 'todo' }))
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
  for (const t of Object.values(tasks)) {
    if (!t.parentId) continue
    const parent = tasks[t.parentId]
    if (!parent || parent.status !== 'active' || !parent.shattered || t.status !== 'active' || !t.pos) delete tasks[t.id]
  }
  const seen = new Set()
  for (const t of Object.values(tasks)) {
    if (t.parentId) continue
    if (t.shattered && liveShards(tasks, t.id).length === 0) t.shattered = false
    if (t.status === 'active') {
      if (seen.has(t.slot) || !Number.isInteger(t.slot) || t.slot < 0) {
        let i = 0
        while (seen.has(i)) i++
        t.slot = i
      }
      seen.add(t.slot)
    }
  }
  let focusId = data.focusId
  const f = tasks[focusId]
  if (!f || f.status !== 'active' || f.shattered) focusId = null
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
  births: {}, // one-shot mount hints: { [taskId]: { box, poly } | { solid: true } }
  fusing: null, // { parentId, pieces: { [shardId]: { box, poly } } }
  draggingId: null,
  dropHot: false,

  hydrate(data) {
    const clean = sanitize(data)
    if (clean) set({ ...clean, hydrated: true })
    else set({ tasks: seedTasks(), focusId: null, hydrated: true })
  },

  setOpen: (open) => set(open ? { open } : { open, editorId: null, panel: null, draggingId: null, dropHot: false }),
  setEditor: (editorId) => set({ editorId, panel: null }),
  setPanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel, editorId: null })),
  setDragging: (draggingId) => set({ draggingId, ...(draggingId ? {} : { dropHot: false }) }),
  setDropHot: (dropHot) => get().dropHot !== dropHot && set({ dropHot }),
  setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
  clearBirth: (id) =>
    set((s) => {
      if (!s.births[id]) return s
      const births = { ...s.births }
      delete births[id]
      return { births }
    }),

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
    const tasks = { ...s.tasks, [id]: next }
    // Renaming a shard renames the step it came from.
    if (t.parentId && patch.title !== undefined && tasks[t.parentId]) {
      const p = tasks[t.parentId]
      tasks[p.id] = { ...p, subtasks: p.subtasks.map((x) => (x.id === t.subId ? { ...x, title: next.title } : x)) }
    }
    set({ tasks })
  },
  addStep(id) {
    const t = get().tasks[id]
    if (!t || t.shattered || t.subtasks.length >= MAX_STEPS) return
    get().updateTask(id, { subtasks: [...t.subtasks, { id: uid(), title: '', status: 'todo' }] })
  },
  updateStep(id, subId, patch) {
    const t = get().tasks[id]
    if (!t || t.shattered) return
    get().updateTask(id, { subtasks: t.subtasks.map((x) => (x.id === subId ? { ...x, ...patch } : x)) })
  },
  removeStep(id, subId) {
    const t = get().tasks[id]
    if (!t || t.shattered) return
    get().updateTask(id, { subtasks: t.subtasks.filter((x) => x.id !== subId) })
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
    if (!t || t.status !== 'active' || t.shattered) return
    const now = Date.now()
    const tasks = { ...s.tasks }
    if (s.focusId && s.focusId !== id && tasks[s.focusId]) tasks[s.focusId] = pause(tasks[s.focusId], now)
    const done = remainingOf(t, now) <= 0
    tasks[id] = { ...t, timer: { ...t.timer, startedAt: done ? null : t.timer.startedAt || now } }
    set({ tasks, focusId: id })
  },
  /** Send the focused task back to the periphery, timer paused, progress kept. */
  snooze(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t) return
    const paused = pause(t, Date.now())
    set({
      tasks: { ...s.tasks, [id]: t.parentId ? paused : { ...paused, pos: null } },
      focusId: s.focusId === id ? null : s.focusId,
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
  /** outcome: 'done' | 'cancelled'. Returns { parentCompleted } so the UI can celebrate. */
  resolve(id, outcome) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.status !== 'active') return null
    const now = Date.now()
    const snapshot = snap(s, now)
    const tasks = { ...s.tasks }
    const focusId = s.focusId === id ? null : s.focusId
    let parentCompleted = null
    let text = `${outcome === 'done' ? 'Done' : 'Cancelled'} · ${t.title}`
    if (t.parentId) {
      delete tasks[id]
      const parent = tasks[t.parentId]
      if (parent) {
        const subtasks = parent.subtasks.map((x) =>
          x.id === t.subId ? { ...x, status: outcome === 'done' ? 'done' : 'skipped' } : x,
        )
        let p = { ...parent, subtasks }
        if (liveShards(tasks, parent.id).length === 0) {
          p.shattered = false
          if (subtasks.every((x) => x.status !== 'todo')) {
            const anyDone = subtasks.some((x) => x.status === 'done')
            p = { ...pause(p, now), status: anyDone ? 'done' : 'cancelled', resolvedAt: now }
            if (anyDone) {
              parentCompleted = p.id
              text = `All steps done · ${p.title}`
            } else text = `Cancelled · ${p.title}`
          } else {
            p.pos = null
            p.slot = nextSlot(tasks, p.id)
          }
        }
        tasks[p.id] = p
      }
    } else {
      // Resolving a parent directly also clears any shards still on the desktop.
      for (const sh of liveShards(tasks, id)) delete tasks[sh.id]
      tasks[id] = { ...pause(t, now), status: outcome === 'done' ? 'done' : 'cancelled', shattered: false, resolvedAt: now }
    }
    set({ tasks, focusId: tasks[focusId] ? focusId : null, toast: { id: uid(), text, snapshot }, editorId: null })
    return { parentCompleted }
  },
  undo() {
    const s = get()
    if (!s.toast?.snapshot) return
    set({ tasks: s.toast.snapshot.tasks, focusId: s.toast.snapshot.focusId, toast: null, fusing: null, births: {} })
  },
  restore(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.status === 'active' || t.parentId) return
    const allResolved = t.subtasks.length > 0 && t.subtasks.every((x) => x.status !== 'todo')
    const spent = t.timer.elapsedMs >= t.durationMs
    set({
      tasks: {
        ...s.tasks,
        [id]: {
          ...t,
          status: 'active',
          resolvedAt: null,
          shattered: false,
          pos: null,
          slot: nextSlot(s.tasks),
          subtasks: allResolved ? t.subtasks.map((x) => ({ ...x, status: 'todo' })) : t.subtasks,
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

  // ----- shatter + re-fuse -----
  /** shards: [{ subId, pos: {fx,fy}, shape, birth: { box, poly } }] */
  shatter(id, shards) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.status !== 'active' || t.parentId || t.shattered || s.focusId === id || shards.length < 2) return false
    const now = Date.now()
    const tasks = { ...s.tasks }
    const births = { ...s.births }
    const share = Math.max(MINUTE, Math.round(t.durationMs / Math.max(1, t.subtasks.length) / MINUTE) * MINUTE)
    for (const sh of shards) {
      const sub = t.subtasks.find((x) => x.id === sh.subId)
      if (!sub) continue
      const shard = makeTask({
        title: sub.title || 'Untitled step',
        priority: t.priority,
        durationMs: share,
        parentId: id,
        subId: sub.id,
        shape: sh.shape || 0,
        pos: sh.pos,
        slot: -1,
      })
      tasks[shard.id] = shard
      births[shard.id] = sh.birth
    }
    tasks[id] = { ...pause(t, now), shattered: true }
    set({ tasks, births, editorId: null })
    return true
  },
  /** Start the re-assembly animation, then commit. origin: parent card top-left in px. */
  beginFuse(parentId, pieces, pos) {
    const s = get()
    if (s.fusing || !s.tasks[parentId]?.shattered) return
    const now = Date.now()
    const tasks = { ...s.tasks }
    let focusId = s.focusId
    if (focusId && tasks[focusId]?.parentId === parentId) {
      tasks[focusId] = pause(tasks[focusId], now)
      focusId = null
    }
    set({ tasks, focusId, fusing: { parentId, pieces } })
    setTimeout(() => get().commitFuse(parentId, pos), FUSE_MS)
  },
  commitFuse(parentId, pos) {
    const s = get()
    if (s.fusing?.parentId !== parentId) return
    const tasks = { ...s.tasks }
    const parent = tasks[parentId]
    for (const sh of liveShards(tasks, parentId)) delete tasks[sh.id]
    if (!parent) return set({ tasks, fusing: null })
    tasks[parentId] = { ...parent, shattered: false, pos }
    set({
      tasks,
      fusing: null,
      focusId: tasks[s.focusId] ? s.focusId : null,
      births: { ...s.births, [parentId]: { solid: true } },
    })
  },
}))

function snap(s, now) {
  const tasks = {}
  for (const t of Object.values(s.tasks)) tasks[t.id] = pause(t, now)
  return { tasks, focusId: s.focusId }
}

// ----- persistence -----
export const persistable = (s) => ({ v: 1, tasks: s.tasks, focusId: s.focusId, settings: s.settings, beat: Date.now() })

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
