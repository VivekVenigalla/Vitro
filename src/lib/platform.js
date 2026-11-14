// Bridge to the Electron shell. In a plain browser the same UI runs against
// localStorage with a simulated desktop, which is what `npm run dev` shows.
const api = typeof window !== 'undefined' ? window.vitro : undefined
const KEY = 'vitro-state-v1'

export const isApp = !!api

export const platform = {
  isApp,
  async load() {
    if (api) return api.load()
    try {
      const raw = globalThis.localStorage?.getItem(KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },
  save(data) {
    if (api) return api.save(data)
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(data))
    } catch {
      /* storage unavailable */
    }
  },
  ready() {
    api?.ready()
  },
  onVisibility(cb) {
    return api ? api.onVisibility(cb) : () => {}
  },
  toggle() {
    api?.toggle()
  },
  requestHide() {
    api?.requestHide()
  },
  hidden() {
    api?.hidden()
  },
  setTrayTitle(text) {
    api?.setTrayTitle(text)
  },
  notify(payload) {
    api?.notify(payload)
  },
}
