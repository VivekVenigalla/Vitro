import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useStore, remainingOf, isRunning, saveNow } from './store'
import { platform, isApp } from './lib/platform'
import { sound } from './lib/sound'
import { fmtClock } from './lib/time'
import Overlay from './components/Overlay'
import { GooDefs } from './components/Liquid'
import { Mesh, MenuBar } from './components/Desktop'

const MENUBAR_H = 28

function useViewport() {
  const read = () => ({ W: window.innerWidth, H: window.innerHeight, top: isApp ? 0 : MENUBAR_H })
  const [vp, setVp] = useState(read)
  useEffect(() => {
    const on = () => setVp(read())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vp
}

/**
 * Double-tap Option: two short, clean taps of Alt with nothing else pressed in
 * between. Fires on the second release so Option-click and Option-typing never
 * trigger it.
 */
function useDoubleOption(onFire) {
  const cb = useRef(onFire)
  cb.current = onFire
  useEffect(() => {
    let downAt = 0
    let lastTapAt = 0
    let clean = false
    const reset = () => {
      clean = false
      lastTapAt = 0
    }
    const down = (e) => {
      if (e.key !== 'Alt') return reset()
      if (e.repeat) return
      if (e.metaKey || e.ctrlKey || e.shiftKey) return reset()
      downAt = performance.now()
      clean = true
    }
    const up = (e) => {
      if (e.key !== 'Alt') return
      const now = performance.now()
      if (!clean || now - downAt > 300) return reset()
      clean = false
      if (lastTapAt && now - lastTapAt < 420) {
        lastTapAt = 0
        cb.current()
      } else lastTapAt = now
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('pointerdown', reset)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('pointerdown', reset)
      window.removeEventListener('blur', reset)
    }
  }, [])
}

export default function App() {
  const hydrated = useStore((s) => s.hydrated)
  const open = useStore((s) => s.open)
  const soundOn = useStore((s) => s.settings.sound)
  const vp = useViewport()
  const [trayTitle, setTrayTitle] = useState('')

  // Load saved state, then tell the shell we are ready to be shown.
  useEffect(() => {
    let off = () => {}
    platform.load().then((data) => {
      useStore.getState().hydrate(data)
      off = platform.onVisibility((v) => useStore.getState().setOpen(v))
      platform.ready()
    })
    const flush = () => saveNow()
    window.addEventListener('beforeunload', flush)
    return () => {
      off()
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  useEffect(() => {
    sound.setEnabled(soundOn)
  }, [soundOn])

  const toggle = () => {
    if (isApp) platform.toggle()
    else useStore.getState().setOpen(!useStore.getState().open)
  }
  const dismiss = () => {
    if (isApp) platform.requestHide()
    else useStore.getState().setOpen(false)
  }
  useDoubleOption(toggle)

  // Escape closes the top-most thing: editor/panel first, then the overlay.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      if (!s.open) return
      if (s.editorId || s.panel) useStore.setState({ editorId: null, panel: null })
      else dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The timer runs whether or not the overlay is showing: menu-bar countdown,
  // end-of-timer bell + notification, and a heartbeat so a quit never loses time.
  useEffect(() => {
    if (!hydrated) return
    let beats = 0
    const tick = () => {
      const s = useStore.getState()
      const t = s.focusId ? s.tasks[s.focusId] : null
      let title = ''
      if (t) {
        const rem = remainingOf(t)
        if (rem <= 0 && !t.timer.notified) {
          s.markNotified(t.id)
          sound.bell()
          platform.notify({ title: 'Time’s up', body: t.title })
        }
        title = rem <= 0 ? 'Time’s up' : `${isRunning(t) ? '' : '❙❙ '}${fmtClock(rem)}`
      }
      setTrayTitle(title)
      platform.setTrayTitle(title)
      if (++beats % 15 === 0 && t && isRunning(t)) saveNow()
    }
    tick()
    const id = setInterval(tick, 1000)
    const unsub = useStore.subscribe((s, p) => {
      if (s.focusId !== p.focusId || s.tasks !== p.tasks) tick()
    })
    return () => {
      clearInterval(id)
      unsub()
    }
  }, [hydrated])

  // First run: show the gesture guide once.
  useEffect(() => {
    if (open && hydrated && !useStore.getState().settings.helpSeen) {
      const id = setTimeout(() => useStore.getState().open && useStore.setState({ panel: 'help' }), 900)
      return () => clearTimeout(id)
    }
  }, [open, hydrated])

  return (
    <>
      <GooDefs />
      {!isApp && (
        <>
          <Mesh />
          <MenuBar open={open} onToggle={toggle} trayTitle={trayTitle} />
          {!open && (
            <div className="desktop-hint">
              <div className="desktop-hint-key">⌥ ⌥</div>
              Double-tap Option, or click the Vitro icon in the menu bar
            </div>
          )}
        </>
      )}
      <AnimatePresence onExitComplete={() => platform.hidden()}>
        {hydrated && open && <Overlay key="overlay" vp={vp} onDismiss={dismiss} />}
      </AnimatePresence>
    </>
  )
}
