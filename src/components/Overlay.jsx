import { useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store'
import { slotPositions, centerPoint, layoutCards, DROP_RADIUS } from '../lib/geometry'
import { COMMIT_DISTANCE } from '../lib/physics'
import { isApp } from '../lib/platform'
import TaskBody from './TaskBody'
import FX from './FX'
import Dock from './Dock'
import Editor from './Editor'
import { LogPanel, HelpPanel, RoutinesPanel, Toast } from './Panels'
import Shelf from './Shelf'
import { Mesh } from './Desktop'

// Where the throw guides sit around the orb, as offsets from the center.
const COMPASS = [
  { dir: 'done', label: 'Done', arrow: '↗', dx: 250, dy: -250 },
  { dir: 'snooze', label: 'Snooze', arrow: '←', dx: -345, dy: 0 },
  { dir: 'cancel', label: 'Cancel', skip: 'Skip', arrow: '↓', dx: 0, dy: 320 },
]

export default function Overlay({ vp, onDismiss }) {
  const tasks = useStore((s) => s.tasks)
  const focusId = useStore((s) => s.focusId)
  const draggingId = useStore((s) => s.draggingId)
  const dropHot = useStore((s) => s.dropHot)
  const intent = useStore((s) => s.throwIntent)
  const editorId = useStore((s) => s.editorId)
  const panel = useStore((s) => s.panel)
  const view = useStore((s) => s.view)
  const categories = useStore((s) => s.categories)
  const openedAt = useRef(performance.now()).current
  const layoutRef = useRef({})

  const { W, H, top } = vp
  const slots = useMemo(() => slotPositions(W, H, top), [W, H, top])
  const c = centerPoint(W, H, top)

  const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])
  const active = useMemo(
    () =>
      Object.values(tasks)
        .filter((t) => t.status === 'active')
        .sort((a, b) => a.slot - b.slot || a.createdAt - b.createdAt),
    [tasks],
  )
  const inView = (t) => view === 'all' || t.categoryId === view || t.id === focusId
  const visible = active.filter(inView)
  // One layout pass for every card on screen, so nothing ever overlaps.
  const layout = useMemo(() => {
    const cards = active.filter((t) => t.id !== focusId && (view === 'all' || t.categoryId === view))
    const reserved = active.filter((t) => t.id === focusId).map((t) => t.slot)
    return layoutCards(cards, slots, { W, H, top, compact: view !== 'all', reserved })
  }, [active, focusId, view, slots, W, H, top])
  layoutRef.current = layout
  const focusTask = focusId ? tasks[focusId] : null
  const isRoutineFocus = !!focusTask?.repeat
  const draggingCard = draggingId && draggingId !== focusId
  const holdingOrb = draggingId && draggingId === focusId

  return (
    <motion.div
      className={`overlay ${isApp ? 'overlay-app' : 'overlay-web'}`}
      data-testid="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      transition={{ duration: 0.22 }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          const s = useStore.getState()
          if (editorId || panel || s.catEdit) useStore.setState({ editorId: null, panel: null, catEdit: null })
          else onDismiss()
        }
      }}
    >
      {isApp && <Mesh veil />}

      {/* Focus zone: frosted ring that wakes up while a card is in flight. */}
      <motion.div
        className={`drop-zone ${dropHot ? 'is-hot' : ''}`}
        style={{ left: c.x, top: c.y, width: (DROP_RADIUS - 30) * 2, height: (DROP_RADIUS - 30) * 2, x: '-50%', y: '-50%' }}
        initial={false}
        animate={{ opacity: draggingCard ? 1 : 0, scale: dropHot ? 1.06 : 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />

      {/* Throw guides: the commit ring sits under the orb, the labels above it. */}
      <AnimatePresence>
        {holdingOrb && (
          <motion.div
            key="ring"
            className={`commit-ring ${intent?.committed ? `is-${intent.dir}` : ''}`}
            style={{ left: c.x, top: c.y, width: COMMIT_DISTANCE * 2, height: COMMIT_DISTANCE * 2, x: '-50%', y: '-50%' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.8 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.18 }}
          />
        )}
        {holdingOrb && (
          <motion.div
            key="labels"
            className="pointer-events-none absolute inset-0"
            style={{ zIndex: 65 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.18 }}
          >
            {COMPASS.map((k) => {
              const active = intent?.dir === k.dir
              return (
                <div
                  key={k.dir}
                  className={`compass-pill is-${k.dir} ${active ? 'is-active' : ''} ${active && intent.committed ? 'is-committed' : ''}`}
                  style={{ left: c.x + k.dx, top: c.y + k.dy }}
                >
                  <span className="compass-arrow">{k.arrow}</span>
                  {isRoutineFocus && k.skip ? k.skip : k.label}
                  {active && intent.committed && <span className="compass-hint">Let go</span>}
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {!focusId && !draggingCard && !editorId && !panel && (
        <div className="center-hint" style={{ left: c.x, top: c.y }}>
          {visible.length
            ? 'Drag a task here to focus'
            : view === 'all'
              ? 'All clear. Add a task below.'
              : `Nothing in ${catById[view]?.name ?? 'here'}. Add a task below.`}
        </div>
      )}

      <Shelf vp={vp} />

      {active.map((t) => (
        <TaskBody
          key={t.id}
          task={t}
          order={Math.max(0, visible.indexOf(t))}
          vp={vp}
          home={layout[t.id] || null}
          hidden={!inView(t)}
          cat={catById[t.categoryId]}
          showCat={view === 'all'}
          layoutRef={layoutRef}
          openedAt={openedAt}
        />
      ))}

      <FX />
      <Dock />
      <AnimatePresence>
        {panel === 'log' && <LogPanel key="log" />}
        {panel === 'help' && <HelpPanel key="help" />}
        {panel === 'routines' && <RoutinesPanel key="routines" />}
        {editorId && tasks[editorId] && <Editor key={editorId} task={tasks[editorId]} />}
      </AnimatePresence>
      <Toast />
    </motion.div>
  )
}
