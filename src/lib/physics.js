// Spring tiers. Task mass multiplies the tier's mass, so a low-priority task
// (mass 1.0) moves with exactly these values and heavier tasks carry more momentum.
export const SPRING = {
  cascade: { type: 'spring', stiffness: 120, damping: 14, mass: 0.8 },
  lift: { type: 'spring', stiffness: 400, damping: 30, mass: 1 },
  morph: { type: 'spring', stiffness: 260, damping: 24, mass: 1.2 },
  tilt: { stiffness: 300, damping: 20 },
}

export const PRIORITY_MASS = [1.0, 1.4, 1.8]
export const THROW_SPEED = 700 // px/s — a flick at least this fast triages the orb
export const COMMIT_DISTANCE = 160 // px — or drag the orb this far out and let go

export function massFor(task) {
  return PRIORITY_MASS[task.priority] ?? PRIORITY_MASS[1]
}

export function withMass(spring, mass) {
  return { ...spring, mass: (spring.mass ?? 1) * mass }
}

/**
 * Direction zones (screen coordinates: +x right, +y down):
 *   done    up or right   -135° … +45°
 *   cancel  straight down  +60° … +120°
 *   snooze  leftward       beyond +120° or below -135°
 *   null    the ambiguous 45°–60° sliver between done and cancel
 */
export function directionOf(dx, dy) {
  if (!dx && !dy) return null
  const a = (Math.atan2(dy, dx) * 180) / Math.PI
  const e = 1e-6 // keep the zone boundaries inclusive despite float rounding
  if (a >= -135 - e && a <= 45 + e) return 'done'
  if (a >= 60 - e && a <= 120 + e) return 'cancel'
  if (a > 120 || a < -135) return 'snooze'
  return null
}

/** Velocity-only classification: 'done' | 'cancel' | 'snooze' | 'return'. */
export function classifyThrow(vx, vy) {
  if (Math.hypot(vx, vy) < THROW_SPEED) return 'return'
  return directionOf(vx, vy) ?? 'return'
}

/**
 * What releasing the orb does. A fast flick wins; otherwise an orb dragged past
 * the commit ring goes the way it was dragged; anything else springs back.
 * dx/dy: orb offset from its home at the center. vx/vy: release velocity.
 */
export function classifyRelease({ dx, dy, vx, vy }) {
  const thrown = classifyThrow(vx, vy)
  if (thrown !== 'return') return thrown
  if (Math.hypot(dx, dy) >= COMMIT_DISTANCE) return directionOf(dx, dy) ?? 'return'
  return 'return'
}

/**
 * Peak velocity over the end of a drag. People decelerate in the last few
 * frames of a flick, so the instantaneous velocity at release badly
 * under-reports the throw. This takes the fastest ~40ms stretch inside the last
 * 150ms, and reports zero if the pointer was held still before letting go.
 * samples: [{ t (ms), x, y }] in pointer order. now: release time (ms).
 */
export function releaseVelocity(samples, now, { window = 150, span = 40, idle = 110 } = {}) {
  const zero = { x: 0, y: 0 }
  if (!samples || samples.length < 2) return zero
  const last = samples[samples.length - 1]
  if (now - last.t > idle) return zero
  let best = zero
  let bestSpeed = 0
  for (let i = samples.length - 1; i > 0; i--) {
    const a = samples[i]
    if (now - a.t > window) break
    let j = i - 1
    while (j > 0 && a.t - samples[j].t < span) j--
    const b = samples[j]
    const dt = (a.t - b.t) / 1000
    if (dt < 0.016) continue
    const vx = (a.x - b.x) / dt
    const vy = (a.y - b.y) / dt
    const sp = Math.hypot(vx, vy)
    if (sp > bestSpeed) {
      bestSpeed = sp
      best = { x: vx, y: vy }
    }
  }
  return best
}
