import { useEffect, useState } from 'react'

/**
 * Slow-drifting mesh gradient. The blobs are soft radial gradients that only
 * ever animate `transform`, so the layer stays on the compositor and the glass
 * cards above it don't force a repaint every frame.
 * `veil` renders the translucent version used over the real desktop in the app.
 */
export function Mesh({ veil = false }) {
  return (
    <div className={veil ? 'mesh mesh-veil' : 'mesh mesh-desktop'} aria-hidden="true">
      <i className="m1" />
      <i className="m2" />
      <i className="m3" />
      <i className="m4" />
      <i className="m5" />
    </div>
  )
}

/** Browser preview only: a stand-in macOS menu bar with the Vitro status item. */
export function MenuBar({ open, onToggle, trayTitle }) {
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 15000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="menubar" data-testid="menubar">
      <span className="mb-apple" aria-hidden="true">
        <svg width="13" height="15" viewBox="0 0 14 17" fill="currentColor"><path d="M11.6 9c0-2 1.6-2.9 1.7-3-1-1.300-2.400-1.500-2.900-1.500-1.200-.1-2.400.7-3 .7-.6 0-1.600-.7-2.600-.7C3.400 4.500 2.100 5.300 1.400 6.500c-1.400 2.500-.4 6.100 1 8.100.7 1 1.500 2.100 2.500 2 1-.04 1.400-.6 2.600-.6 1.200 0 1.500.6 2.600.6 1.100 0 1.800-1 2.400-2 .8-1.100 1.100-2.200 1.100-2.300-.02 0-2.100-.8-2.100-3.300zM9.600 3.200c.5-.7.9-1.600.8-2.500-.8 0-1.700.5-2.300 1.200-.5.6-.9 1.500-.8 2.400.9.1 1.800-.4 2.300-1.100z" /></svg>
      </span>
      <b>Finder</b>
      <span>File</span>
      <span>Edit</span>
      <span>View</span>
      <span>Go</span>
      <span>Window</span>
      <span className="flex-1" />
      <button
        className={`mb-vitro ${open ? 'is-on' : ''}`}
        onClick={onToggle}
        title="Vitro (double-tap Option)"
        aria-label={open ? 'Dismiss Vitro' : 'Summon Vitro'}
        aria-pressed={open}
        data-testid="menubar-vitro"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="6.6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3.200 9.800c1.500-1.200 3-1.200 4.400 0s3.600 1.200 7.200-.4a5.800 5.800 0 0 1-11.600.4z" fill="currentColor" />
        </svg>
        {trayTitle && <span className="mb-timer">{trayTitle}</span>}
      </button>
      <span>{clock.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      <span>{clock.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
    </div>
  )
}
