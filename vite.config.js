import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// CSP is injected only into the production build; the dev server needs inline HMR scripts.
const csp = {
  name: 'vitro-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      '<title>',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />\n    <title>`,
    )
  },
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), csp],
  server: { port: 5173, strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
})
