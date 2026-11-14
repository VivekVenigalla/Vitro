export const CARD = { w: 252, h: 92, r: 24 }
export const SHARD = { w: 196, h: 68, r: 8 }
export const ORB = { d: 248 }

export const MARGIN = 20
export const DOCK_RESERVE = 124 // space kept free at the bottom for the dock
export const DROP_RADIUS = 170 // release a card this close to center to focus it
export const FUSE_DISTANCE = 40 // shards dropped this close to a sibling re-fuse

const TOP_GAP = 28
const SIDE_GAP = 18

export const sizeOf = (task) => (task.parentId ? SHARD : CARD)

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
    const y0 = top + 16 + iy
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
  if (!out.length) out.push({ x: MARGIN, y: top + 16, edge: 'top' })
  return out
}

// ---------- shatter geometry ----------

export function hashSeed(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fracture a W×H card into n jagged pieces that tile it exactly.
 * Each piece is an 8-vertex polygon (TL, TR, R1, R2, BR, BL, L2, L1) so it can
 * be interpolated point-for-point into a clean shard outline.
 * Returns [{ box: {x,y,w,h} in card px, poly: [[x%, y%] × 8] relative to box }].
 */
export function shatterPieces(n, W = CARD.w, H = CARD.h, seed = 1) {
  const rnd = mulberry32(seed)
  const jit = (a) => (rnd() * 2 - 1) * a
  const ys = [0, H * 0.36, H * 0.68, H]
  const amp = Math.min(16, (W / n) * 0.2)
  const bounds = [ys.map((y) => [0, y])]
  for (let i = 1; i < n; i++) {
    const bx = (W * i) / n
    const s = rnd() < 0.5 ? 1 : -1
    bounds.push([
      [bx + jit(amp * 0.7), 0],
      [bx + s * amp * (0.5 + rnd() * 0.5), ys[1] + jit(5)],
      [bx - s * amp * (0.5 + rnd() * 0.5), ys[2] + jit(5)],
      [bx + jit(amp * 0.7), H],
    ])
  }
  bounds.push(ys.map((y) => [W, y]))
  return Array.from({ length: n }, (_, i) => {
    const L = bounds[i]
    const R = bounds[i + 1]
    const pts = [L[0], R[0], R[1], R[2], R[3], L[3], L[2], L[1]]
    const xs = pts.map((p) => p[0])
    const yv = pts.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...yv)
    const w = Math.max(...xs) - minX
    const h = Math.max(...yv) - minY
    return {
      box: { x: minX, y: minY, w, h },
      poly: pts.map(([x, y]) => [((x - minX) / w) * 100, ((y - minY) / h) * 100]),
    }
  })
}

/** Clean, angled outlines the fragments ease into so labels stay readable. */
export const SHARD_SHAPES = [
  [[7, 0], [100, 0], [100, 36], [100, 68], [92, 100], [0, 100], [0, 68], [2, 34]],
  [[0, 0], [93, 0], [100, 30], [100, 66], [100, 100], [6, 100], [2, 66], [0, 33]],
  [[4, 0], [100, 0], [100, 34], [98, 66], [94, 100], [0, 100], [0, 64], [0, 30]],
  [[0, 0], [96, 0], [100, 36], [100, 70], [95, 100], [4, 100], [0, 70], [0, 36]],
]
export const FULL_POLY = [[0, 0], [100, 0], [100, 33], [100, 66], [100, 100], [0, 100], [0, 66], [0, 33]]

export const lerpPoly = (a, b, t) => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t])
export const polyCss = (pts) => `polygon(${pts.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(', ')})`
export const polyPath = (pts) => `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')} Z`

const CLUSTER_GX = 56
const CLUSTER_GY = 62

export function clusterSize(n) {
  const cols = Math.min(2, n)
  const rows = Math.ceil(n / cols)
  return { cols, rows, w: cols * SHARD.w + (cols - 1) * CLUSTER_GX, h: rows * SHARD.h + (rows - 1) * CLUSTER_GY }
}

/** Shard top-left positions for a cluster whose top-left corner is (x0, y0). */
export function clusterAt(n, x0, y0) {
  const { cols, rows, w } = clusterSize(n)
  const out = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols)
    const inRow = row === rows - 1 ? n - row * cols : cols
    const col = i - row * cols
    const rowW = inRow * SHARD.w + (inRow - 1) * CLUSTER_GX
    const stagger = col % 2 === 0 ? -6 : 8
    out.push({ x: x0 + (w - rowW) / 2 + col * (SHARD.w + CLUSTER_GX), y: y0 + row * (SHARD.h + CLUSTER_GY) + stagger })
  }
  return out
}

function clampCluster(n, x0, y0, W, H, top) {
  const { w, h } = clusterSize(n)
  return {
    x: Math.min(Math.max(MARGIN, W - MARGIN - w), Math.max(MARGIN, x0)),
    y: Math.min(Math.max(top + 22, H - DOCK_RESERVE - h), Math.max(top + 22, y0)),
  }
}

/**
 * Where n shards come to rest around the parent: a loose 2-column cluster with
 * gaps wider than FUSE_DISTANCE, so they never re-fuse by accident.
 */
export function clusterLayout(n, cx, cy, W, H, top) {
  const { w, h } = clusterSize(n)
  const o = clampCluster(n, cx - w / 2, cy - h / 2, W, H, top)
  return clusterAt(n, o.x, o.y)
}

/**
 * Like clusterLayout, but scans the free area and picks the spot closest to
 * the parent where no shard touches another card, another shard or the focus
 * zone. Runs once per shatter, so a coarse grid scan is plenty.
 * parent / obstacles: { x, y, w, h } boxes in px.
 */
export function placeCluster(n, parent, obstacles, W, H, top) {
  const { w, h } = clusterSize(n)
  const c = centerPoint(W, H, top)
  const pcx = parent.x + parent.w / 2
  const pcy = parent.y + parent.h / 2
  const minX = MARGIN
  const maxX = Math.max(minX, W - MARGIN - w)
  const minY = top + 22
  const maxY = Math.max(minY, H - DOCK_RESERVE - h)
  const cost = (x0, y0) => {
    let hits = 0
    for (const pt of clusterAt(n, x0, y0)) {
      const box = { x: pt.x, y: pt.y, w: SHARD.w, h: SHARD.h }
      const nx = Math.max(box.x, Math.min(c.x, box.x + box.w))
      const ny = Math.max(box.y, Math.min(c.y, box.y + box.h))
      if (Math.hypot(nx - c.x, ny - c.y) < DROP_RADIUS + 12) hits += 3
      for (const ob of obstacles) if (rectDist(box, ob) < 14) hits += 1
    }
    return hits * 1e5 + Math.hypot(x0 + w / 2 - pcx, y0 + h / 2 - pcy)
  }
  const start = clampCluster(n, pcx - w / 2, pcy - h / 2, W, H, top)
  let best = { x: start.x, y: start.y, cost: cost(start.x, start.y) }
  for (let y0 = minY; y0 <= maxY; y0 += 26) {
    for (let x0 = minX; x0 <= maxX; x0 += 32) {
      const k = cost(x0, y0)
      if (k < best.cost) best = { x: x0, y: y0, cost: k }
    }
  }
  return clusterAt(n, best.x, best.y)
}

/** Gap between two axis-aligned boxes (0 when they overlap). */
export function rectDist(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(dx, dy)
}
