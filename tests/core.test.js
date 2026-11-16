import { describe, it, expect, beforeEach, vi } from 'vitest'
import { classifyThrow, classifyRelease, directionOf, releaseVelocity, massFor, withMass, SPRING, COMMIT_DISTANCE } from '../src/lib/physics'
import { slotPositions, rectDist, centerPoint, CARD, DROP_RADIUS, fracToPx, pxToFrac, layoutCards, pxToFrac as toFrac } from '../src/lib/geometry'
import { useStore, sanitize, remainingOf, MINUTE } from '../src/store'
import { nextOccurrence, prevOccurrence, cleanRepeat, describeRepeat, EVERY_DAY, WEEKDAYS, DEFAULT_PART_TIMES } from '../src/lib/schedule'

const polar = (deg, mag) => [Math.cos((deg * Math.PI) / 180) * mag, Math.sin((deg * Math.PI) / 180) * mag]

describe('throw direction', () => {
  it('done for up and right (-135°…45°)', () => {
    for (const a of [-135, -90, -45, 0, 45]) expect(directionOf(...polar(a, 1))).toBe('done')
  })
  it('cancel for straight down (60°…120°)', () => {
    for (const a of [60, 90, 120]) expect(directionOf(...polar(a, 1))).toBe('cancel')
  })
  it('snooze for leftward', () => {
    for (const a of [121, 150, 180, -180, -160, -136]) expect(directionOf(...polar(a, 1))).toBe('snooze')
  })
  it('the 45°–60° sliver has no direction', () => {
    expect(directionOf(...polar(52, 1))).toBeNull()
    expect(directionOf(0, 0)).toBeNull()
  })
})

describe('classifyThrow (velocity only)', () => {
  it('needs 700 px/s', () => {
    expect(classifyThrow(...polar(-90, 699))).toBe('return')
    expect(classifyThrow(...polar(-90, 701))).toBe('done')
    expect(classifyThrow(...polar(90, 900))).toBe('cancel')
    expect(classifyThrow(...polar(180, 900))).toBe('snooze')
  })
})

describe('classifyRelease', () => {
  it('a fast flick wins regardless of where the orb is', () => {
    expect(classifyRelease({ dx: 0, dy: 0, vx: 0, vy: 900 })).toBe('cancel')
    expect(classifyRelease({ dx: -200, dy: 0, vx: 900, vy: -900 })).toBe('done')
  })
  it('a slow release past the commit ring goes the way it was dragged', () => {
    expect(classifyRelease({ dx: COMMIT_DISTANCE + 1, dy: 0, vx: 0, vy: 0 })).toBe('done')
    expect(classifyRelease({ dx: 0, dy: COMMIT_DISTANCE + 1, vx: 0, vy: 0 })).toBe('cancel')
    expect(classifyRelease({ dx: -(COMMIT_DISTANCE + 1), dy: 0, vx: 10, vy: 0 })).toBe('snooze')
  })
  it('a slow release inside the ring springs back', () => {
    expect(classifyRelease({ dx: COMMIT_DISTANCE - 1, dy: 0, vx: 300, vy: 0 })).toBe('return')
  })
  it('the ambiguous sliver never dismisses on distance alone', () => {
    const [dx, dy] = polar(52, 400)
    expect(classifyRelease({ dx, dy, vx: 0, vy: 0 })).toBe('return')
  })
})

describe('releaseVelocity', () => {
  // A flick that decelerates sharply in its last frames, like a real hand.
  const flick = () => {
    const pts = []
    let x = 0
    let t = 0
    const speeds = [0.5, 1.5, 2.5, 3, 3, 2.5, 1.2, 0.4, 0.15, 0.05] // px per ms per 16ms frame
    pts.push({ t, x, y: 0 })
    for (const s of speeds) {
      t += 16
      x += s * 16
      pts.push({ t, x, y: 0 })
    }
    return { pts, end: t + 8 }
  }
  it('captures the peak of a flick that slows before release', () => {
    const { pts, end } = flick()
    const v = releaseVelocity(pts, end)
    expect(v.x).toBeGreaterThan(1500)
    // the last 40ms alone would read as a crawl
    const last = pts.slice(-3)
    expect(((last[2].x - last[0].x) / (last[2].t - last[0].t)) * 1000).toBeLessThan(700)
  })
  it('is zero when the pointer was held still before letting go', () => {
    const { pts, end } = flick()
    expect(releaseVelocity(pts, end + 300)).toEqual({ x: 0, y: 0 })
  })
  it('handles too few samples', () => {
    expect(releaseVelocity([], 0)).toEqual({ x: 0, y: 0 })
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }], 5)).toEqual({ x: 0, y: 0 })
  })
})

describe('mass', () => {
  it('maps priority to 1.0–1.8', () => {
    expect(massFor({ priority: 0 })).toBe(1)
    expect(massFor({ priority: 1 })).toBe(1.4)
    expect(massFor({ priority: 2 })).toBe(1.8)
  })
  it('leaves the spring tiers untouched at mass 1', () => {
    expect(withMass(SPRING.cascade, 1)).toEqual(SPRING.cascade)
    expect(withMass(SPRING.morph, 1.5).mass).toBeCloseTo(1.8)
  })
})

describe('geometry', () => {
  it('slots stay on screen, never overlap and stay clear of the focus zone', () => {
    for (const [W, H] of [[1440, 900], [1280, 720], [1920, 1080], [900, 640]]) {
      const slots = slotPositions(W, H, 28)
      const c = centerPoint(W, H, 28)
      expect(slots.length).toBeGreaterThan(4)
      for (const s of slots) {
        expect(s.x).toBeGreaterThanOrEqual(0)
        expect(s.x + CARD.w).toBeLessThanOrEqual(W)
        expect(s.y).toBeGreaterThanOrEqual(28)
        expect(Math.hypot(s.x + CARD.w / 2 - c.x, s.y + CARD.h / 2 - c.y)).toBeGreaterThan(DROP_RADIUS)
      }
      for (let i = 0; i < slots.length; i++)
        for (let j = i + 1; j < slots.length; j++)
          expect(rectDist({ ...slots[i], ...CARD }, { ...slots[j], ...CARD })).toBeGreaterThan(0)
    }
  })
  it('fraction positions round-trip', () => {
    const f = pxToFrac(300, 200, CARD, 1440, 900)
    const p = fracToPx(f, CARD, 1440, 900, 28)
    expect(p.x).toBeCloseTo(300)
    expect(p.y).toBeCloseTo(200)
  })
})

describe('store', () => {
  const S = () => useStore.getState()
  const find = (title) => Object.values(S().tasks).find((t) => t.title === title)
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
    useStore.setState({ tasks: {}, focusId: null, toast: null, fx: [], autoFinish: null, throwIntent: null, hydrated: false })
    S().hydrate(null)
  })

  it('seeds example tasks with unique slots and one example routine on first run', () => {
    const tasks = Object.values(S().tasks)
    expect(tasks.length).toBe(6)
    expect(new Set(tasks.map((t) => t.slot)).size).toBe(6)
    expect(tasks.filter((t) => t.repeat).length).toBe(1)
    expect(S().categories.map((c) => c.name)).toEqual(['School', 'Work', 'Misc'])
  })
  it('adds a task in the lowest free slot and rejects blank titles', () => {
    expect(S().addTask({ title: '   ' })).toBeNull()
    const used = new Set(Object.values(S().tasks).filter((t) => t.status === 'active').map((t) => t.slot))
    let free = 0
    while (used.has(free)) free++
    const id = S().addTask({ title: 'Write tests', priority: 2, durationMs: 15 * MINUTE })
    expect(S().tasks[id].slot).toBe(free)
    expect(S().tasks[id].priority).toBe(2)
  })
  it('runs, pauses and resumes the focus timer', () => {
    const t = find('Book a dentist appointment')
    S().focus(t.id)
    vi.advanceTimersByTime(60_000)
    expect(remainingOf(S().tasks[t.id])).toBe(14 * MINUTE)
    S().togglePause(t.id)
    vi.advanceTimersByTime(60_000)
    expect(remainingOf(S().tasks[t.id])).toBe(14 * MINUTE)
    S().togglePause(t.id)
    vi.advanceTimersByTime(30_000)
    expect(remainingOf(S().tasks[t.id])).toBe(13.5 * MINUTE)
  })
  it('focusing another task pauses the previous one', () => {
    const a = find('Book a dentist appointment')
    const b = find('Plan the weekend hike')
    S().focus(a.id)
    vi.advanceTimersByTime(10_000)
    S().focus(b.id)
    expect(S().focusId).toBe(b.id)
    expect(S().tasks[a.id].timer.startedAt).toBeNull()
    expect(S().tasks[a.id].timer.elapsedMs).toBe(10_000)
  })
  it('snooze returns the task to its edge slot with progress kept', () => {
    const a = find('Book a dentist appointment')
    S().setPos(a.id, { fx: 0.5, fy: 0.8 })
    S().focus(a.id)
    vi.advanceTimersByTime(5_000)
    S().snooze(a.id)
    expect(S().focusId).toBeNull()
    expect(S().tasks[a.id].pos).toBeNull()
    expect(S().tasks[a.id].timer.elapsedMs).toBe(5_000)
  })
  it('done / cancel move the task to the log; undo and restore bring it back', () => {
    const a = find('Book a dentist appointment')
    S().focus(a.id)
    expect(S().resolve(a.id, 'done')).toBe(true)
    expect(S().tasks[a.id].status).toBe('done')
    expect(S().focusId).toBeNull()
    S().undo()
    expect(S().tasks[a.id].status).toBe('active')
    expect(S().focusId).toBe(a.id)
    S().resolve(a.id, 'cancelled')
    expect(S().tasks[a.id].status).toBe('cancelled')
    S().restore(a.id)
    expect(S().tasks[a.id].status).toBe('active')
    expect(S().resolve('nope', 'done')).toBe(false)
  })
  it('ticking the last step of the focused task flags it to finish', () => {
    const p = find('Reply to the design review')
    S().focus(p.id)
    const [a, b] = p.subtasks
    S().toggleStep(p.id, a.id)
    expect(S().autoFinish).toBeNull()
    S().toggleStep(p.id, b.id)
    expect(S().autoFinish).toBe(p.id)
    // unticking cancels the pending finish
    S().toggleStep(p.id, b.id)
    expect(S().autoFinish).toBeNull()
  })
  it('ticking steps on an unfocused task never auto-finishes it', () => {
    const p = find('Reply to the design review')
    for (const s of p.subtasks) S().toggleStep(p.id, s.id)
    expect(S().autoFinish).toBeNull()
    expect(S().tasks[p.id].subtasks.every((s) => s.status === 'done')).toBe(true)
  })
  it('stops the clock at zero and +5 min restarts it', () => {
    const a = find('Book a dentist appointment')
    S().focus(a.id)
    vi.advanceTimersByTime(16 * MINUTE)
    expect(remainingOf(S().tasks[a.id])).toBeLessThan(0)
    S().markNotified(a.id)
    expect(remainingOf(S().tasks[a.id])).toBe(0)
    S().addTime(a.id, 5 * MINUTE)
    expect(remainingOf(S().tasks[a.id])).toBe(5 * MINUTE)
    expect(S().tasks[a.id].timer.startedAt).not.toBeNull()
  })
  it('sanitize repairs bad focus, running timers, duplicate slots and old shards', () => {
    const now = Date.now()
    const clean = sanitize({
      beat: now - 60_000,
      focusId: 'ghost',
      tasks: {
        a: { id: 'a', title: 'A', slot: 0, timer: { elapsedMs: 0, startedAt: now - 120_000 } },
        b: { id: 'b', title: 'B', slot: 0, shattered: true, subtasks: [{ id: 's1', title: 'x', status: 'skipped' }] },
        shard: { id: 'shard', title: 'x', parentId: 'b', pos: { fx: 0.1, fy: 0.1 } },
      },
    })
    expect(clean.focusId).toBeNull()
    expect(clean.tasks.shard).toBeUndefined()
    expect(clean.tasks.b.shattered).toBeUndefined()
    expect(clean.tasks.b.subtasks[0].status).toBe('todo')
    expect(clean.tasks.a.timer.startedAt).toBeNull()
    expect(clean.tasks.a.timer.elapsedMs).toBe(60_000)
    expect(clean.tasks.a.slot).not.toBe(clean.tasks.b.slot)
    expect(sanitize(null)).toBeNull()
    expect(sanitize({ tasks: 'nope' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Overlap-free layout
// ---------------------------------------------------------------------------
describe('layoutCards', () => {
  const W = 1440
  const H = 900
  const top = 0
  const slots = slotPositions(W, H, top)
  const boxes = (out) => Object.values(out).map((p) => ({ x: p.x, y: p.y, w: CARD.w, h: CARD.h }))
  const noOverlap = (out) => {
    const b = boxes(out)
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) expect(rectDist(b[i], b[j])).toBeGreaterThan(0)
  }
  const task = (id, slot, extra = {}) => ({ id, slot, createdAt: slot, pos: null, ...extra })

  it('a new card never lands under a card that was dragged onto its slot', () => {
    const s0 = slots[0]
    const moved = task('moved', 3, { pos: toFrac(s0.x + 10, s0.y + 4, CARD, W, H) })
    const fresh = task('fresh', 0)
    const out = layoutCards([moved, fresh], slots, { W, H, top })
    noOverlap(out)
    expect(out.fresh).not.toEqual(slots[0])
  })
  it('more cards than fit: open space first, then a tidy deck, never a random pile', () => {
    const many = Array.from({ length: slots.length + 30 }, (_, i) => task('t' + i, i))
    const out = layoutCards(many, slots, { W, H, top })
    expect(Object.keys(out).length).toBe(many.length)
    const loose = Object.fromEntries(Object.entries(out).filter(([, p]) => !p.deck))
    noOverlap(loose)
    const deck = Object.values(out).filter((p) => p.deck)
    expect(deck.length).toBeGreaterThan(0)
    expect(deck.every((p) => p.deckSize === deck.length)).toBe(true)
  })
  it('a few extra cards find open space before any deck is needed', () => {
    const many = Array.from({ length: slots.length + 2 }, (_, i) => task('t' + i, i))
    const out = layoutCards(many, slots, { W, H, top })
    expect(Object.values(out).some((p) => p.deck)).toBe(false)
    noOverlap(out)
  })
  it('duplicate slot numbers are spread out', () => {
    const out = layoutCards([task('a', 2), task('b', 2), task('c', 2)], slots, { W, H, top })
    noOverlap(out)
  })
  it('compact mode packs a category into the first slots', () => {
    const out = layoutCards([task('a', 7), task('b', 9)], slots, { W, H, top, compact: true })
    expect(out.a).toEqual(slots[0])
    expect(out.b).toEqual(slots[1])
  })
  it('the focused task keeps its slot reserved', () => {
    const out = layoutCards([task('b', 5), task('c', 0)], slots, { W, H, top, reserved: [0] })
    expect(out.c).not.toEqual(slots[0])
  })
})

// ---------------------------------------------------------------------------
// Routine schedule math
// ---------------------------------------------------------------------------
describe('schedule', () => {
  const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()
  const P = DEFAULT_PART_TIMES
  const daily = { days: EVERY_DAY, part: 'evening', time: null }

  it('uses the start of the part of day, or the exact time', () => {
    expect(nextOccurrence(daily, at(2026, 11, 16, 9), P)).toBe(at(2026, 11, 16, 18))
    expect(nextOccurrence({ ...daily, time: '21:30' }, at(2026, 11, 16, 9), P)).toBe(at(2026, 11, 16, 21, 30))
    expect(nextOccurrence(daily, at(2026, 11, 16, 18), P)).toBe(at(2026, 11, 17, 18)) // strictly after
    expect(prevOccurrence(daily, at(2026, 11, 16, 18), P)).toBe(at(2026, 11, 16, 18)) // at or before
    expect(prevOccurrence(daily, at(2026, 11, 16, 9), P)).toBe(at(2026, 11, 15, 18))
  })
  it('weekdays skip the weekend', () => {
    const wk = { days: WEEKDAYS, part: 'morning', time: null }
    // 2026-11-20 is a Friday
    expect(nextOccurrence(wk, at(2026, 11, 20, 9), P)).toBe(at(2026, 11, 23, 8))
    expect(prevOccurrence(wk, at(2026, 11, 22, 12), P)).toBe(at(2026, 11, 20, 8))
  })
  it('follows custom part-of-day times', () => {
    expect(nextOccurrence(daily, at(2026, 11, 16, 9), { ...P, evening: '19:15' })).toBe(at(2026, 11, 16, 19, 15))
  })
  it('cleans rules and describes them', () => {
    expect(cleanRepeat({ days: [], part: 'evening' })).toBeNull()
    expect(cleanRepeat({ days: [9, 1, 1], part: 'nope', time: '25:00' })).toEqual({ days: [1], part: 'morning', time: null })
    expect(describeRepeat({ days: EVERY_DAY, part: 'evening', time: null })).toBe('Every day · Evening')
    expect(describeRepeat({ days: WEEKDAYS, part: 'evening', time: '21:30' })).toBe('Weekdays · 9:30 PM')
  })
})

// ---------------------------------------------------------------------------
// Routines and categories in the store
// ---------------------------------------------------------------------------
describe('routines', () => {
  const S = () => useStore.getState()
  const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()
  const daily = { days: [0, 1, 2, 3, 4, 5, 6], part: 'evening', time: null }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(at(2026, 11, 16, 9))
    useStore.setState({ tasks: {}, focusId: null, toast: null, fx: [], autoFinish: null, throwIntent: null, hydrated: false, view: 'all' })
    S().hydrate({ tasks: {}, categories: null })
  })

  it('a routine added before its time waits, then appears with a notification event', () => {
    const id = S().addTask({ title: 'LeetCode', categoryId: 'school', repeat: daily })
    expect(S().tasks[id].status).toBe('scheduled')
    expect(S().toast.text).toContain('Today 6:00 PM')
    expect(S().runSchedule(at(2026, 11, 16, 17, 59))).toEqual([])
    const ev = S().runSchedule(at(2026, 11, 16, 18, 0))
    expect(ev).toEqual([{ id, kind: 'due', late: false }])
    expect(S().tasks[id].status).toBe('active')
    expect(S().tasks[id].routine.fresh).toBe(true)
    expect(S().runSchedule(at(2026, 11, 16, 18, 1))).toEqual([]) // only once
  })
  it('a routine added after today\'s time is due right away', () => {
    vi.setSystemTime(at(2026, 11, 16, 20))
    const id = S().addTask({ title: 'LeetCode', repeat: daily })
    expect(S().tasks[id].status).toBe('active')
  })
  it('finishing logs the occurrence, grows the streak and waits for the next one', () => {
    vi.setSystemTime(at(2026, 11, 16, 20))
    const id = S().addTask({ title: 'LeetCode', repeat: daily })
    S().focus(id)
    expect(S().resolve(id, 'done')).toBe(true)
    const t = S().tasks[id]
    expect(t.status).toBe('scheduled')
    expect(t.routine.streak).toBe(1)
    expect(t.routine.due).toBe(at(2026, 11, 17, 18))
    const logged = Object.values(S().tasks).filter((x) => x.routineOf === id)
    expect(logged.length).toBe(1)
    expect(logged[0].status).toBe('done')
    // next day
    S().runSchedule(at(2026, 11, 17, 18))
    vi.setSystemTime(at(2026, 11, 17, 19))
    S().resolve(id, 'done')
    expect(S().tasks[id].routine.streak).toBe(2)
    expect(S().toast.text).toContain('2 in a row')
  })
  it('an unfinished routine carries over without duplicating and resets the streak', () => {
    vi.setSystemTime(at(2026, 11, 16, 20))
    const id = S().addTask({ title: 'LeetCode', repeat: daily })
    useStore.setState({ tasks: { ...S().tasks, [id]: { ...S().tasks[id], routine: { ...S().tasks[id].routine, streak: 4 } } } })
    const ev = S().runSchedule(at(2026, 11, 17, 18, 5))
    expect(ev).toEqual([{ id, kind: 'carried', late: false }])
    const t = S().tasks[id]
    expect(t.routine.carried).toBe(true)
    expect(t.routine.streak).toBe(0)
    expect(t.routine.due).toBe(at(2026, 11, 17, 18))
    expect(Object.values(S().tasks).filter((x) => x.title === 'LeetCode').length).toBe(1)
  })
  it('days missed while the Mac was off are announced as late', () => {
    const id = S().addTask({ title: 'LeetCode', repeat: daily })
    const ev = S().runSchedule(at(2026, 11, 19, 10))
    expect(ev).toEqual([{ id, kind: 'carried', late: true }])
    expect(S().tasks[id].routine.due).toBe(at(2026, 11, 18, 18))
  })
  it('skipping resets the streak; restoring from the log brings the occurrence back', () => {
    vi.setSystemTime(at(2026, 11, 16, 20))
    const id = S().addTask({ title: 'LeetCode', repeat: daily })
    S().resolve(id, 'done')
    S().runSchedule(at(2026, 11, 17, 18))
    vi.setSystemTime(at(2026, 11, 17, 19))
    S().resolve(id, 'cancelled')
    expect(S().tasks[id].routine.streak).toBe(0)
    const skipped = Object.values(S().tasks).find((x) => x.routineOf === id && x.status === 'cancelled')
    S().restore(skipped.id)
    expect(S().tasks[skipped.id]).toBeUndefined()
    expect(S().tasks[id].status).toBe('active')
    expect(S().tasks[id].routine.streak).toBe(1)
  })
  it('do-now brings a waiting routine out early and it counts for that occurrence', () => {
    const id = S().addTask({ title: 'LeetCode', repeat: daily })
    S().doNow(id)
    expect(S().tasks[id].status).toBe('active')
    expect(S().runSchedule(at(2026, 11, 16, 18, 1))).toEqual([]) // not treated as missed
    S().resolve(id, 'done')
    expect(S().tasks[id].routine.due).toBe(at(2026, 11, 17, 18))
  })
  it('turning repeat off makes it a normal task again; clearing the log keeps routines', () => {
    const id = S().addTask({ title: 'LeetCode', repeat: daily })
    S().clearLog()
    expect(S().tasks[id]).toBeDefined()
    S().setRepeat(id, null)
    expect(S().tasks[id].status).toBe('active')
    expect(S().tasks[id].repeat).toBeNull()
  })
  it('changing part-of-day times moves waiting routines', () => {
    const id = S().addTask({ title: 'LeetCode', repeat: daily })
    S().setPartTimes({ evening: '19:30' })
    expect(S().tasks[id].routine.due).toBe(at(2026, 11, 16, 19, 30))
  })
})

describe('categories', () => {
  const S = () => useStore.getState()
  beforeEach(() => {
    useStore.setState({ tasks: {}, focusId: null, toast: null, hydrated: false, view: 'all' })
    S().hydrate({ tasks: {} })
  })
  it('new tasks go into the open category', () => {
    S().setView('work')
    const id = S().addTask({ title: 'Ship it' })
    expect(S().tasks[id].categoryId).toBe('work')
  })
  it('adds, renames and removes categories; removed tasks move to Misc and undo brings it back', () => {
    const cid = S().addCategory('Gym')
    expect(S().view).toBe(cid)
    const id = S().addTask({ title: 'Leg day' })
    expect(S().tasks[id].categoryId).toBe(cid)
    S().updateCategory(cid, { name: 'Fitness' })
    expect(S().categories.find((c) => c.id === cid).name).toBe('Fitness')
    S().removeCategory(cid)
    expect(S().tasks[id].categoryId).toBe('misc')
    expect(S().view).toBe('all')
    S().undo()
    expect(S().categories.some((c) => c.id === cid)).toBe(true)
    expect(S().tasks[id].categoryId).toBe(cid)
  })
  it('never removes the last category and caps at eight', () => {
    for (let i = 0; i < 10; i++) S().addCategory('C' + i)
    expect(S().categories.length).toBe(8)
    for (const c of [...S().categories]) S().removeCategory(c.id)
    expect(S().categories.length).toBe(1)
  })
  it('sanitize files unknown categories under Misc and keeps v2 data loading', () => {
    const clean = sanitize({ tasks: { a: { id: 'a', title: 'A', categoryId: 'ghost' }, b: { id: 'b', title: 'B' } }, view: 'ghost' })
    expect(clean.tasks.a.categoryId).toBe('misc')
    expect(clean.tasks.b.categoryId).toBe('misc')
    expect(clean.view).toBe('all')
    expect(clean.categories.length).toBe(3)
  })
})
