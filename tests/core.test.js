import { describe, it, expect, beforeEach, vi } from 'vitest'
import { classifyThrow, classifyRelease, directionOf, releaseVelocity, massFor, withMass, SPRING, COMMIT_DISTANCE } from '../src/lib/physics'
import { slotPositions, rectDist, centerPoint, CARD, DROP_RADIUS, fracToPx, pxToFrac } from '../src/lib/geometry'
import { useStore, sanitize, remainingOf, MINUTE } from '../src/store'

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
