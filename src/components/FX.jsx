import { motion } from 'motion/react'
import { useStore } from '../store'

const SPARKS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + (i % 2) * 0.2
  const d = 150 + (i % 3) * 46
  return { x: Math.cos(a) * d, y: Math.sin(a) * d, s: 5 + (i % 3) * 2 }
})

/** Localized flashes and ripples. Purely decorative; never intercepts input. */
export default function FX() {
  const fx = useStore((s) => s.fx)
  return (
    <div className="pointer-events-none absolute inset-0 z-[70] overflow-hidden">
      {fx.map((f) => {
        if (f.type === 'ripple') {
          return (
            <div key={f.id} className="absolute" style={{ left: f.x, top: f.y }}>
              <motion.div className="fx-flash" initial={{ scale: 0.4, opacity: 0.9 }} animate={{ scale: 2.4, opacity: 0 }} transition={{ duration: 0.55, ease: 'easeOut' }} />
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="fx-ring"
                  initial={{ scale: 0.5, opacity: 0.85 }}
                  animate={{ scale: 2.6 + i * 0.9, opacity: 0 }}
                  transition={{ duration: 0.9 + i * 0.15, delay: i * 0.09, ease: [0.2, 0.7, 0.2, 1] }}
                />
              ))}
            </div>
          )
        }
        if (f.type === 'shatter') {
          return (
            <motion.div
              key={f.id}
              className="fx-shatter"
              style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
              initial={{ opacity: 0.85, scale: 1 }}
              animate={{ opacity: 0, scale: 1.12 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          )
        }
        if (f.type === 'celebrate') {
          return (
            <div key={f.id} className="absolute" style={{ left: f.x, top: f.y }}>
              <motion.div className="fx-flash fx-flash-warm" initial={{ scale: 0.3, opacity: 0.9 }} animate={{ scale: 3.4, opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
              {SPARKS.map((p, i) => (
                <motion.div
                  key={i}
                  className="fx-spark"
                  style={{ width: p.s, height: p.s }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.3 }}
                  transition={{ duration: 1.0, delay: (i % 4) * 0.03, ease: [0.1, 0.7, 0.2, 1] }}
                />
              ))}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
