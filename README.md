# Vitro

Liquid-glass task triage for the macOS menu bar. Tasks float on the edges of the
screen as glass cards; drag one to the center to focus it, then throw it to
triage it.

## Use it

Open `release/mac-arm64/Vitro.app` (drag it to `/Applications` if you like).
Vitro lives in the menu bar — there is no Dock icon.

| Gesture | What it does |
| --- | --- |
| Double-tap ⌥ Option, click the menu-bar icon, or ⌃⌥Space | Summon / dismiss |
| Drag a card to the center and let go | Focus it (starts its timer) |
| Throw the orb up or right | Done |
| Throw the orb straight down | Cancel |
| Throw the orb left | Snooze back to the edge |
| Click the orb | Pause / resume |
| ⌥-click a card with 2–4 steps | Shatter into step shards |
| Drop a shard next to a sibling | Re-fuse into the parent card |
| Double-click a card or shard | Rename |
| `/` or `N` | New task |
| Esc, or click the backdrop | Dismiss |

Right-click the menu-bar icon for **Open at Login** and **Quit**. The menu bar
shows the remaining time of the focused task, and a notification fires when the
timer runs out. Tasks are saved to
`~/Library/Application Support/Vitro/state.json`.

## Develop

```bash
npm install
npm run dev     # UI in a browser with a simulated desktop
npm test        # physics, geometry and state tests
npm run app     # build and run the real overlay with Electron
npm run dist    # package release/mac-arm64/Vitro.app
npm run icons   # regenerate the tray + app icons
```

## Layout

- `src/store.js` — tasks, timers, shatter / re-fuse, undo, persistence
- `src/lib/physics.js` — spring tiers, mass per priority, throw classifier
- `src/lib/geometry.js` — edge slots, shatter polygons, shard placement
- `src/components/TaskBody.jsx` — card ↔ shard ↔ Focus Orb (one persistent element)
- `src/components/Liquid.jsx` — SVG gooey liquid timer
- `electron/` — menu-bar item, transparent overlay window, notifications
- `native/vitro-keyd.swift` — global double-tap-Option detector (no permissions needed)
