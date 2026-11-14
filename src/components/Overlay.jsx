import { useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store'
import { slotPositions, centerPoint, DROP_RADIUS } from '../lib/geometry'
import { COMMIT_DISTANCE } from '../lib/physics'
import { isApp } from '../lib/platform'
import TaskBody from './TaskBody'
import FX from './FX'
import Dock from './Dock'
import Editor from './Editor'
import { LogPanel, HelpPanel, Toast } from './Panels'
import { Mesh } from './Desktop'

// Where the throw guides sit around the orb, as offsets from the center.
const COMPASS = [
  { dir: 'done', label: 'Done', arrow: '↗', dx: 250, dy: -250 },
  { dir: 'snooze', label: 'Snooze', arrow: '←', dx: -345, dy: 0 },
  { dir: 'cancel', label: 'Cancel', arrow: '↓', dx: 0, dy: 320 },
]

export default function Overlay({ vp, onDismiss }) {
  const tasks = useStore((s) => s.tasks)
  const focusId = useStore((s) => s.focusId)
  const draggingId = useStore((s) => s.draggingId)
  const dropHot = useStore((s) => s.dropHot)
  const intent = useStore((s) => s.throwIntent)
  const editorId = useStore((s) => s.editorId)
  const panel = useStore((s) => s.panel)
  const openedAt = useRef(performance.now()).current

  const { W, H, top } = vp
  const slots = useMemo(() => slotPositions(W, H, top), [W, H, top])
  const c = centerPoint(W, H, top)

  const visible = useMemo(
    () =>
      Object.values(tasks)
        .filter((t) => t.status === 'active')
        .sort((a, b) => a.slot - b.slot || a.createdAt - b.createdAt),
    [tasks],
  )
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
          if (editorId || panel) useStore.setState({ editorId: null, panel: null })
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
                  {k.label}
                  {active && intent.committed && <span className="compass-hint">Let go</span>}
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {!focusId && !draggingCard && (
        <div className="center-hint" style={{ left: c.x, top: c.y }}>
          {visible.length ? 'Drag a task here to focus' : 'All clear. Add a task below.'}
        </div>
      )}

      {visible.map((t, i) => (
        <TaskBody key={t.id} task={t} order={i} vp={vp} slots={slots} openedAt={openedAt} />
      ))}

      <FX />
      <Dock />
      <AnimatePresence>
        {panel === 'log' && <LogPanel key="log" />}
        {panel === 'help' && <HelpPanel key="help" />}
        {editorId && tasks[editorId] && <Editor key={editorId} task={tasks[editorId]} />}
      </AnimatePresence>
      <Toast />
    </motion.div>
  )
}
