import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform, useVelocity, useSpring, animate, useDragControls } from 'motion/react'
import { useStore, remainingOf, elapsedOf, isRunning, stepsDone } from '../store'
import { CARD, ORB, DROP_RADIUS, pxToFrac, clampBox, centerPoint, rectDist, findFreeSpot, SHELF } from '../lib/geometry'
import { SPRING, massFor, withMass, classifyRelease, directionOf, releaseVelocity, COMMIT_DISTANCE } from '../lib/physics'
import { sound } from '../lib/sound'
import { fmtClock, fmtShort, useNow } from '../lib/time'
import Liquid from './Liquid'
import { bubbleCenter, bubbleAt } from './Shelf'
import { RepeatIcon } from './Dock'
import { Flame } from './Editor'
import { PART_LABEL } from '../lib/schedule'

const SHADOW = {
  rest: '0px 12px 32px -8px rgba(0,0,0,0.38), 0px 2px 6px 0px rgba(0,0,0,0.18)',
  hover: '0px 20px 44px -10px rgba(0,0,0,0.46), 0px 4px 10px 0px rgba(0,0,0,0.2)',
  lifted: '0px 44px 80px -12px rgba(0,0,0,0.6), 0px 14px 26px 0px rgba(0,0,0,0.26)',
  orb: '0px 30px 70px -14px rgba(0,0,0,0.55), 0px 6px 16px 0px rgba(0,0,0,0.22)',
}
const PRIORITY_LABEL = ['Low', 'Normal', 'Urgent']
const TUCK = 0.22 // scale of a card tucked into its category bubble

/**
 * One persistent element per task: a flat glass card on the periphery that
 * morphs into the Focus Orb when the task is focused, so the card ↔ orb
 * transition is a real geometry spring rather than a remount.
 */
export default function TaskBody({ task, order, vp, home: homeProp, hidden, cat, showCat, layoutRef, openedAt }) {
  const focused = useStore((s) => s.focusId === task.id)
  const intent = useStore((s) => (s.focusId === task.id ? s.throwIntent : null))
  const autoFinish = useStore((s) => s.autoFinish === task.id)
  const mass = massFor(task)
  const { W, H, top } = vp
  const c = centerPoint(W, H, top)

  // Where this card's category bubble is: hidden cards are tucked inside it.
  const bubbleBox = () => {
    const b = bubbleCenter(task.categoryId) || { x: W / 2, y: top + SHELF.y + SHELF.h / 2 }
    return { x: b.x - CARD.w / 2, y: b.y - CARD.h / 2 }
  }
  const home = homeProp || { ...bubbleBox(), edge: 'top' }
  const tucked = hidden && !focused

  const target = focused
    ? { x: c.x - ORB.d / 2, y: c.y - ORB.d / 2, w: ORB.d, h: ORB.d, r: ORB.d / 2 }
    : { x: home.x, y: home.y, w: CARD.w, h: CARD.h, r: CARD.r }

  // ----- how this element enters the scene (decided once, at mount) -----
  const init = useRef(null)
  if (!init.current) {
    const entering = performance.now() - openedAt < 200
    if (tucked) {
      init.current = { kind: 'tucked', x: home.x, y: home.y, op: 0, lift: TUCK }
    } else if (entering && !focused) {
      const off = { x: target.x, y: target.y }
      if (home.edge === 'left') off.x = -CARD.w - 60
      else if (home.edge === 'right') off.x = W + 60
      else off.y = -CARD.h - 60
      init.current = { kind: 'enter', ...off, op: 0, lift: 1 }
    } else {
      init.current = { kind: entering ? 'enter' : 'pop', x: target.x, y: target.y, op: 0, lift: 0.82 }
    }
  }
  const i0 = init.current

  const x = useMotionValue(i0.x)
  const y = useMotionValue(i0.y)
  const w = useMotionValue(target.w)
  const h = useMotionValue(target.h)
  const r = useMotionValue(target.r)
  const lift = useMotionValue(i0.lift)
  const op = useMotionValue(i0.op)

  // ----- drag velocity → tilt (air resistance); heavier glass tilts less -----
  const vx = useVelocity(x)
  const vy = useVelocity(y)
  const tiltRange = 12 / Math.sqrt(mass)
  const rotate = useSpring(useTransform(vx, [-2000, 2000], [-tiltRange, tiltRange], { clamp: true }), SPRING.tilt)
  const rotateX = useSpring(useTransform(vy, [-2000, 2000], [tiltRange * 0.7, -tiltRange * 0.7], { clamp: true }), SPRING.tilt)

  const dragging = useRef(false)
  const exiting = useRef(false)
  const moved = useRef(false)
  const first = useRef(true)
  const prevFocused = useRef(focused)
  const samples = useRef([])
  const overBubble = useRef(false)
  const [lifted, setLifted] = useState(false)
  const [hover, setHover] = useState(false)
  const [gone, setGone] = useState(false)
  const [editing, setEditing] = useState(false)
  const [parked, setParked] = useState(i0.kind === 'tucked')
  const prevTucked = useRef(tucked)
  const dragControls = useDragControls()

  const settle = (tr) => {
    animate(x, target.x, tr)
    animate(y, target.y, tr)
    animate(w, target.w, tr)
    animate(h, target.h, tr)
    animate(r, target.r, tr)
  }

  // Follow the target: entrance cascade, card ↔ orb morph, glides and resizes,
  // and tucking into / fanning out of the category bubble.
  useEffect(() => {
    if (exiting.current || dragging.current) return
    const wasTucked = prevTucked.current
    prevTucked.current = tucked
    if (tucked) {
      first.current = false
      prevFocused.current = focused
      const b = bubbleBox()
      const tr = { type: 'spring', stiffness: 300, damping: 30 }
      animate(x, b.x, tr)
      animate(y, b.y, tr)
      animate(lift, TUCK, tr)
      animate(op, 0, { duration: 0.22, delay: 0.06 }).then(() => prevTucked.current && setParked(true))
      return
    }
    if (wasTucked) {
      // Fan out from the bubble.
      setParked(false)
      const b = bubbleBox()
      x.set(b.x)
      y.set(b.y)
      lift.set(TUCK)
      const delay = 0.03 + order * 0.035
      animate(op, 1, { duration: 0.25, delay })
      animate(lift, 1, { ...SPRING.lift, delay })
      first.current = false
      prevFocused.current = focused
      settle({ ...withMass(SPRING.cascade, mass), delay })
      return
    }
    let tr
    if (first.current) {
      const delay = i0.kind === 'enter' ? 0.06 + order * 0.045 : 0
      tr = i0.kind === 'enter' ? { ...withMass(SPRING.cascade, mass), delay } : withMass(SPRING.lift, mass)
      animate(op, 1, { duration: i0.kind === 'enter' ? 0.3 : 0.2, delay })
      animate(lift, 1, { ...SPRING.lift, delay })
    } else if (prevFocused.current !== focused) {
      tr = withMass(SPRING.morph, mass)
    } else {
      tr = withMass(SPRING.lift, mass)
    }
    first.current = false
    prevFocused.current = focused
    settle(tr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.x, target.y, target.w, target.h, focused, tucked])

  // ----- triage outcomes -----
  const orbCenter = () => ({ x: x.get() + w.get() / 2, y: y.get() + h.get() / 2 })

  const finishDone = (vel, { celebrate = false } = {}) => {
    if (exiting.current) return
    exiting.current = true
    setGone(true)
    const store = useStore.getState()
    const p = orbCenter()
    store.addFx({ type: celebrate ? 'celebrate' : 'ripple', x: p.x, y: p.y })
    if (celebrate) sound.celebrate()
    else sound.chime()
    const speed = Math.max(900, Math.hypot(vel.x, vel.y))
    const dist = Math.max(W, H) * 1.25
    const dur = Math.min(0.6, Math.max(0.22, dist / speed / Math.sqrt(mass)))
    const ease = [0.3, 0, 0.7, 0.4]
    animate(op, 0, { duration: dur, delay: dur * 0.5 })
    animate(x, x.get() + (vel.x / speed) * dist, { duration: dur, ease })
    animate(y, y.get() + (vel.y / speed) * dist, { duration: dur, ease }).then(() => useStore.getState().resolve(task.id, 'done'))
  }

  const finishCancel = () => {
    if (exiting.current) return
    exiting.current = true
    setGone(true)
    sound.thud()
    const tr = { duration: 0.28, ease: [0.5, 0, 1, 0.6] }
    animate(lift, 0, tr)
    animate(op, 0, { duration: 0.24 })
    animate(y, y.get() + 240, tr).then(() => useStore.getState().resolve(task.id, 'cancelled'))
  }

  const finishSnooze = () => {
    sound.whoosh()
    useStore.getState().snooze(task.id)
  }

  // Ticking off the last step finishes the task with a small celebration.
  useEffect(() => {
    if (!autoFinish) return
    const id = setTimeout(() => {
      useStore.getState().clearAutoFinish()
      if (useStore.getState().focusId === task.id) finishDone({ x: 0, y: -1600 }, { celebrate: true })
    }, 700)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFinish])

  // ----- drag -----
  const constraints = useMemo(
    () => ({ left: 8, top: top + 8, right: Math.max(8, W - CARD.w - 8), bottom: Math.max(top + 8, H - CARD.h - 8) }),
    [W, H, top],
  )

  const offsetFromCenter = () => {
    const p = orbCenter()
    return { dx: p.x - c.x, dy: p.y - c.y }
  }

  const onDragStart = (_e, info) => {
    dragging.current = true
    moved.current = true
    samples.current = [{ t: performance.now(), x: info.point.x, y: info.point.y }]
    setLifted(true)
    useStore.getState().setDragging(task.id)
    animate(lift, 1.06, SPRING.lift)
  }
  const onDrag = (_e, info) => {
    const now = performance.now()
    const list = samples.current
    list.push({ t: now, x: info.point.x, y: info.point.y })
    while (list.length > 2 && now - list[0].t > 300) list.shift()
    const store = useStore.getState()
    if (focused) {
      const { dx, dy } = offsetFromCenter()
      const d = Math.hypot(dx, dy)
      const dir = d > 36 ? directionOf(dx, dy) : null
      store.setThrowIntent(dir ? { dir, committed: d >= COMMIT_DISTANCE } : null)
      return
    }
    const p = orbCenter()
    const over = bubbleAt(info.point.x, info.point.y)
    // Over a bubble the card shrinks, as if about to be absorbed, so the lit bubble stays visible.
    const shrink = !!over && over !== task.categoryId
    if (shrink !== overBubble.current) {
      overBubble.current = shrink
      animate(lift, shrink ? 0.42 : 1.06, SPRING.lift)
    }
    store.setDropCat(shrink ? over : null)
    store.setDropHot(!over && Math.hypot(p.x - c.x, p.y - c.y) < DROP_RADIUS)
  }
  const onDragEnd = (_e, info) => {
    dragging.current = false
    overBubble.current = false
    setLifted(false)
    const store = useStore.getState()
    const dropCat = !focused ? bubbleAt(info.point.x, info.point.y) : null
    store.setDragging(null)
    animate(lift, 1, SPRING.lift)
    if (exiting.current) return
    let v = releaseVelocity(samples.current, performance.now())
    if (samples.current.length < 3) v = info.velocity // too few samples to trust our own estimate
    if (focused) {
      const { dx, dy } = offsetFromCenter()
      const outcome = classifyRelease({ dx, dy, vx: v.x, vy: v.y })
      if (outcome === 'done') finishDone(Math.hypot(v.x, v.y) > 300 ? v : { x: dx * 8, y: dy * 8 })
      else if (outcome === 'cancel') finishCancel()
      else if (outcome === 'snooze') finishSnooze()
      else settle(withMass(SPRING.morph, mass))
      return
    }
    // Dropped on a category bubble: file it there. It flies into the bubble
    // when that category is not on screen, or back to its spot when it is.
    if (dropCat) {
      if (dropCat !== task.categoryId) {
        sound.latch()
        store.setCategory(task.id, dropCat)
      }
      settle(withMass(SPRING.lift, mass))
      return
    }
    const p = orbCenter()
    if (Math.hypot(p.x - c.x, p.y - c.y) < DROP_RADIUS) {
      sound.latch()
      store.focus(task.id)
      return
    }
    // Glide: heavier tasks carry more momentum after release.
    const k = 0.07 * mass
    const cap = (n) => Math.max(-220, Math.min(220, n))
    let nx = x.get() + cap(v.x * k)
    let ny = y.get() + cap(v.y * k)
    if (Math.hypot(nx + CARD.w / 2 - c.x, ny + CARD.h / 2 - c.y) < DROP_RADIUS + 10) {
      nx = x.get()
      ny = y.get()
    }
    let q = clampBox(nx, ny, CARD, W, H, top)
    // Never land on top of another card: slide to the nearest open space.
    const others = Object.entries(layoutRef?.current || {})
      .filter(([id]) => id !== task.id)
      .map(([, b]) => ({ x: b.x, y: b.y, w: CARD.w, h: CARD.h }))
    const me = { x: q.x, y: q.y, w: CARD.w, h: CARD.h }
    if (others.some((o) => rectDist(me, o) < 8)) q = findFreeSpot(q.x, q.y, others, W, H, top) || q
    store.setPos(task.id, pxToFrac(q.x, q.y, CARD, W, H))
  }

  const onPointerDown = (e) => {
    if (e.button !== 0 || exiting.current) return
    if (e.target.closest('[data-nodrag]')) return
    moved.current = false
    dragControls.start(e)
  }
  const onClick = (e) => {
    if (moved.current || exiting.current || e.target.closest('[data-nodrag]')) return
    if (focused) useStore.getState().togglePause(task.id)
  }
  const onDoubleClick = (e) => {
    if (focused || exiting.current || e.target.closest('[data-nodrag]')) return
    setEditing(true)
  }
  const onHover = (on) => {
    setHover(on)
    if (on && fresh) useStore.getState().markSeen(task.id)
    if (!dragging.current && !exiting.current && !focused) animate(lift, on ? 1.025 : 1, SPRING.lift)
  }

  // ----- timer readout -----
  const running = isRunning(task)
  const now = useNow(focused && running)
  const remaining = remainingOf(task, now)
  const progress = Math.min(1, Math.max(0, elapsedOf(task, now) / task.durationMs))
  const expired = remaining <= 0
  const done = stepsDone(task)
  const total = task.subtasks.length
  const routine = task.repeat && task.routine
  const fresh = !!routine?.fresh

  const shadow = lifted ? SHADOW.lifted : focused ? SHADOW.orb : hover ? SHADOW.hover : SHADOW.rest
  return (
    <motion.div
      className={`absolute left-0 top-0 ${parked ? 'is-parked' : ''}`}
      data-task={task.id}
      data-kind={focused ? 'orb' : 'card'}
      data-hidden={tucked ? '1' : undefined}
      aria-hidden={tucked || undefined}
      style={{
        x,
        y,
        width: w,
        height: h,
        rotate,
        rotateX,
        transformPerspective: 900,
        zIndex: lifted ? 60 : focused ? 30 : tucked ? 5 : 10 + (homeProp?.deck || 0),
        touchAction: 'none',
        pointerEvents: tucked ? 'none' : undefined,
        '--h': cat?.hue ?? 250,
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
        <motion.div
          className="pointer-events-none absolute inset-0"
          style={{ borderRadius: r, opacity: op }}
          initial={false}
          animate={{ boxShadow: shadow }}
          transition={SPRING.lift}
        />
        {fresh && !focused && <div className="due-pulse" style={{ borderRadius: CARD.r }} />}
        {!focused && !tucked && homeProp?.deck === homeProp?.deckSize && homeProp?.deck > 0 && (
          <div className="deck-badge" title="The screen is full. Open a category bubble to see fewer at a time.">
            +{homeProp.deckSize} more
          </div>
        )}
        {focused && (
          <div className={`orb-glow ${intent ? `is-${intent.dir}` : ''} ${intent?.committed ? 'is-committed' : ''}`} />
        )}

        <motion.div
          className={`glass backdrop-blur-3xl ${focused ? 'glass-orb' : 'glass-card has-cat'} ${lifted ? 'is-lifted' : ''} ${!focused && homeProp?.deck && homeProp.deck < homeProp.deckSize ? 'is-deck-under' : ''}`}
          style={{ borderRadius: r, opacity: op }}
          onPointerDown={onPointerDown}
          onPointerEnter={() => onHover(true)}
          onPointerLeave={() => onHover(false)}
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
                {routine && (
                  <div className="orb-routine">
                    <RepeatIcon size={11} />
                    {routine.streak > 0 ? (
                      <>
                        <Flame size={10} /> {routine.streak} in a row
                      </>
                    ) : (
                      'Routine'
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div key="card" className="absolute inset-0 flex flex-col justify-between px-4 py-3.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
              <div className="flex items-start gap-2.5">
                <span className={`pip pip-${task.priority} mt-[7px]`} title={`${PRIORITY_LABEL[task.priority]} priority`} />
                <Title task={task} editing={editing} setEditing={setEditing} />
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
                {routine?.carried ? (
                  <span className="meta-warn" title="Not done last time, so it carried over">Carried over</span>
                ) : (
                  <span className={expired ? 'meta-warn' : ''}>
                    {expired ? 'Time’s up' : task.timer.elapsedMs > 0 ? `${fmtShort(remaining)} left` : fmtShort(task.durationMs)}
                  </span>
                )}
                {total > 0 && (
                  <span className="steps">
                    {done}/{total}
                  </span>
                )}
                {routine && (
                  <span className={`routine-tag ${fresh ? 'is-fresh' : ''}`} title={`Routine · ${task.repeat.time ? 'exact time' : PART_LABEL[task.repeat.part]}${routine.streak ? ` · ${routine.streak} in a row` : ''}`}>
                    <RepeatIcon size={11} />
                    {routine.streak > 0 ? (
                      <>
                        <Flame size={9} />
                        {routine.streak}
                      </>
                    ) : fresh ? (
                      'Due'
                    ) : null}
                  </span>
                )}
                {showCat && cat && <span className="cat-tag">{cat.name}</span>}
              </div>
              {(task.timer.elapsedMs > 0 || done > 0) && (
                <div className="card-progress" aria-hidden="true">
                  <i style={{ width: `${(total ? done / total : Math.min(1, task.timer.elapsedMs / task.durationMs)) * 100}%` }} />
                </div>
              )}
            </motion.div>
          )}
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {focused && !gone && !lifted && (
          <motion.div
            key="below"
            data-nodrag
            className="orb-below"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ delay: 0.25, duration: 0.25 }}
          >
            <div className="orb-controls">
              <button title={running ? 'Pause' : 'Resume'} disabled={expired} onClick={() => useStore.getState().togglePause(task.id)}>
                {running ? 'Pause' : 'Resume'}
              </button>
              <button title="Add five minutes" onClick={() => useStore.getState().addTime(task.id, 5 * 60_000)}>+5 min</button>
              <span className="sep" />
              <button className="ctl-done" title="Done — or throw the orb up or right" onClick={() => finishDone({ x: 1500, y: -900 })}>Done</button>
              <button title="Snooze — or throw the orb left" onClick={finishSnooze}>Snooze</button>
              <button className="ctl-cancel" title={routine ? 'Skip this time — or throw the orb down' : 'Cancel — or throw the orb down'} onClick={finishCancel}>
                {routine ? 'Skip' : 'Cancel'}
              </button>
            </div>
            {total > 0 && (
              <ul className="orb-steps" aria-label="Steps">
                {task.subtasks.map((s) => (
                  <li key={s.id}>
                    <button
                      className={`orb-step ${s.status === 'done' ? 'is-done' : ''}`}
                      aria-pressed={s.status === 'done'}
                      onClick={() => {
                        if (s.status !== 'done') sound.latch()
                        useStore.getState().toggleStep(task.id, s.id)
                      }}
                    >
                      <span className="orb-check">
                        {s.status === 'done' && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.2 4.2 7.5 8 2.8" /></svg>
                        )}
                      </span>
                      <span className="orb-step-label">{s.title || 'Untitled step'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Title({ task, editing, setEditing }) {
  const ref = useRef(null)
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus()
      ref.current.select()
    }
  }, [editing])
  if (!editing) {
    return <div className="card-title min-w-0 flex-1" title="Double-click to rename">{task.title}</div>
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
      className="card-title title-input min-w-0 flex-1"
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
