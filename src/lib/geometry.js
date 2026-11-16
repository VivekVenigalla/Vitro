export const CARD = { w: 252, h: 92, r: 24 }
export const ORB = { d: 248 }

export const MARGIN = 20
export const DOCK_RESERVE = 124 // space kept free at the bottom for the dock
export const DROP_RADIUS = 170 // release a card this close to center to focus it
export const SHELF = { y: 12, h: 44, reserve: 64 } // category bubbles along the top

const TOP_GAP = 28
const SIDE_GAP = 18

export function centerPoint(W, H, top) {
  return { x: W / 2, y: top + (H - top) / 2 - 26 }
}

export function clampBox(x, y, size, W, H, top) {
  const maxX = Math.max(8, W - size.w - 8)
  const maxY = Math.max(top + 8, H - size.h - 8)
  return { x: Math.min(maxX, Math.max(8, x)), y: Math.min(maxY, Math.max(top + 8, y)) }
}

/** Free positions are stored as the box center in viewport fractions. */
export function pxToFrac(x, y, size, W, H) {
  return { fx: (x + size.w / 2) / W, fy: (y + size.h / 2) / H }
}

export function fracToPx(pos, size, W, H, top) {
  return clampBox(pos.fx * W - size.w / 2, pos.fy * H - size.h / 2, size, W, H, top)
}

export function nearestEdge(x, y, size, W, H, top) {
  const dTop = y - top
  const dLeft = x
  const dRight = W - (x + size.w)
  const m = Math.min(dTop, dLeft, dRight)
  return m === dTop ? 'top' : m === dLeft ? 'left' : 'right'
}

/**
 * Peripheral slots in cascade order: top row (center-out) interleaved with the
 * left and right columns, ring by ring. Slots that would intrude on the center
 * drop zone are skipped so the middle of the screen stays clear.
 */
export function slotPositions(W, H, top) {
  const out = []
  const c = centerPoint(W, H, top)
  // Outer ring: only require that the card would not latch into the focus zone.
  // Inner rings (overflow) must stay fully clear of it.
  const hitsCenter = (x, y, ring) => {
    if (ring === 0) return Math.hypot(x + CARD.w / 2 - c.x, y + CARD.h / 2 - c.y) < DROP_RADIUS + 24
    const nx = Math.max(x, Math.min(c.x, x + CARD.w))
    const ny = Math.max(y, Math.min(c.y, y + CARD.h))
    return Math.hypot(nx - c.x, ny - c.y) < DROP_RADIUS + 40
  }
  for (let ring = 0; ring < 3; ring++) {
    const ix = ring * (CARD.w + SIDE_GAP)
    const iy = ring * (CARD.h + SIDE_GAP)
    const left = MARGIN + ix
    const right = W - MARGIN - ix
    const span = right - left
    const nTop = Math.floor((span + TOP_GAP) / (CARD.w + TOP_GAP))
    if (nTop < 1) break
    const y0 = top + SHELF.reserve + iy
    const totalW = nTop * CARD.w + (nTop - 1) * TOP_GAP
    const startX = left + (span - totalW) / 2
    const mid = (nTop - 1) / 2
    const order = [...Array(nTop).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
    const tops = order.map((i) => ({ x: startX + i * (CARD.w + TOP_GAP), y: y0, edge: 'top' }))

    const sideY0 = y0 + CARD.h + SIDE_GAP
    const bottom = H - DOCK_RESERVE - iy
    const nSide = Math.max(0, Math.floor((bottom - sideY0 + SIDE_GAP) / (CARD.h + SIDE_GAP)))
    const lefts = []
    const rights = []
    // Only use side columns when they don't collide with the top row.
    if (right - CARD.w - SIDE_GAP >= left + CARD.w) {
      for (let i = 0; i < nSide; i++) {
        const y = sideY0 + i * (CARD.h + SIDE_GAP)
        lefts.push({ x: left, y, edge: 'left' })
        rights.push({ x: right - CARD.w, y, edge: 'right' })
      }
    }
    const lists = [tops, lefts, rights]
    const longest = Math.max(tops.length, lefts.length, rights.length)
    for (let i = 0; i < longest; i++) {
      for (const list of lists) {
        const s = list[i]
        if (s && !hitsCenter(s.x, s.y, ring)) out.push(s)
      }
    }
  }
  if (!out.length) out.push({ x: MARGIN, y: top + SHELF.reserve, edge: 'top' })
  return out
}

/** Gap between two axis-aligned boxes (0 when they overlap). */
export function rectDist(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(dx, dy)
}

const GAP = 12
const box = (p) => ({ x: p.x, y: p.y, w: CARD.w, h: CARD.h })

/** True when a card at (x, y) would sit in the focus zone, under the dock or under the shelf. */
function offLimits(x, y, W, H, top) {
  const c = centerPoint(W, H, top)
  const nx = Math.max(x, Math.min(c.x, x + CARD.w))
  const ny = Math.max(y, Math.min(c.y, y + CARD.h))
  if (Math.hypot(nx - c.x, ny - c.y) < DROP_RADIUS + 30) return true
  if (y + CARD.h > H - DOCK_RESERVE + 20 && x + CARD.w > W / 2 - 330 && x < W / 2 + 330) return true
  if (y < top + SHELF.reserve - 8) return true
  return false
}

/**
 * Nearest free spot to (x, y) that overlaps none of `boxes`, scanning outward
 * on a coarse grid. Returns null when the screen is genuinely full.
 */
export function findFreeSpot(x, y, boxes, W, H, top) {
  const fits = (px, py) => {
    if (px < 8 || py < top + 8 || px + CARD.w > W - 8 || py + CARD.h > H - 8) return false
    if (offLimits(px, py, W, H, top)) return false
    const b = box({ x: px, y: py })
    return boxes.every((o) => rectDist(b, o) >= GAP)
  }
  if (fits(x, y)) return { x, y }
  const step = 24
  const maxR = Math.ceil(Math.max(W, H) / step)
  for (let r = 1; r <= maxR; r++) {
    let best = null
    for (let i = -r; i <= r; i++) {
      for (const [dx, dy] of [[i, -r], [i, r], [-r, i], [r, i]]) {
        const px = x + dx * step
        const py = y + dy * step
        if (!fits(px, py)) continue
        const d = Math.hypot(dx, dy)
        if (!best || d < best.d) best = { x: px, y: py, d }
      }
    }
    if (best) return { x: best.x, y: best.y }
  }
  return null
}

/**
 * Where every card goes. `cards` are the visible, unfocused tasks; `reserved`
 * are slot indices held for tasks that are focused or hidden. Hand-placed cards
 * keep their spot and block slots under them; everyone else takes their own
 * slot if it is free, else the lowest free slot, else the nearest open space.
 * `compact` packs cards into the first slots (used when a category is open).
 */
export function layoutCards(cards, slots, { W, H, top, compact = false, reserved = [] }) {
  const out = {}
  const placed = []
  for (const t of cards) {
    if (!t.pos) continue
    const p = fracToPx(t.pos, CARD, W, H, top)
    out[t.id] = { ...p, edge: nearestEdge(p.x, p.y, CARD, W, H, top) }
    placed.push(box(p))
  }
  const blocked = slots.map((s) => placed.some((b) => rectDist(box(s), b) < GAP))
  const taken = new Set(compact ? [] : reserved)
  const rest = cards.filter((t) => !t.pos).sort((a, b) => a.slot - b.slot || a.createdAt - b.createdAt)
  const left = []
  for (const t of rest) {
    const i = t.slot
    if (!compact && Number.isInteger(i) && i >= 0 && i < slots.length && !blocked[i] && !taken.has(i)) {
      taken.add(i)
      out[t.id] = slots[i]
    } else left.push(t)
  }
  const deck = []
  for (const t of left) {
    const i = slots.findIndex((_, k) => !blocked[k] && !taken.has(k))
    if (i >= 0) {
      taken.add(i)
      out[t.id] = slots[i]
      continue
    }
    const boxes = Object.values(out).map(box)
    const anchor = slots[slots.length - 1] || { x: MARGIN, y: top + SHELF.reserve }
    const spot = findFreeSpot(anchor.x, anchor.y, boxes, W, H, top)
    if (spot) out[t.id] = { ...spot, edge: nearestEdge(spot.x, spot.y, CARD, W, H, top) }
    else deck.push(t)
  }
  // The screen is genuinely full: the rest stack as a tidy deck on the last
  // slot, a few pixels apart, and the top card says how many are underneath.
  if (deck.length) {
    const lastSlot = [...taken].sort((a, b) => b - a)[0]
    const base = slots[lastSlot ?? slots.length - 1] || { x: MARGIN, y: top + SHELF.reserve, edge: 'top' }
    deck.forEach((t, k) => {
      const step = Math.min(k + 1, 4) * 6
      const p = clampBox(base.x + step, base.y + step, CARD, W, H, top)
      out[t.id] = { ...p, edge: base.edge, deck: k + 1, deckSize: deck.length }
    })
  }
  return out
}
