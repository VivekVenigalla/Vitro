import { createRoot } from 'react-dom/client'
import App from './App'
import { isApp } from './lib/platform'
import './index.css'

document.documentElement.classList.add(isApp ? 'is-app' : 'is-web')
createRoot(document.getElementById('root')).render(<App />)

// Dev-only handle for poking at state from the console.
if (import.meta.env.DEV) import('./store').then((m) => (window.__vitro = m.useStore))
