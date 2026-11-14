# Vitro

Liquid-glass task triage for the macOS menu bar. Tasks float on the edges of
the screen as glass cards. Drag one to the center to focus it, then throw it to
triage it.

![Vitro overlay with task cards on the edges of the screen](docs/images/overview.jpg)

> The screenshots are captured from the running app's own layer. In use, the
> dark areas are your desktop, blurred behind the overlay.

## Install

Open `release/mac-arm64/Vitro.app`, or drag it to `/Applications` first.
Vitro lives in the menu bar; there is no Dock icon. Right-click the menu-bar
icon for **Open at Login** and **Quit**.

## How it works

### Summon

Double-tap ⌥ Option, click the menu-bar icon, or press ⌃⌥Space. Cards cascade
in along the top, left and right edges and leave the center clear. Esc or a
click on the backdrop dismisses the overlay.

### Focus

Drag a card toward the center. The focus zone lights up when you can let go.

![Dragging a card into the glowing focus zone](docs/images/drag.jpg)

On release the card morphs into the Focus Orb and its timer starts. The liquid
drains as time passes and shifts from cyan through green to amber. Click the
orb to pause or resume.

![Focus Orb half drained, with cards around it](docs/images/focus.jpg)

### Triage by throwing

Grab the orb and either flick it, or drag it past the ring until a label lights
up and let go. The labels show where each direction goes, and the orb glows in
the color of what will happen.

![Holding the orb past the ring: Done is lit with "Let go"](docs/images/throw.jpg)

| Direction | Result |
| --- | --- |
| Up or right | Done |
| Straight down | Cancel |
| Left | Snooze back to the edge, progress kept |
| A small nudge | Springs back to center |

The buttons under the orb do the same things. Every done or cancel shows an
Undo toast, and the ✓ in the dock opens a log where you can restore tasks.

### Steps

A task's steps appear as a checklist under the orb while you focus it. Ticking
off the last one finishes the task with a small celebration.

![Focused task with its steps listed under the orb](docs/images/steps.jpg)

Double-click a card to rename it.

### Edit a task

Hover a card and click ⋯ to set its title, priority, focus length and up to six steps.
Priority is also weight: urgent tasks tilt less, glide farther and take longer
to settle.

![Task editor with priority, focus length and steps](docs/images/editor.jpg)

### Add a task

Press `/` or `N`, type, and press Return. The dock also sets priority and
focus length for the new task.

## All gestures

![Gestures panel](docs/images/gestures.jpg)

## Good to know

- The menu bar shows the remaining time of the focused task, and a
  notification and bell fire when it runs out, even while the overlay is hidden.
- Tasks are saved to `~/Library/Application Support/Vitro/state.json`.
- The Claude desktop app also uses double-tap Option for Quick Entry by
  default. Change one of the two if they collide.

## Develop

```bash
npm install
npm run dev     # UI in a browser with a simulated desktop
npm test        # physics, geometry and state tests
npm run app     # build and run the real overlay with Electron
npm run dist    # package release/mac-arm64/Vitro.app
npm run icons   # regenerate the tray and app icons
```

Set `VITRO_USER_DATA=/some/folder` when running from source to use a separate
profile and leave your real tasks alone.

## Layout

- `src/store.js`: tasks, timers, steps, undo, persistence
- `src/lib/physics.js`: spring tiers, mass per priority, throw classifier, release velocity
- `src/lib/geometry.js`: edge slots and screen layout
- `src/components/TaskBody.jsx`: card and Focus Orb as one persistent element
- `src/components/Liquid.jsx`: SVG gooey liquid timer
- `electron/`: menu-bar item, transparent overlay window, notifications
- `native/vitro-keyd.swift`: global double-tap Option detector, no permissions needed
