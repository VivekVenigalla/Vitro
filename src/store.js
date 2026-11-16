import { create } from 'zustand'
import { platform } from './lib/platform'
import { cleanRepeat, cleanPartTimes, nextOccurrence, prevOccurrence, sameDay, whenLabel, occurrenceOn } from './lib/schedule'

export const MINUTE = 60_000
export const MAX_STEPS = 6
export const MAX_CATEGORIES = 8
/** OKLCH hues offered for categories; picked to stay apart from the done/cancel/urgent colors. */
export const CATEGORY_HUES = [275, 215, 330, 185, 300, 250, 20, 120]
export const DEFAULT_CATEGORIES = [
  { id: 'school', name: 'School', hue: 275 },
  { id: 'work', name: 'Work', hue: 215 },
  { id: 'misc', name: 'Misc', hue: 330 },
]
/** A routine flagged this long after its due time is announced quietly (the Mac was asleep or Vitro closed). */
export const LATE_MS = 30 * MINUTE

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
    status: 'active', // 'active' | 'done' | 'cancelled' | 'scheduled' (a routine waiting for its next time)
    categoryId: 'misc',
    repeat: null, // { days, part, time } for routines
    routine: null, // { due, streak, best, carried, fresh, lastDoneAt } for routines
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
      categoryId: 'work',
      priority: 2,
      durationMs: 45 * MINUTE,
      subtasks: [sub('Outline milestones'), sub('Estimate effort'), sub('Write the summary')],
    }),
    makeTask({
      title: 'Reply to the design review',
      categoryId: 'work',
      priority: 1,
      durationMs: 25 * MINUTE,
      subtasks: [sub('Read the comments'), sub('Post responses')],
    }),
    makeTask({ title: 'Book a dentist appointment', categoryId: 'misc', priority: 0, durationMs: 15 * MINUTE }),
    makeTask({
      title: 'Refactor the auth module',
      categoryId: 'school',
      priority: 2,
      durationMs: 60 * MINUTE,
      subtasks: [sub('Map current flows'), sub('Extract token service'), sub('Update call sites'), sub('Run the test suite')],
    }),
    makeTask({ title: 'Plan the weekend hike', categoryId: 'misc', priority: 0, durationMs: 25 * MINUTE }),
  ]
  const tasks = {}
  list.forEach((t, i) => {
    tasks[t.id] = { ...t, slot: i, createdAt: Date.now() + i }
  })
  // One example routine, so the feature is discoverable on first run.
  const leet = startRoutine(
    makeTask({ title: 'Daily LeetCode problem', categoryId: 'school', priority: 1, durationMs: 45 * MINUTE }),
    { days: [0, 1, 2, 3, 4, 5, 6], part: 'evening', time: null },
    cleanPartTimes(null),
    Date.now(),
  )
  tasks[leet.id] = { ...leet, slot: list.length, createdAt: Date.now() + list.length }
  return tasks
}

const freshTimer = () => ({ elapsedMs: 0, startedAt: null, notified: false })
const resetSteps = (subtasks) => subtasks.map((x) => ({ ...x, status: 'todo' }))

/**
 * Give a task a repeat rule. If today's occurrence has already come it is due
 * now; otherwise it waits (status 'scheduled') until the next one.
 */
function startRoutine(t, repeat, parts, now) {
  const prev = prevOccurrence(repeat, now, parts)
  const dueToday = prev != null && sameDay(prev, now)
  const due = dueToday ? prev : nextOccurrence(repeat, now, parts)
  return {
    ...t,
    repeat,
    status: dueToday ? 'active' : 'scheduled',
    routine: { due, streak: 0, best: 0, carried: false, fresh: false, lastDoneAt: null },
  }
}

/** Repair anything inconsistent in saved data so a bad file can never brick the app. */
export function sanitize(data) {
  if (!data || typeof data !== 'object' || typeof data.tasks !== 'object' || !data.tasks) return null
  const categories = cleanCategories(data.categories)
  const catIds = new Set(categories.map((c) => c.id))
  const fallbackCat = catIds.has('misc') ? 'misc' : categories[0].id
  const tasks = {}
  for (const raw of Object.values(data.tasks)) {
    if (!raw || typeof raw.id !== 'string') continue
    if (raw.parentId) continue // shards from older versions: their steps still live on the parent
    const { shattered, parentId, subId, shape, ...rest } = raw // eslint-disable-line no-unused-vars
    const t = makeTask(rest)
    t.categoryId = catIds.has(t.categoryId) ? t.categoryId : fallbackCat
    t.repeat = cleanRepeat(t.repeat)
    const r = t.routine
    t.routine =
      t.repeat && r && typeof r === 'object' && Number.isFinite(r.due)
        ? {
            due: r.due,
            streak: Math.max(0, Math.floor(Number(r.streak) || 0)),
            best: Math.max(0, Math.floor(Number(r.best) || 0)),
            carried: !!r.carried,
            fresh: !!r.fresh,
            lastDoneAt: Number.isFinite(r.lastDoneAt) ? r.lastDoneAt : null,
          }
        : null
    if (t.repeat && !t.routine) t.routine = { due: Date.now(), streak: 0, best: 0, carried: false, fresh: false, lastDoneAt: null }
    if (!t.repeat) t.routine = null
    t.title = String(t.title || 'Untitled').slice(0, 200)
    t.priority = [0, 1, 2].includes(t.priority) ? t.priority : 1
    t.durationMs = Math.max(MINUTE, Number(t.durationMs) || 25 * MINUTE)
    t.subtasks = Array.isArray(t.subtasks)
      ? t.subtasks
          .filter((s) => s && typeof s.id === 'string')
          .slice(0, MAX_STEPS)
          .map((s) => ({ id: s.id, title: String(s.title || ''), status: s.status === 'done' ? 'done' : 'todo' }))
      : []
    t.status = ['active', 'done', 'cancelled', 'scheduled'].includes(t.status) ? t.status : 'active'
    if (t.status === 'scheduled' && !t.repeat) t.status = 'active'
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
  const settings = { sound: true, helpSeen: false, ...(data.settings || {}) }
  settings.partTimes = cleanPartTimes(settings.partTimes)
  return {
    tasks,
    focusId,
    categories,
    view: data.view === 'all' || catIds.has(data.view) ? data.view : 'all',
    settings,
  }
}

function cleanCategories(list) {
  const out = []
  const seen = new Set()
  if (Array.isArray(list)) {
    for (const c of list) {
      if (!c || typeof c.id !== 'string' || seen.has(c.id) || c.id === 'all') continue
      seen.add(c.id)
      out.push({
        id: c.id,
        name: String(c.name || 'Untitled').trim().slice(0, 20) || 'Untitled',
        hue: Number.isFinite(c.hue) ? ((Math.round(c.hue) % 360) + 360) % 360 : CATEGORY_HUES[out.length % CATEGORY_HUES.length],
      })
      if (out.length >= MAX_CATEGORIES) break
    }
  }
  return out.length ? out : DEFAULT_CATEGORIES.map((c) => ({ ...c }))
}

export const useStore = create((set, get) => ({
  // ----- persisted -----
  tasks: {},
  focusId: null,
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  view: 'all', // 'all' or a category id
  settings: { sound: true, helpSeen: false, partTimes: cleanPartTimes(null) },
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
  dropCat: null, // category bubble a dragged card is hovering over
  catEdit: null, // { id | null, x } while the category sheet is open

  hydrate(data) {
    const clean = sanitize(data)
    if (clean) set({ ...clean, hydrated: true })
    else set({ tasks: seedTasks(), focusId: null, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), view: 'all', hydrated: true })
  },

  setOpen: (open) =>
    set(open ? { open } : { open, editorId: null, panel: null, catEdit: null, draggingId: null, dropHot: false, throwIntent: null, dropCat: null }),
  setEditor: (editorId) => set({ editorId, panel: null, catEdit: null }),
  setPanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel, editorId: null, catEdit: null })),
  setDragging: (draggingId) => set({ draggingId, ...(draggingId ? {} : { dropHot: false, throwIntent: null, dropCat: null }) }),
  setDropCat: (dropCat) => get().dropCat !== dropCat && set({ dropCat }),
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
  addTask({ title, priority = 1, durationMs = 25 * MINUTE, categoryId, repeat = null }) {
    const clean = String(title || '').trim().slice(0, 200)
    if (!clean) return null
    const s = get()
    const cat = s.categories.some((c) => c.id === categoryId) ? categoryId : defaultCat(s)
    let t = makeTask({ title: clean, priority, durationMs, categoryId: cat, slot: nextSlot(s.tasks) })
    const rule = cleanRepeat(repeat)
    const patch = {}
    if (rule) {
      t = startRoutine(t, rule, s.settings.partTimes, Date.now())
      if (t.status === 'scheduled') patch.toast = { id: uid(), text: `Routine set · ${clean} · ${whenLabel(t.routine.due)}`, snapshot: null }
    }
    set({ tasks: { ...s.tasks, [t.id]: t }, ...patch })
    return t.id
  },
  /** Permanently remove a task (used for deleting a routine); undoable from the toast. */
  deleteTask(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t) return
    const snapshot = snap(s, Date.now())
    const tasks = { ...s.tasks }
    delete tasks[id]
    set({
      tasks,
      focusId: s.focusId === id ? null : s.focusId,
      editorId: s.editorId === id ? null : s.editorId,
      toast: { id: uid(), text: `Deleted · ${t.title}`, snapshot },
    })
  },

  // ----- categories -----
  setView(view) {
    const s = get()
    if (view !== 'all' && !s.categories.some((c) => c.id === view)) view = 'all'
    if (s.view !== view) set({ view })
  },
  addCategory(name, hue) {
    const s = get()
    const clean = String(name || '').trim().slice(0, 20)
    if (!clean || s.categories.length >= MAX_CATEGORIES) return null
    const used = new Set(s.categories.map((c) => c.hue))
    const h = Number.isFinite(hue) ? hue : CATEGORY_HUES.find((x) => !used.has(x)) ?? CATEGORY_HUES[0]
    const id = 'c-' + uid()
    set({ categories: [...s.categories, { id, name: clean, hue: h }], view: id })
    return id
  },
  updateCategory(id, patch) {
    const s = get()
    set({
      categories: s.categories.map((c) => {
        if (c.id !== id) return c
        const next = { ...c }
        if (patch.name !== undefined) next.name = String(patch.name).slice(0, 20)
        if (Number.isFinite(patch.hue)) next.hue = patch.hue
        return next
      }),
    })
  },
  /** Remove a category; its tasks move to Misc (or the first remaining one). */
  removeCategory(id) {
    const s = get()
    const cat = s.categories.find((c) => c.id === id)
    if (!cat || s.categories.length <= 1) return
    const snapshot = snap(s, Date.now())
    const categories = s.categories.filter((c) => c.id !== id)
    const to = categories.some((c) => c.id === 'misc') ? 'misc' : categories[0].id
    const tasks = {}
    for (const t of Object.values(s.tasks)) tasks[t.id] = t.categoryId === id ? { ...t, categoryId: to } : t
    const moved = Object.values(s.tasks).filter((t) => t.categoryId === id && t.status === 'active').length
    set({
      categories,
      tasks,
      view: s.view === id ? 'all' : s.view,
      toast: {
        id: uid(),
        text: moved ? `Removed ${cat.name} · ${moved} moved to ${categories.find((c) => c.id === to).name}` : `Removed ${cat.name}`,
        snapshot,
      },
    })
  },
  setCategory(id, categoryId) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.categoryId === categoryId || !s.categories.some((c) => c.id === categoryId)) return
    set({ tasks: { ...s.tasks, [id]: { ...t, categoryId } } })
  },

  // ----- routines -----
  /** Turn a task into a routine (or back into a one-off with `null`). */
  setRepeat(id, repeat) {
    const s = get()
    const t = s.tasks[id]
    if (!t) return
    const rule = cleanRepeat(repeat)
    const now = Date.now()
    if (!rule) {
      if (!t.repeat) return
      const back = { ...t, repeat: null, routine: null }
      if (t.status === 'scheduled') Object.assign(back, { status: 'active', slot: nextSlot(s.tasks, id) })
      set({ tasks: { ...s.tasks, [id]: back } })
      return
    }
    const parts = s.settings.partTimes
    const old = t.routine || { streak: 0, best: 0, lastDoneAt: null }
    const prev = prevOccurrence(rule, now, parts)
    const owedToday = prev != null && sameDay(prev, now) && !(old.lastDoneAt >= prev)
    const next = { ...t, repeat: rule }
    if (t.status === 'scheduled' && !owedToday) {
      next.routine = { ...old, due: nextOccurrence(rule, now, parts), carried: false, fresh: false }
    } else {
      // Visible now (or owed today): it stays on screen for the occurrence it stands for.
      next.routine = { ...old, due: owedToday ? prev : nextOccurrence(rule, now, parts), carried: false, fresh: false }
      if (t.status === 'scheduled') Object.assign(next, { status: 'active', slot: nextSlot(s.tasks, id) })
    }
    set({ tasks: { ...s.tasks, [id]: next } })
  },
  /** Bring a waiting routine out early; finishing it counts for its upcoming occurrence. */
  doNow(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.status !== 'scheduled') return
    set({
      tasks: { ...s.tasks, [id]: { ...t, status: 'active', slot: nextSlot(s.tasks, id), routine: { ...t.routine, fresh: false } } },
      view: s.view === 'all' || s.view === t.categoryId ? s.view : t.categoryId,
      panel: null,
    })
  },
  setPartTimes(partTimes) {
    const s = get()
    const parts = cleanPartTimes({ ...s.settings.partTimes, ...partTimes })
    const now = Date.now()
    const tasks = { ...s.tasks }
    for (const t of Object.values(s.tasks)) {
      if (!t.repeat || !t.routine || t.repeat.time) continue
      let due = t.routine.due
      if (t.status === 'scheduled') due = nextOccurrence(t.repeat, now, parts)
      else if (due > now) due = occurrenceOn(due, t.repeat, parts) ?? due
      tasks[t.id] = { ...t, routine: { ...t.routine, due } }
    }
    set({ settings: { ...s.settings, partTimes: parts }, tasks })
  },
  /**
   * Advance every routine to `now`: waiting ones whose time has come appear,
   * and visible ones that rolled past another occurrence are marked carried
   * over (streak reset). Returns what changed so the caller can notify.
   */
  runSchedule(now = Date.now()) {
    const s = get()
    const parts = s.settings.partTimes
    let tasks = null
    const events = []
    for (const t of Object.values(s.tasks)) {
      if (!t.repeat || !t.routine) continue
      const r = t.routine
      if (t.status === 'scheduled' && now >= r.due) {
        const latest = prevOccurrence(t.repeat, now, parts) ?? r.due
        const missed = latest > r.due
        tasks = tasks || { ...s.tasks }
        tasks[t.id] = {
          ...t,
          status: 'active',
          slot: nextSlot(tasks, t.id),
          timer: freshTimer(),
          subtasks: resetSteps(t.subtasks),
          routine: { ...r, due: latest, carried: missed, fresh: true, streak: missed ? 0 : r.streak },
        }
        events.push({ id: t.id, kind: missed ? 'carried' : 'due', late: now - latest > LATE_MS })
      } else if (t.status === 'active') {
        const nx = nextOccurrence(t.repeat, r.due, parts)
        if (nx != null && now >= nx) {
          const latest = prevOccurrence(t.repeat, now, parts) ?? nx
          tasks = tasks || { ...s.tasks }
          tasks[t.id] = { ...t, routine: { ...r, due: latest, carried: true, fresh: true, streak: 0 } }
          events.push({ id: t.id, kind: 'carried', late: now - latest > LATE_MS })
        }
      }
    }
    if (tasks) set({ tasks })
    return events
  },
  /** The user has seen a newly due routine (it stops pulsing). */
  markSeen(id) {
    const s = get()
    const t = s.tasks[id]
    if (t?.routine?.fresh) set({ tasks: { ...s.tasks, [id]: { ...t, routine: { ...t.routine, fresh: false } } } })
  },
  /** Open the overlay's view on a task (from a notification). */
  reveal(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.status !== 'active') return
    if (s.view !== 'all' && s.view !== t.categoryId) set({ view: t.categoryId })
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
    if (t.routine?.fresh) tasks[id].routine = { ...t.routine, fresh: false }
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
    if (t.repeat && t.routine) return resolveRoutine(s, t, outcome, now, snapshot, set)
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
    const { tasks, focusId, categories, view } = s.toast.snapshot
    set({ tasks, focusId, categories, view, toast: null, autoFinish: null })
  },
  restore(id) {
    const s = get()
    const t = s.tasks[id]
    if (!t || t.status === 'active' || t.status === 'scheduled') return
    const series = t.routineOf ? s.tasks[t.routineOf] : null
    if (series && series.repeat && series.status === 'scheduled') {
      // Un-finish this occurrence: the routine comes back as it was.
      const tasks = { ...s.tasks }
      delete tasks[id]
      tasks[series.id] = {
        ...series,
        status: 'active',
        slot: nextSlot(s.tasks, series.id),
        subtasks: t.subtasks,
        timer: { ...t.timer, startedAt: null, notified: false },
        routine: { ...series.routine, due: t.routineDue ?? series.routine.due, streak: t.prevStreak ?? 0, carried: false, fresh: false },
      }
      set({ tasks })
      return
    }
    const allDone = t.subtasks.length > 0 && t.subtasks.every((x) => x.status === 'done')
    const spent = t.timer.elapsedMs >= t.durationMs
    set({
      tasks: {
        ...s.tasks,
        [id]: {
          ...t,
          status: 'active',
          resolvedAt: null,
          routineOf: undefined,
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
    for (const t of Object.values(s.tasks)) if (t.status === 'active' || t.status === 'scheduled') tasks[t.id] = t
    set({ tasks, toast: null })
  },
}))

function snap(s, now) {
  const tasks = {}
  for (const t of Object.values(s.tasks)) tasks[t.id] = pause(t, now)
  return { tasks, focusId: s.focusId, categories: s.categories, view: s.view }
}

function defaultCat(s) {
  if (s.view !== 'all' && s.categories.some((c) => c.id === s.view)) return s.view
  return s.categories.some((c) => c.id === 'misc') ? 'misc' : s.categories[0].id
}

/**
 * Finishing (or skipping) a routine logs a copy of this occurrence and sends
 * the routine back to wait for its next time, with the streak updated.
 */
function resolveRoutine(s, t, outcome, now, snapshot, set) {
  const r = t.routine
  const done = outcome === 'done'
  const paused = pause(t, now)
  const copy = {
    ...makeTask({
      title: t.title,
      priority: t.priority,
      durationMs: t.durationMs,
      categoryId: t.categoryId,
      subtasks: t.subtasks,
      timer: paused.timer,
    }),
    status: done ? 'done' : 'cancelled',
    resolvedAt: now,
    routineOf: t.id,
    routineDue: r.due,
    prevStreak: r.streak,
  }
  const streak = done ? r.streak + 1 : 0
  const due = nextOccurrence(t.repeat, Math.max(r.due, now), s.settings.partTimes)
  const series = {
    ...t,
    status: 'scheduled',
    timer: freshTimer(),
    subtasks: resetSteps(t.subtasks),
    routine: { ...r, due, streak, best: Math.max(r.best || 0, streak), carried: false, fresh: false, lastDoneAt: done ? now : r.lastDoneAt },
  }
  const text = done
    ? `Done · ${t.title}${streak > 1 ? ` · ${streak} in a row` : ''}`
    : `Skipped · ${t.title} · next ${whenLabel(due, now)}`
  set({
    tasks: { ...s.tasks, [t.id]: series, [copy.id]: copy },
    focusId: s.focusId === t.id ? null : s.focusId,
    autoFinish: s.autoFinish === t.id ? null : s.autoFinish,
    toast: { id: uid(), text, snapshot },
    editorId: null,
  })
  return true
}

// ----- persistence -----
export const persistable = (s) => ({
  v: 3,
  tasks: s.tasks,
  focusId: s.focusId,
  categories: s.categories,
  view: s.view,
  settings: s.settings,
  beat: Date.now(),
})

let saveTimer = null
export function saveNow() {
  clearTimeout(saveTimer)
  saveTimer = null
  const s = useStore.getState()
  if (s.hydrated) platform.save(persistable(s))
}
useStore.subscribe((s, prev) => {
  if (!s.hydrated) return
  if (
    prev.hydrated &&
    s.tasks === prev.tasks &&
    s.focusId === prev.focusId &&
    s.settings === prev.settings &&
    s.categories === prev.categories &&
    s.view === prev.view
  )
    return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 250)
})
