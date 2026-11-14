import { memo } from 'react'

// Surface blobs: they bob through the waterline and the goo filter fuses them
// with the body, so the surface heaves and droplets pinch off.
const BLOBS = [
  { cx: 18, r: 20, dx: 6, dy: -16, dur: 3.4, delay: -0.4 },
  { cx: 52, r: 16, dx: -8, dy: -30, dur: 2.7, delay: -1.3 },
  { cx: 84, r: 24, dx: 5, dy: -14, dur: 4.1, delay: -2.2 },
  { cx: 118, r: 15, dx: 9, dy: -34, dur: 3.0, delay: -0.9 },
  { cx: 146, r: 22, dx: -6, dy: -15, dur: 3.7, delay: -3.0 },
  { cx: 178, r: 17, dx: -5, dy: -24, dur: 2.9, delay: -1.8 },
  { cx: 100, r: 9, dx: 14, dy: -52, dur: 4.6, delay: -2.6 },
  { cx: 60, r: 8, dx: -12, dy: -46, dur: 5.2, delay: -0.2 },
]
const BUBBLES = [
  { cx: 40, r: 3.2, dur: 3.8, delay: -1.0 },
  { cx: 76, r: 2.2, dur: 5.0, delay: -3.2 },
  { cx: 108, r: 3.8, dur: 4.4, delay: -0.3 },
  { cx: 134, r: 2.4, dur: 3.5, delay: -2.1 },
  { cx: 160, r: 3.0, dur: 5.4, delay: -4.0 },
]

/**
 * Volumetric timer. `progress` 0 → 1 drains the liquid from the top down and
 * shifts its color from deep cyan to amber (mixed in OKLCH so the midpoint
 * stays saturated instead of going grey).
 */
function Liquid({ progress, active }) {
  const p = Math.min(1, Math.max(0, progress))
  const top = 6 + p * 200 // waterline in viewBox units; fully off the bottom at p = 1
  const pct = (p * 100).toFixed(2)
  const color = `color-mix(in oklch, #f59e0b ${pct}%, #0ea5e9)`
  const deep = `color-mix(in oklch, color-mix(in oklch, #f59e0b ${pct}%, #0ea5e9) 72%, #0b1d3a)`
  const play = active ? 'running' : 'paused'
  return (
    <svg className="liquid absolute inset-0 h-full w-full" viewBox="0 0 200 200" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="vitro-depth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.25" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <g filter="url(#vitro-goo)">
        <g className="liquid-level" style={{ transform: `translateY(${top}px)` }}>
          <rect x="-30" y="0" width="260" height="260" style={{ fill: deep }} className="liquid-fill" />
          {BLOBS.map((b, i) => (
            <circle
              key={i}
              className="liquid-blob liquid-fill"
              cx={b.cx}
              cy="4"
              r={b.r}
              style={{
                fill: i % 3 === 0 ? color : deep,
                '--dx': `${b.dx}px`,
                '--dy': `${b.dy}px`,
                animationDuration: `${b.dur}s`,
                animationDelay: `${b.delay}s`,
                animationPlayState: play,
              }}
            />
          ))}
        </g>
      </g>
      <g className="liquid-level" style={{ transform: `translateY(${top}px)` }}>
        <rect x="-30" y="-2" width="260" height="262" fill="url(#vitro-depth)" style={{ mixBlendMode: 'soft-light' }} />
        {BUBBLES.map((b, i) => (
          <circle
            key={i}
            className="liquid-bubble"
            cx={b.cx}
            cy="0"
            r={b.r}
            style={{ animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s`, animationPlayState: play }}
          />
        ))}
      </g>
    </svg>
  )
}

export default memo(Liquid)

/** Shared SVG filter. Rendered once at the app root. */
export function GooDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id="vitro-goo" filterUnits="userSpaceOnUse" x="-20" y="-20" width="240" height="240" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  )
}
