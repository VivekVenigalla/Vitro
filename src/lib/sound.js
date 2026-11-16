// Tiny synthesized sound set (no audio files). All calls are safe no-ops when
// sound is disabled or Web Audio is unavailable.
let ctx = null
let enabled = true

function ac() {
  if (!enabled || typeof window === 'undefined') return null
  const C = window.AudioContext || window.webkitAudioContext
  if (!C) return null
  if (!ctx) ctx = new C()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function tone({ freq, to, type = 'sine', at = 0, dur = 0.3, gain = 0.07 }) {
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + at
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

function noise({ at = 0, dur = 0.08, gain = 0.06, freq = 5000, q = 1.2, type = 'bandpass' }) {
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + at
  const len = Math.max(1, Math.floor(a.sampleRate * dur))
  const buf = a.createBuffer(1, len, a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = a.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f).connect(g).connect(a.destination)
  src.start(t0)
}

export const sound = {
  setEnabled(v) {
    enabled = !!v
  },
  /** Task done: bright two-note rise. */
  chime() {
    tone({ freq: 880, dur: 0.35, gain: 0.06 })
    tone({ freq: 1318.5, at: 0.09, dur: 0.5, gain: 0.06 })
  },
  /** Last step ticked off: the task finishes itself. */
  celebrate() {
    ;[659.25, 880, 1108.7, 1318.5].forEach((f, i) => tone({ freq: f, at: i * 0.085, dur: 0.6, gain: 0.05 }))
  },
  /** Timer ran out. */
  bell() {
    tone({ freq: 587.33, dur: 1.2, gain: 0.08 })
    tone({ freq: 1174.66, dur: 0.9, gain: 0.03 })
    tone({ freq: 587.33, at: 0.55, dur: 1.4, gain: 0.07 })
  },
  /** Cancel: soft falling thud. */
  thud() {
    tone({ freq: 220, to: 70, dur: 0.22, gain: 0.09 })
  },
  /** Snooze: airy sweep. */
  whoosh() {
    noise({ dur: 0.22, gain: 0.04, freq: 1400, q: 0.6 })
  },
  /** A routine came due: soft two-note nudge. */
  nudge() {
    tone({ freq: 659.25, dur: 0.4, gain: 0.05 })
    tone({ freq: 987.77, at: 0.16, dur: 0.6, gain: 0.045 })
  },
  /** Card latched into the focus zone. */
  latch() {
    tone({ freq: 520, to: 780, dur: 0.14, gain: 0.05 })
  },
}
