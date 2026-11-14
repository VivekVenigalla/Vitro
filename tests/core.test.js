import { describe, it, expect, beforeEach, vi } from 'vitest'
import { classifyThrow, massFor, withMass, SPRING } from '../src/lib/physics'
import { shatterPieces, slotPositions, clusterLayout, placeCluster, rectDist, centerPoint, CARD, SHARD, FUSE_DISTANCE, DROP_RADIUS, fracToPx, pxToFrac } from '../src/lib/geometry'
import { useStore, sanitize, remainingOf, MINUTE } from '../src/store'

const polar = (deg, speed) => [Math.cos((deg * Math.PI) / 180) * speed, Math.sin((deg * Math.PI) / 180) * speed]

describe('classifyThrow', () => {
  it('returns to center below 700 px/s whatever the direction', () => {
    for (const a of [-90, 0, 90, 180]) expect(classifyThrow(...polar(a, 699))).toBe('return')
  })
  it('done for up and right (-135°…45°)', () => {
    for (const a of [-135, -90, -45, 0, 45]) expect(classifyThrow(...polar(a, 900))).toBe('done')
  })
  it('cancel for straight down (60°…120°)', () => {
    for (const a of [60, 90, 120]) expect(classifyThrow(...polar(a, 900))).toBe('cancel')
  })
  it('snooze for leftward throws', () => {
    for (const a of [121, 150, 180, -180, -160, -136]) expect(classifyThrow(...polar(a, 900))).toBe('snooze')
  })
  it('the 45°–60° sliver is ambiguous and never dismisses', () => {
    expect(classifyThrow(...polar(52, 2000))).toBe('return')
  })
})

describe('mass', () => {
  it('maps priority to 1.0–1.8 and shards to 0.8', () => {
    expect(massFor({ priority: 0 })).toBe(1)
    expect(massFor({ priority: 1 })).toBe(1.4)
    expect(massFor({ priority: 2 })).toBe(1.8)
    expect(massFor({ priority: 2, parentId: 'p' })).toBe(0.8)
  })
  it('leaves the spring tiers untouched at mass 1', () => {
    expect(withMass(SPRING.cascade, 1)).toEqual(SPRING.cascade)
    expect(withMass(SPRING.morph, 1.5).mass).toBeCloseTo(1.8)
  })
})

describe('geometry', () => {
  it('shatter pieces tile the card with 8-vertex polygons', () => {
    for (const n of [2, 3, 4]) {
      const pieces = shatterPieces(n, CARD.w, CARD.h, 42 + n)
      expect(pieces).toHaveLength(n)
      let area = 0
      for (const p of pieces) {
        expect(p.poly).toHaveLength(8)
        const pts = p.poly.map(([x, y]) => [p.box.x + (x / 100) * p.box.w, p.box.y + (y / 100) * p.box.h])
        let a = 0
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i]
          const [x2, y2] = pts[(i + 1) % pts.length]
          a += x1 * y2 - x2 * y1
        }
        area += Math.abs(a / 2)
        expect(p.box.x).toBeGreaterThanOrEqual(-0.001)
        expect(p.box.x + p.box.w).toBeLessThanOrEqual(CARD.w + 0.001)
      }
      expect(area).toBeCloseTo(CARD.w * CARD.h, 3)
    }
  })
  it('slots stay on screen and clear of the focus zone', () => {
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
  it('scattered shards rest farther apart than the fuse distance', () => {
    for (const n of [2, 3, 4]) {
      const pts = clusterLayout(n, 140, 80, 1440, 900, 28)
      for (let i = 0; i < n; i++) {
        expect(pts[i].x).toBeGreaterThanOrEqual(0)
        for (let j = i + 1; j < n; j++)
          expect(rectDist({ ...pts[i], ...SHARD }, { ...pts[j], ...SHARD })).toBeGreaterThan(FUSE_DISTANCE)
      }
    }
  })
  it('placed shard clusters avoid neighbouring cards and the focus zone', () => {
    const W = 1440, H = 900, top = 28
    const slots = slotPositions(W, H, top)
    const c = centerPoint(W, H, top)
    for (let parent = 0; parent < 8; parent++) {
      const obstacles = slots.slice(0, 8).filter((_, i) => i !== parent).map((s) => ({ x: s.x, y: s.y, ...CARD }))
      for (const n of [2, 3, 4]) {
        const pts = placeCluster(n, { x: slots[parent].x, y: slots[parent].y, ...CARD }, obstacles, W, H, top)
        expect(pts).toHaveLength(n)
        for (const pt of pts) {
          const box = { ...pt, ...SHARD }
          for (const ob of obstacles) expect(rectDist(box, ob)).toBeGreaterThan(0)
          expect(Math.hypot(pt.x + SHARD.w / 2 - c.x, pt.y + SHARD.h / 2 - c.y)).toBeGreaterThan(DROP_RADIUS)
          expect(pt.x).toBeGreaterThanOrEqual(0)
          expect(pt.x + SHARD.w).toBeLessThanOrEqual(W)
          expect(pt.y + SHARD.h).toBeLessThanOrEqual(H)
        }
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++)
            expect(rectDist({ ...pts[i], ...SHARD }, { ...pts[j], ...SHARD })).toBeGreaterThan(FUSE_DISTANCE)
      }
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
    useStore.setState({ tasks: {}, focusId: null, toast: null, fusing: null, births: {}, fx: [], hydrated: false })
    S().hydrate(null)
  })
  const shatter = (t) =>
    S().shatter(t.id, t.subtasks.filter((s) => s.status === 'todo').map((s, i) => ({ subId: s.id, shape: i, pos: { fx: 0.2 + i * 0.1, fy: 0.3 }, birth: { box: { x: 0, y: 0, w: 10, h: 10 }, poly: [] } })))
  const shardsOf = (id) => Object.values(S().tasks).filter((t) => t.parentId === id)

  it('seeds example tasks with unique slots on first run', () => {
    const tasks = Object.values(S().tasks)
    expect(tasks.length).toBe(5)
    expect(new Set(tasks.map((t) => t.slot)).size).toBe(5)
  })
  it('adds a task in the lowest free slot and rejects blank titles', () => {
    expect(S().addTask({ title: '   ' })).toBeNull()
    const id = S().addTask({ title: 'Write tests', priority: 2, durationMs: 15 * MINUTE })
    expect(S().tasks[id].slot).toBe(5)
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
  it('done / cancel move the task to the log, and undo brings it back', () => {
    const a = find('Book a dentist appointment')
    S().focus(a.id)
    S().resolve(a.id, 'done')
    expect(S().tasks[a.id].status).toBe('done')
    expect(S().focusId).toBeNull()
    S().undo()
    expect(S().tasks[a.id].status).toBe('active')
    expect(S().focusId).toBe(a.id)
    S().resolve(a.id, 'cancelled')
    expect(S().tasks[a.id].status).toBe('cancelled')
    S().restore(a.id)
    expect(S().tasks[a.id].status).toBe('active')
  })
  it('shatters into one shard per open step, with mass 0.8', () => {
    const p = find('Ship the Q4 roadmap draft')
    expect(shatter(p)).toBe(true)
    const shards = shardsOf(p.id)
    expect(shards.map((s) => s.title).sort()).toEqual(['Estimate effort', 'Outline milestones', 'Write the summary'])
    expect(S().tasks[p.id].shattered).toBe(true)
    expect(massFor(shards[0])).toBe(0.8)
  })
  it('refuses to shatter a focused task or one with fewer than 2 open steps', () => {
    const p = find('Ship the Q4 roadmap draft')
    S().focus(p.id)
    expect(shatter(p)).toBe(false)
    const lone = find('Book a dentist appointment')
    expect(S().shatter(lone.id, [])).toBe(false)
  })
  it('completes the parent automatically once every shard is done', () => {
    const p = find('Reply to the design review')
    shatter(p)
    const [a, b] = shardsOf(p.id)
    expect(S().resolve(a.id, 'done').parentCompleted).toBeNull()
    expect(S().tasks[p.id].status).toBe('active')
    expect(S().resolve(b.id, 'done').parentCompleted).toBe(p.id)
    expect(S().tasks[p.id].status).toBe('done')
    expect(shardsOf(p.id)).toHaveLength(0)
  })
  it('a parent whose shards were all cancelled is cancelled, not completed', () => {
    const p = find('Reply to the design review')
    shatter(p)
    for (const s of shardsOf(p.id)) S().resolve(s.id, 'cancelled')
    expect(S().tasks[p.id].status).toBe('cancelled')
  })
  it('re-fuses shards into the parent and keeps finished steps', () => {
    const p = find('Ship the Q4 roadmap draft')
    shatter(p)
    const first = shardsOf(p.id)[0]
    S().resolve(first.id, 'done')
    const pieces = Object.fromEntries(shardsOf(p.id).map((s) => [s.id, { box: {}, poly: [] }]))
    S().beginFuse(p.id, pieces, { fx: 0.4, fy: 0.4 })
    expect(S().fusing.parentId).toBe(p.id)
    vi.advanceTimersByTime(500)
    expect(S().fusing).toBeNull()
    expect(shardsOf(p.id)).toHaveLength(0)
    const parent = S().tasks[p.id]
    expect(parent.shattered).toBe(false)
    expect(parent.pos).toEqual({ fx: 0.4, fy: 0.4 })
    expect(parent.subtasks.filter((s) => s.status === 'done')).toHaveLength(1)
    // …and it can be shattered again into just the two open steps
    expect(shatter(S().tasks[p.id])).toBe(true)
    expect(shardsOf(p.id)).toHaveLength(2)
  })
  it('renaming a shard renames its step on the parent', () => {
    const p = find('Reply to the design review')
    shatter(p)
    const sh = shardsOf(p.id)[0]
    S().updateTask(sh.id, { title: 'Skim the thread' })
    expect(S().tasks[p.id].subtasks.find((s) => s.id === sh.subId).title).toBe('Skim the thread')
  })
  it('stops the clock at zero and flags the timer as notified', () => {
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
  it('sanitize repairs orphan shards, bad focus and running timers', () => {
    const now = Date.now()
    const clean = sanitize({
      beat: now - 60_000,
      focusId: 'ghost',
      tasks: {
        a: { id: 'a', title: 'A', slot: 0, timer: { elapsedMs: 0, startedAt: now - 120_000 } },
        b: { id: 'b', title: 'B', slot: 0 },
        orphan: { id: 'orphan', title: 'x', parentId: 'nope', pos: { fx: 0.1, fy: 0.1 } },
        c: { id: 'c', title: 'C', slot: 2, shattered: true },
      },
    })
    expect(clean.focusId).toBeNull()
    expect(clean.tasks.orphan).toBeUndefined()
    expect(clean.tasks.c.shattered).toBe(false)
    expect(clean.tasks.a.timer.startedAt).toBeNull()
    expect(clean.tasks.a.timer.elapsedMs).toBe(60_000)
    expect(clean.tasks.a.slot).not.toBe(clean.tasks.b.slot)
    expect(sanitize(null)).toBeNull()
    expect(sanitize({ tasks: 'nope' })).toBeNull()
  })
})
