import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore, MAX_CATEGORIES, CATEGORY_HUES } from '../store'
import { SHELF } from '../lib/geometry'
import { sound } from '../lib/sound'

// Screen rects of the bubbles, refreshed after every render, so cards can fly
// into their bubble and dragged cards can be dropped onto one.
const rects = new Map()

export function bubbleCenter(id) {
  const r = rects.get(id)
  return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null
}

/** The category bubble under a screen point (never "All"), or null. */
export function bubbleAt(px, py) {
  for (const [id, r] of rects) {
    if (id === 'all' || id === '+') continue
    if (px >= r.x - 10 && px <= r.x + r.w + 10 && py >= r.y - 12 && py <= r.y + r.h + 12) return id
  }
  return null
}

/**
 * Category bubbles along the top of the screen. Click one to fan its tasks out
 * (click again for All), drag a card onto one to file it there, + to add one,
 * right-click or double-click to rename, recolor or remove.
 */
export default function Shelf({ vp }) {
  const categories = useStore((s) => s.categories)
  const view = useStore((s) => s.view)
  const tasks = useStore((s) => s.tasks)
  const dragging = useStore((s) => !!s.draggingId && s.draggingId !== s.focusId)
  const dropCat = useStore((s) => s.dropCat)
  const catEdit = useStore((s) => s.catEdit)
  const ref = useRef(null)

  const counts = { all: 0 }
  const due = {}
  for (const t of Object.values(tasks)) {
    if (t.status !== 'active') continue
    counts.all++
    counts[t.categoryId] = (counts[t.categoryId] || 0) + 1
    if (t.routine?.fresh) due[t.categoryId] = due.all = true
  }

  const measure = () => {
    if (!ref.current) return
    rects.clear()
    for (const el of ref.current.querySelectorAll('[data-bubble]')) {
      const r = el.getBoundingClientRect()
      rects.set(el.dataset.bubble, { x: r.left, y: r.top, w: r.width, h: r.height })
    }
  }
  useLayoutEffect(measure)
  useEffect(() => () => rects.clear(), [])

  // 0 = All, 1…8 = categories in order.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.metaKey || e.ctrlKey || e.altKey || !/^[0-9]$/.test(e.key)) return
      const s = useStore.getState()
      const n = Number(e.key)
      if (n === 0) s.setView('all')
      else if (s.categories[n - 1]) s.setView(s.categories[n - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (id) => {
    const s = useStore.getState()
    s.setView(s.view === id && id !== 'all' ? 'all' : id)
    useStore.setState({ catEdit: null })
  }
  const edit = (e, id) => {
    e.preventDefault()
    const r = rects.get(id ?? '+')
    useStore.setState({ catEdit: { id, x: r ? r.x + r.w / 2 : vp.W / 2 }, panel: null, editorId: null })
  }

  const all = [{ id: 'all', name: 'All', hue: null }, ...categories]
  return (
    <>
      <motion.div
        ref={ref}
        className={`shelf ${dragging ? 'is-dragging' : ''}`}
        style={{ top: vp.top + SHELF.y, height: SHELF.h }}
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26, delay: 0.05 }}
        onAnimationComplete={measure}
        onLayoutAnimationComplete={measure}
        role="tablist"
        aria-label="Categories"
      >
        {all.map((c, i) => {
          const on = view === c.id
          const n = counts[c.id] || 0
          const fill = Math.min(1, n / 6)
          return (
            <motion.button
              layout
              key={c.id}
              data-bubble={c.id}
              role="tab"
              aria-selected={on}
              title={c.id === 'all' ? 'All tasks (0)' : `${c.name} (${i}) · right-click to edit`}
              className={`bubble ${on ? 'is-on' : ''} ${c.id === 'all' ? 'is-all' : ''} ${dropCat === c.id ? 'is-drop' : ''}`}
              style={{ '--h': c.hue ?? 250 }}
              onClick={() => pick(c.id)}
              onDoubleClick={(e) => c.id !== 'all' && edit(e, c.id)}
              onContextMenu={(e) => (c.id !== 'all' ? edit(e, c.id) : e.preventDefault())}
              onLayoutAnimationComplete={measure}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <span className="bubble-orb">
                {c.id !== 'all' && <span className="bubble-liquid" style={{ transform: `translateY(${(1 - (0.18 + fill * 0.7)) * 100}%)` }} />}
                <motion.span key={n} className="bubble-count" initial={{ scale: 1.5 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
                  {n}
                </motion.span>
                {due[c.id] && <span className="bubble-due" title="A routine is due" />}
              </span>
              <span className="bubble-name">{c.name}</span>
            </motion.button>
          )
        })}
        {categories.length < MAX_CATEGORIES && (
          <motion.button
            layout
            data-bubble="+"
            className="bubble bubble-add"
            title="New category"
            aria-label="New category"
            onClick={(e) => edit(e, null)}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M6 1.5v9M1.5 6h9" /></svg>
          </motion.button>
        )}
      </motion.div>
      <AnimatePresence>{catEdit && <CategoryPop key={catEdit.id ?? 'new'} edit={catEdit} vp={vp} />}</AnimatePresence>
    </>
  )
}

/** Small sheet under the shelf: name + color, and remove for existing categories. */
function CategoryPop({ edit, vp }) {
  const cat = useStore((s) => (edit.id ? s.categories.find((c) => c.id === edit.id) : null))
  const count = useStore((s) => s.categories.length)
  const used = useStore((s) => s.categories.map((c) => c.hue))
  const [name, setName] = useState(cat?.name ?? '')
  const [hue, setHue] = useState(cat?.hue ?? CATEGORY_HUES.find((h) => !used.includes(h)) ?? CATEGORY_HUES[0])
  const close = () => useStore.setState({ catEdit: null })

  const save = () => {
    const s = useStore.getState()
    const clean = name.trim()
    if (!clean) return
    if (cat) s.updateCategory(cat.id, { name: clean, hue })
    else if (s.addCategory(clean, hue)) sound.latch()
    close()
  }
  if (edit.id && !cat) return null
  const width = 268
  const left = Math.max(12, Math.min(vp.W - width - 12, edit.x - width / 2))
  return (
    <motion.div
      className="cat-pop glass backdrop-blur-3xl"
      role="dialog"
      aria-label={cat ? `Edit ${cat.name}` : 'New category'}
      style={{ left, top: vp.top + SHELF.y + SHELF.h + 10, width, '--h': hue }}
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        className="cat-name"
        autoFocus
        maxLength={20}
        placeholder="Category name"
        aria-label="Category name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') close()
        }}
      />
      <div className="cat-hues" role="radiogroup" aria-label="Color">
        {CATEGORY_HUES.map((h) => (
          <button key={h} role="radio" aria-checked={hue === h} aria-label={`Color ${h}`} className={`cat-hue ${hue === h ? 'is-on' : ''}`} style={{ '--h': h }} onClick={() => setHue(h)} />
        ))}
      </div>
      <div className="cat-foot">
        {cat && count > 1 && (
          <button
            className="btn btn-danger"
            onClick={() => {
              useStore.getState().removeCategory(cat.id)
              close()
            }}
          >
            Remove
          </button>
        )}
        <span className="flex-1" />
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>{cat ? 'Save' : 'Add'}</button>
      </div>
    </motion.div>
  )
}
