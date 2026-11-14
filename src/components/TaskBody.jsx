import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, useVelocity, useSpring, animate, useDragControls } from 'motion/react'
import { useStore, remainingOf, elapsedOf, isRunning } from '../store'
import {
  CARD, SHARD, ORB, DROP_RADIUS, FUSE_DISTANCE, SHARD_SHAPES, FULL_POLY,
  sizeOf, fracToPx, pxToFrac, clampBox, centerPoint, nearestEdge,
  shatterPieces, placeCluster, lerpPoly, polyCss, polyPath, rectDist, hashSeed,
} from '../lib/geometry'
import { SPRING, massFor, withMass, classifyThrow } from '../lib/physics'
import { sound } from '../lib/sound'
import { fmtClock, fmtShort, useNow } from '../lib/time'
import Liquid from './Liquid'

const SHADOW = {
  rest: '0px 12px 32px -8px rgba(0,0,0,0.38), 0px 2px 6px 0px rgba(0,0,0,0.18)',
  lifted: '0px 44px 80px -12px rgba(0,0,0,0.6), 0px 14px 26px 0px rgba(0,0,0,0.26)',
  orb: '0px 30px 70px -14px rgba(0,0,0,0.55), 0px 6px 16px 0px rgba(0,0,0,0.22)',
}
const PRIORITY_LABEL = ['Low', 'Normal', 'Urgent']

/**
 * One persistent element per task. It is a flat glass card (or an angular shard)
 * on the periphery and morphs into the Focus Orb when the task is focused, so the
 * card ↔ orb transition is a real geometry spring rather than a remount.
 */
export default function TaskBody({ task, order, vp, slots, openedAt }) {
  const focused = useStore((s) => s.focusId === task.id)
  const fusePiece = useStore((s) => s.fusing?.pieces[task.id] ?? null)
  const isShard = !!task.parentId
  const size = sizeOf(task)
  const mass = massFor(task)
  const { W, H, top } = vp
  const c = centerPoint(W, H, top)
  const cleanPoly = SHARD_SHAPES[task.shape % SHARD_SHAPES.length]
  const restAngle = useMemo(() => (isShard ? ((hashSeed(task.id) % 500) / 100 - 2.5) * 1.3 : 0), [task.id, isShard])

  const home = useMemo(() => {
    if (task.pos) {
      const p = fracToPx(task.pos, size, W, H, top)
      return { ...p, edge: nearestEdge(p.x, p.y, size, W, H, top) }
    }
    return slots[Math.min(Math.max(0, task.slot), slots.length - 1)]
  }, [task.pos, task.slot, slots, size, W, H, top])

  const target = focused
    ? { x: c.x - ORB.d / 2, y: c.y - ORB.d / 2, w: ORB.d, h: ORB.d, r: ORB.d / 2 }
    : { x: home.x, y: home.y, w: size.w, h: size.h, r: size.r }

  // ----- how this element enters the scene (decided once, at mount) -----
  const init = useRef(null)
  if (!init.current) {
    const birth = useStore.getState().births[task.id]
    const entering = performance.now() - openedAt < 200
    if (birth?.box) {
      init.current = {
        kind: 'birth', op: 1, lift: 1, poly: birth.poly,
        x: birth.box.x + birth.box.w / 2 - size.w / 2,
        y: birth.box.y + birth.box.h / 2 - size.h / 2,
        sx: birth.box.w / size.w, sy: birth.box.h / size.h,
      }
    } else if (birth?.solid) {
      init.current = { kind: 'solid', x: target.x, y: target.y, sx: 1, sy: 1, op: 1, lift: 1 }
    } else if (entering && !focused) {
      const off = { x: target.x, y: target.y }
      if (home.edge === 'left') off.x = -size.w - 60
      else if (home.edge === 'right') off.x = W + 60
      else off.y = -size.h - 60
      init.current = { kind: 'enter', ...off, sx: 1, sy: 1, op: 0, lift: 1 }
    } else {
      init.current = { kind: entering ? 'enter' : 'pop', x: target.x, y: target.y, sx: 1, sy: 1, op: 0, lift: 0.82 }
    }
  }
  const i0 = init.current

  const x = useMotionValue(i0.x)
  const y = useMotionValue(i0.y)
  const w = useMotionValue(target.w)
  const h = useMotionValue(target.h)
  const r = useMotionValue(target.r)
  const sx = useMotionValue(i0.sx)
  const sy = useMotionValue(i0.sy)
  const lift = useMotionValue(i0.lift)
  const op = useMotionValue(i0.op)
  const labelOp = useMotionValue(i0.kind === 'birth' ? 0 : 1)
  const restR = useMotionValue(i0.kind === 'birth' || focused ? 0 : restAngle)

  // ----- drag velocity → tilt (air resistance) -----
  const vx = useVelocity(x)
  const vy = useVelocity(y)
  const tiltRange = 12 / Math.sqrt(mass)
  const tiltZ = useSpring(useTransform(vx, [-2000, 2000], [-tiltRange, tiltRange], { clamp: true }), SPRING.tilt)
  const tiltX = useSpring(useTransform(vy, [-2000, 2000], [tiltRange * 0.7, -tiltRange * 0.7], { clamp: true }), SPRING.tilt)
  const rotate = useTransform([tiltZ, restR], ([a, b]) => a + b)

  // ----- shard outline: interpolated point-for-point between polygons -----
  const polyFrom = useRef(i0.poly ?? (focused ? FULL_POLY : cleanPoly))
  const polyTo = useRef(polyFrom.current)
  const polyT = useMotionValue(1)
  const clipPath = useTransform(polyT, (t) => polyCss(lerpPoly(polyFrom.current, polyTo.current, t)))
  const outline = useTransform(polyT, (t) => polyPath(lerpPoly(polyFrom.current, polyTo.current, t)))
  const morphPoly = (to, opts) => {
    polyFrom.current = lerpPoly(polyFrom.current, polyTo.current, polyT.get())
    polyTo.current = to
    polyT.set(0)
    animate(polyT, 1, { duration: 0.35, ease: [0.2, 0.8, 0.2, 1], ...opts })
  }

  const dragging = useRef(false)
  const exiting = useRef(false)
  const moved = useRef(false)
  const first = useRef(true)
  const prevFocused = useRef(focused)
  const [lifted, setLifted] = useState(false)
  const [gone, setGone] = useState(false)
  const [editing, setEditing] = useState(false)
  const dragControls = useDragControls()

  useEffect(() => {
    useStore.getState().clearBirth(task.id)
  }, [task.id])

  const settle = (tr) => {
    animate(x, target.x, tr)
    animate(y, target.y, tr)
    animate(w, target.w, tr)
    animate(h, target.h, tr)
    animate(r, target.r, tr)
  }

  // Follow the target: entrance cascade, card ↔ orb morph, glides and resizes.
  useEffect(() => {
    if (exiting.current || dragging.current || fusePiece) return
    let tr
    if (first.current) {
      const kind = i0.kind
      const delay = kind === 'enter' ? 0.06 + order * 0.045 : 0
      if (kind === 'enter') tr = { ...withMass(SPRING.cascade, mass), delay }
      else if (kind === 'birth') tr = { type: 'spring', stiffness: 210, damping: 17, mass: 0.8 }
      else tr = withMass(SPRING.lift, mass)
      animate(op, 1, { duration: kind === 'enter' ? 0.3 : 0.2, delay })
      animate(lift, 1, { ...SPRING.lift, delay })
      if (kind === 'birth') {
        animate(sx, 1, tr)
        animate(sy, 1, tr)
        animate(restR, restAngle, tr)
        morphPoly(cleanPoly, { duration: 0.5, delay: 0.1 })
        animate(labelOp, 1, { duration: 0.25, delay: 0.22 })
      }
    } else if (prevFocused.current !== focused) {
      tr = withMass(SPRING.morph, mass)
      if (isShard) {
        morphPoly(focused ? FULL_POLY : cleanPoly, { duration: 0.3 })
        animate(restR, focused ? 0 : restAngle, tr)
      }
    } else {
      tr = withMass(SPRING.lift, mass)
    }
    first.current = false
    prevFocused.current = focused
    settle(tr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.x, target.y, target.w, target.h, focused, !!fusePiece])

  // Re-fuse: collapse back into this shard's fragment of the parent card.
  useEffect(() => {
    if (!fusePiece) return
    const b = fusePiece.box
    const tr = { type: 'spring', stiffness: 300, damping: 26 }
    animate(x, b.x + b.w / 2 - size.w / 2, tr)
    animate(y, b.y + b.h / 2 - size.h / 2, tr)
    animate(w, size.w, tr)
    animate(h, size.h, tr)
    animate(r, size.r, tr)
    animate(sx, b.w / size.w, tr)
    animate(sy, b.h / size.h, tr)
    animate(restR, 0, tr)
    animate(lift, 1, tr)
    animate(labelOp, 0, { duration: 0.12 })
    morphPoly(fusePiece.poly, { duration: 0.3 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fusePiece])

  // ----- triage outcomes -----
  const orbCenter = () => ({ x: x.get() + w.get() / 2, y: y.get() + h.get() / 2 })

  const finishDone = (vel) => {
    if (exiting.current) return
    exiting.current = true
    setGone(true)
    const store = useStore.getState()
    const p = orbCenter()
    store.addFx({ type: 'ripple', x: p.x, y: p.y })
    sound.chime()
    const speed = Math.max(900, Math.hypot(vel.x, vel.y))
    const dist = Math.max(W, H) * 1.25
    const dur = Math.min(0.6, Math.max(0.22, dist / speed / Math.sqrt(mass)))
    const ease = [0.3, 0, 0.7, 0.4]
    animate(x, x.get() + (vel.x / speed) * dist, { duration: dur, ease })
    animate(y, y.get() + (vel.y / speed) * dist, { duration: dur, ease }).then(() => {
      const res = useStore.getState().resolve(task.id, 'done')
      if (res?.parentCompleted) {
        useStore.getState().addFx({ type: 'celebrate', x: c.x, y: c.y })
        sound.celebrate()
      }
    })
  }

  const finishCancel = () => {
    if (exiting.current) return
    exiting.current = true
    setGone(true)
    sound.thud()
    const tr = { duration: 0.26, ease: [0.5, 0, 1, 0.6] }
    animate(lift, 0, tr)
    animate(op, 0, { duration: 0.22 })
    animate(y, y.get() + 240, tr).then(() => useStore.getState().resolve(task.id, 'cancelled'))
  }

  const finishSnooze = () => {
    sound.whoosh()
    useStore.getState().snooze(task.id)
  }

  // ----- shatter (Option + click on a flat card) -----
  const nudge = () => animate(x, [x.get(), x.get() - 9, x.get() + 8, x.get() - 5, x.get() + 4, x.get()], { duration: 0.36 })

  const doShatter = () => {
    const store = useStore.getState()
    const pending = task.subtasks.filter((s) => s.status === 'todo').slice(0, 4)
    if (pending.length < 2) {
      nudge()
      store.showToast(
        task.subtasks.length ? 'Needs at least 2 open steps to shatter' : 'Add 2–4 steps to this task to shatter it (⋯ to edit)',
      )
      return
    }
    const px = x.get()
    const py = y.get()
    const pieces = shatterPieces(pending.length, CARD.w, CARD.h, hashSeed(task.id + Date.now()))
    const obstacles = Object.values(store.tasks)
      .filter((t) => t.status === 'active' && !t.shattered && t.id !== task.id && t.id !== store.focusId)
      .map((t) => {
        const sz = sizeOf(t)
        const p = t.pos ? fracToPx(t.pos, sz, W, H, top) : slots[Math.min(Math.max(0, t.slot), slots.length - 1)]
        return { x: p.x, y: p.y, w: sz.w, h: sz.h }
      })
    const layout = placeCluster(pending.length, { x: px, y: py, w: CARD.w, h: CARD.h }, obstacles, W, H, top)
    const ok = store.shatter(
      task.id,
      pending.map((s, i) => ({
        subId: s.id,
        shape: i,
        pos: pxToFrac(layout[i].x, layout[i].y, SHARD, W, H),
        birth: {
          poly: pieces[i].poly,
          box: { x: px + pieces[i].box.x, y: py + pieces[i].box.y, w: pieces[i].box.w, h: pieces[i].box.h },
        },
      })),
    )
    if (ok) {
      store.addFx({ type: 'shatter', x: px, y: py, w: CARD.w, h: CARD.h })
      sound.tink()
    }
  }

  // ----- re-fuse check (only on release, never per frame) -----
  const tryFuse = () => {
    const s = useStore.getState()
    if (s.fusing) return false
    const sibs = Object.values(s.tasks).filter(
      (t) => t.parentId === task.parentId && t.id !== task.id && t.status === 'active' && t.id !== s.focusId && t.pos,
    )
    const mine = { x: x.get(), y: y.get(), w: SHARD.w, h: SHARD.h }
    let hit = null
    for (const sib of sibs) {
      const p = fracToPx(sib.pos, SHARD, W, H, top)
      const box = { ...p, w: SHARD.w, h: SHARD.h }
      if (rectDist(mine, box) <= FUSE_DISTANCE) {
        hit = box
        break
      }
    }
    if (!hit) return false
    const parent = s.tasks[task.parentId]
    if (!parent) return false
    const mid = { x: (mine.x + hit.x) / 2 + SHARD.w / 2, y: (mine.y + hit.y) / 2 + SHARD.h / 2 }
    const o = clampBox(mid.x - CARD.w / 2, mid.y - CARD.h / 2, CARD, W, H, top)
    const live = Object.values(s.tasks)
      .filter((t) => t.parentId === task.parentId && t.status === 'active')
      .sort((a, b) => parent.subtasks.findIndex((q) => q.id === a.subId) - parent.subtasks.findIndex((q) => q.id === b.subId))
    const pieces = shatterPieces(live.length, CARD.w, CARD.h, hashSeed(parent.id + live.length))
    const map = {}
    live.forEach((t, i) => {
      map[t.id] = {
        poly: pieces[i].poly,
        box: { x: o.x + pieces[i].box.x, y: o.y + pieces[i].box.y, w: pieces[i].box.w, h: pieces[i].box.h },
      }
    })
    sound.fuse()
    s.beginFuse(parent.id, map, pxToFrac(o.x, o.y, CARD, W, H))
    setTimeout(() => useStore.getState().addFx({ type: 'shatter', x: o.x, y: o.y, w: CARD.w, h: CARD.h }), 330)
    return true
  }

  // ----- drag -----
  const constraints = useMemo(
    () => ({ left: 8, top: top + 8, right: Math.max(8, W - size.w - 8), bottom: Math.max(top + 8, H - size.h - 8) }),
    [W, H, top, size],
  )

  const onDragStart = () => {
    dragging.current = true
    moved.current = true
    setLifted(true)
    useStore.getState().setDragging(task.id)
    animate(lift, 1.06, SPRING.lift)
  }
  const onDrag = () => {
    if (focused) return
    const d = Math.hypot(x.get() + size.w / 2 - c.x, y.get() + size.h / 2 - c.y)
    useStore.getState().setDropHot(d < DROP_RADIUS)
  }
  const onDragEnd = (_e, info) => {
    dragging.current = false
    setLifted(false)
    const store = useStore.getState()
    store.setDragging(null)
    animate(lift, 1, SPRING.lift)
    if (exiting.current) return
    const v = info.velocity
    if (focused) {
      const outcome = classifyThrow(v.x, v.y)
      if (outcome === 'done') finishDone(v)
      else if (outcome === 'cancel') finishCancel()
      else if (outcome === 'snooze') finishSnooze()
      else settle(withMass(SPRING.morph, mass))
      return
    }
    const d = Math.hypot(x.get() + size.w / 2 - c.x, y.get() + size.h / 2 - c.y)
    if (d < DROP_RADIUS) {
      sound.latch()
      store.focus(task.id)
      return
    }
    if (isShard && tryFuse()) return
    // Glide: heavier tasks carry more momentum after release.
    const k = 0.07 * mass
    const cap = (n) => Math.max(-220, Math.min(220, n))
    let nx = x.get() + cap(v.x * k)
    let ny = y.get() + cap(v.y * k)
    if (Math.hypot(nx + size.w / 2 - c.x, ny + size.h / 2 - c.y) < DROP_RADIUS + 10) {
      nx = x.get()
      ny = y.get()
    }
    const p = clampBox(nx, ny, size, W, H, top)
    store.setPos(task.id, pxToFrac(p.x, p.y, size, W, H))
  }

  const onPointerDown = (e) => {
    if (e.button !== 0 || exiting.current || fusePiece) return
    if (e.target.closest('[data-nodrag]')) return
    moved.current = false
    if (e.altKey && !focused && !isShard) return // Option + click is reserved for shatter
    dragControls.start(e)
  }
  const onClick = (e) => {
    if (moved.current || exiting.current || e.target.closest('[data-nodrag]')) return
    if (e.altKey && !focused && !isShard) return doShatter()
    if (focused) useStore.getState().togglePause(task.id)
  }
  const onDoubleClick = (e) => {
    if (focused || exiting.current || e.altKey || e.target.closest('[data-nodrag]')) return
    setEditing(true)
  }

  // ----- timer readout -----
  const running = isRunning(task)
  const now = useNow(focused && running)
  const remaining = remainingOf(task, now)
  const progress = Math.min(1, Math.max(0, elapsedOf(task, now) / task.durationMs))
  const expired = remaining <= 0
  const stepsDone = task.subtasks.filter((s) => s.status !== 'todo').length

  const shardShape = isShard
  return (
    <motion.div
      className="absolute left-0 top-0"
      data-task={task.id}
      data-kind={focused ? 'orb' : isShard ? 'shard' : 'card'}
      style={{
        x, y, width: w, height: h, scaleX: sx, scaleY: sy, rotate, rotateX: tiltX,
        transformPerspective: 900, zIndex: lifted ? 60 : focused ? 30 : isShard ? 20 : 10,
        touchAction: 'none',
      }}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0.15}
      dragConstraints={focused ? undefined : constraints}
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
    >
      <motion.div className="absolute inset-0" style={{ scale: lift }}>
        {/* Shadow lives on a sibling so the glass's backdrop never samples it. */}
        {shardShape ? (
          <motion.div
            className="pointer-events-none absolute inset-0"
            style={{ opacity: op }}
            initial={false}
            animate={{ y: lifted ? 26 : 9, filter: lifted ? 'blur(18px)' : 'blur(9px)' }}
            transition={SPRING.lift}
          >
            <motion.div
              className="absolute inset-0"
              style={{ clipPath, borderRadius: r }}
              initial={false}
              animate={{ backgroundColor: lifted ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.34)' }}
            />
          </motion.div>
        ) : (
          <motion.div
            className="pointer-events-none absolute inset-0"
            style={{ borderRadius: r, opacity: op }}
            initial={false}
            animate={{ boxShadow: lifted ? SHADOW.lifted : focused ? SHADOW.orb : SHADOW.rest }}
            transition={SPRING.lift}
          />
        )}

        <motion.div
          className={`glass backdrop-blur-3xl ${focused ? 'glass-orb' : isShard ? 'glass-shard' : 'glass-card'} ${lifted ? 'is-lifted' : ''}`}
          style={{ borderRadius: r, opacity: op, clipPath: shardShape ? clipPath : undefined }}
          onPointerDown={onPointerDown}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        >
          {focused ? (
            <motion.div key="orb" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35, delay: 0.08 }}>
              <Liquid progress={progress} active={running} />
              <div className="orb-shine" />
              <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
                <div className="orb-title">{task.title}</div>
                <div className="orb-time" data-testid="orb-time">{fmtClock(Math.max(0, remaining))}</div>
                <div className="orb-state">
                  {expired ? 'Time’s up' : running ? 'Focusing' : 'Paused · click to resume'}
                </div>
              </div>
            </motion.div>
          ) : isShard ? (
            <motion.div key="shard" className="absolute inset-0 flex items-center gap-2.5 px-5" style={{ opacity: labelOp }}>
              <span className={`pip pip-${task.priority}`} />
              <div className="min-w-0 flex-1">
                <Title task={task} editing={editing} setEditing={setEditing} className="shard-title" />
                <div className="meta">{fmtShort(Math.max(0, remaining))}{expired ? ' · time’s up' : ''}</div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="card" className="absolute inset-0 flex flex-col justify-between px-4 py-3.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
              <div className="flex items-start gap-2.5">
                <span className={`pip pip-${task.priority} mt-[7px]`} title={`${PRIORITY_LABEL[task.priority]} priority`} />
                <Title task={task} editing={editing} setEditing={setEditing} className="card-title" />
                <button
                  data-nodrag
                  className="card-more"
                  title="Edit task"
                  aria-label={`Edit ${task.title}`}
                  onClick={() => useStore.getState().setEditor(task.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="2.5" cy="7" r="1.3" /><circle cx="7" cy="7" r="1.3" /><circle cx="11.5" cy="7" r="1.3" /></svg>
                </button>
              </div>
              <div className="meta flex items-center gap-2 pl-[18px]">
                <span>{expired ? 'Time’s up' : task.timer.elapsedMs > 0 ? `${fmtShort(remaining)} left` : fmtShort(task.durationMs)}</span>
                {task.subtasks.length > 0 && (
                  <span className="steps" title="Option-click the card to shatter it into steps">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M1 1h10v10H1z M5 1l1.5 4L5 7.5 6.5 11 M6.5 5 11 4" /></svg>
                    {stepsDone}/{task.subtasks.length} steps
                  </span>
                )}
              </div>
            </motion.div>
          )}
          {shardShape && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <motion.path d={outline} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
        </motion.div>
      </motion.div>

      {focused && !gone && (
        <motion.div
          data-nodrag
          className="orb-controls"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.25 }}
        >
          <button title={running ? 'Pause' : 'Resume'} disabled={expired} onClick={() => useStore.getState().togglePause(task.id)}>
            {running ? 'Pause' : 'Resume'}
          </button>
          <button title="Add five minutes" onClick={() => useStore.getState().addTime(task.id, 5 * 60_000)}>+5 min</button>
          <span className="sep" />
          <button title="Done — or throw the orb up or right" onClick={() => finishDone({ x: 1500, y: -900 })}>Done</button>
          <button title="Snooze — or throw the orb left" onClick={finishSnooze}>Snooze</button>
          <button title="Cancel — or throw the orb down" onClick={finishCancel}>Cancel</button>
        </motion.div>
      )}
    </motion.div>
  )
}

function Title({ task, editing, setEditing, className }) {
  const ref = useRef(null)
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus()
      ref.current.select()
    }
  }, [editing])
  if (!editing) {
    return <div className={`${className} min-w-0 flex-1`} title="Double-click to rename">{task.title}</div>
  }
  const commit = (value) => {
    const v = value.trim()
    if (v && v !== task.title) useStore.getState().updateTask(task.id, { title: v })
    setEditing(false)
  }
  return (
    <input
      ref={ref}
      data-nodrag
      className={`${className} title-input min-w-0 flex-1`}
      defaultValue={task.title}
      maxLength={200}
      aria-label="Task title"
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit(e.currentTarget.value)
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}
