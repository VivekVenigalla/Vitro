import { useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store'
import { slotPositions, centerPoint, DROP_RADIUS, ORB } from '../lib/geometry'
import { isApp } from '../lib/platform'
import TaskBody from './TaskBody'
import FX from './FX'
import Dock from './Dock'
import Editor from './Editor'
import { LogPanel, HelpPanel, Toast } from './Panels'
import { Mesh } from './Desktop'

export default function Overlay({ vp, onDismiss }) {
  const tasks = useStore((s) => s.tasks)
  const focusId = useStore((s) => s.focusId)
  const draggingId = useStore((s) => s.draggingId)
  const dropHot = useStore((s) => s.dropHot)
  const editorId = useStore((s) => s.editorId)
  const panel = useStore((s) => s.panel)
  const openedAt = useRef(performance.now()).current

  const { W, H, top } = vp
  const slots = useMemo(() => slotPositions(W, H, top), [W, H, top])
  const c = centerPoint(W, H, top)

  const visible = useMemo(
    () =>
      Object.values(tasks)
        .filter((t) => t.status === 'active' && !t.shattered)
        .sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0) || a.slot - b.slot || a.createdAt - b.createdAt),
    [tasks],
  )
  const draggingCard = draggingId && draggingId !== focusId
  const ringSize = (focusId ? ORB.d / 2 + 26 : DROP_RADIUS - 30) * 2

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
        style={{ left: c.x, top: c.y, width: ringSize, height: ringSize, x: '-50%', y: '-50%' }}
        initial={false}
        animate={{ opacity: draggingCard ? 1 : 0, scale: dropHot ? 1.06 : 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />
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
