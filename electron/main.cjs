// Vitro shell: menu-bar item, transparent always-on-top overlay, global
// double-tap-Option summon, persistence and notifications.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut, Notification, nativeImage, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const FALLBACK_SHORTCUT = 'Control+Alt+Space'
const TOGGLE_DEBOUNCE_MS = 350

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let win = null
let tray = null
let helper = null
let helperRestarts = 0
let visible = false
let rendererReady = false
let pendingShow = false
let lastToggleAt = 0
let shownAt = 0
let hideTimer = null
let fadeTimer = null
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => show())
  app.whenReady().then(start)
}

function statePath() {
  return path.join(app.getPath('userData'), 'state.json')
}

function start() {
  if (app.dock) app.dock.hide()
  createWindow()
  createTray()
  startHelper()
  globalShortcut.register(FALLBACK_SHORTCUT, () => toggle())

  ipcMain.handle('state:load', () => {
    for (const file of [statePath(), statePath() + '.bak']) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        /* try the backup, then fall back to a fresh state */
      }
    }
    return null
  })
  ipcMain.on('state:save', (_e, data) => {
    try {
      const file = statePath()
      fs.mkdirSync(path.dirname(file), { recursive: true })
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak')
      fs.writeFileSync(file + '.tmp', JSON.stringify(data))
      fs.renameSync(file + '.tmp', file)
    } catch (err) {
      console.error('[vitro] save failed:', err)
    }
  })
  ipcMain.on('renderer:ready', () => {
    rendererReady = true
    // Opened by the user (not silently at login): show the overlay right away.
    if (pendingShow || !app.getLoginItemSettings().wasOpenedAtLogin) show()
    pendingShow = false
  })
  ipcMain.on('overlay:toggle', () => toggle())
  ipcMain.on('overlay:hide', () => hide())
  ipcMain.on('overlay:hidden', () => finishHide())
  ipcMain.on('tray:title', (_e, text) => {
    if (tray && !tray.isDestroyed()) tray.setTitle(text ? ` ${text}` : '', { fontType: 'monospacedDigit' })
  })
  ipcMain.on('notify', (_e, payload) => {
    if (!Notification.isSupported() || !payload) return
    const n = new Notification({ title: String(payload.title || 'Vitro'), body: String(payload.body || ''), silent: true })
    n.on('click', () => show())
    n.show()
  })
}

function createWindow() {
  win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    roundedCorners: false,
    type: 'panel', // non-activating: the app you were in stays frontmost
    vibrancy: 'fullscreen-ui',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // the focus timer keeps ticking while hidden
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('render-process-gone', () => {
    rendererReady = false
    visible = false
    if (!quitting && win && !win.isDestroyed()) {
      win.hide()
      win.reload()
    }
  })
  win.on('blur', () => {
    // Clicking another app or the Dock dismisses the overlay.
    if (visible && Date.now() - shownAt > 400 && !win.webContents.isDevToolsOpened()) {
      lastToggleAt = Date.now()
      hide()
    }
  })
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      hide()
    }
  })
}

function fadeTo(target, ms = 170) {
  clearInterval(fadeTimer)
  if (!win || win.isDestroyed()) return
  const from = win.getOpacity()
  const t0 = Date.now()
  fadeTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return clearInterval(fadeTimer)
    const k = Math.min(1, (Date.now() - t0) / ms)
    win.setOpacity(from + (target - from) * k)
    if (k >= 1) clearInterval(fadeTimer)
  }, 12)
}

function show() {
  if (!win || win.isDestroyed()) return
  if (!rendererReady) {
    pendingShow = true
    return
  }
  clearTimeout(hideTimer)
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  win.setBounds(display.workArea)
  if (!visible) win.setOpacity(0)
  visible = true
  shownAt = Date.now()
  win.show()
  win.focus()
  win.webContents.send('overlay:visibility', true)
  fadeTo(1)
}

function hide() {
  if (!win || win.isDestroyed() || !visible) return
  visible = false
  win.webContents.send('overlay:visibility', false)
  fadeTo(0, 200)
  clearTimeout(hideTimer)
  hideTimer = setTimeout(finishHide, 320) // safety net if the renderer never reports back
}

function finishHide() {
  clearTimeout(hideTimer)
  if (win && !win.isDestroyed() && !visible) win.hide()
}

function toggle() {
  const now = Date.now()
  if (now - lastToggleAt < TOGGLE_DEBOUNCE_MS) return // several sources can report the same gesture
  lastToggleAt = now
  if (visible) hide()
  else show()
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Vitro — double-tap Option')
  tray.on('click', () => toggle())
  tray.on('right-click', () => {
    const login = app.getLoginItemSettings().openAtLogin
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: visible ? 'Hide Vitro' : 'Show Vitro', click: () => toggle() },
        { label: 'Double-tap ⌥ Option, or ⌃⌥Space', enabled: false },
        { type: 'separator' },
        { label: 'Open at Login', type: 'checkbox', checked: login, click: () => app.setLoginItemSettings({ openAtLogin: !login }) },
        { type: 'separator' },
        { label: 'Quit Vitro', accelerator: 'Command+Q', click: () => app.quit() },
      ]),
    )
  })
}

function startHelper() {
  const bin = app.isPackaged ? path.join(process.resourcesPath, 'vitro-keyd') : path.join(__dirname, '..', 'build', 'vitro-keyd')
  if (!fs.existsSync(bin)) {
    console.warn('[vitro] double-tap helper missing at', bin, '— use', FALLBACK_SHORTCUT)
    return
  }
  const startedAt = Date.now()
  helper = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] })
  helper.stdout.on('data', (chunk) => {
    if (String(chunk).includes('toggle')) toggle()
  })
  helper.on('error', (err) => console.error('[vitro] helper error:', err))
  helper.on('exit', () => {
    helper = null
    if (quitting) return
    if (Date.now() - startedAt > 60_000) helperRestarts = 0
    if (helperRestarts++ < 5) setTimeout(startHelper, 1500)
  })
}

app.on('before-quit', () => {
  quitting = true
  if (helper) helper.kill()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  /* menu-bar app: stay alive without windows */
})
