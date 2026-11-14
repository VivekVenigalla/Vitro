// Spring tiers. Task mass multiplies the tier's mass, so a low-priority task
// (mass 1.0) moves with exactly these values and heavier tasks carry more momentum.
export const SPRING = {
  cascade: { type: 'spring', stiffness: 120, damping: 14, mass: 0.8 },
  lift: { type: 'spring', stiffness: 400, damping: 30, mass: 1 },
  morph: { type: 'spring', stiffness: 260, damping: 24, mass: 1.2 },
  tilt: { stiffness: 300, damping: 20 },
}

export const PRIORITY_MASS = [1.0, 1.4, 1.8]
export const SHARD_MASS = 0.8
export const THROW_SPEED = 700 // px/s

export function massFor(task) {
  if (task.parentId) return SHARD_MASS
  return PRIORITY_MASS[task.priority] ?? PRIORITY_MASS[1]
}

export function withMass(spring, mass) {
  return { ...spring, mass: (spring.mass ?? 1) * mass }
}

/**
 * Classify a release velocity (px/s, screen coordinates: +x right, +y down).
 *   done    up or right   -135° … +45°
 *   cancel  straight down  +60° … +120°
 *   snooze  leftward       beyond +120° or below -135°
 *   return  too slow, or the ambiguous 45°–60° sliver between done and cancel
 */
export function classifyThrow(vx, vy) {
  const speed = Math.hypot(vx, vy)
  if (speed < THROW_SPEED) return 'return'
  const a = (Math.atan2(vy, vx) * 180) / Math.PI
  const e = 1e-6 // keep the zone boundaries inclusive despite float rounding
  if (a >= -135 - e && a <= 45 + e) return 'done'
  if (a >= 60 - e && a <= 120 + e) return 'cancel'
  if (a > 120 || a < -135) return 'snooze'
  return 'return'
}
