# UI polish production QA

Date: 2026-07-25
URL: `http://127.0.0.1:28002/` (Vite production preview)

## Build gates

- `npm run lint`: PASS (Oxlint, no findings)
- `npm run build`: PASS (Vite 8.1.5, 186 modules, built in 496 ms)
- Full command output: `lint.txt`, `build.txt`

## Browser checks

| Viewport | Sidebar | Document | Main / React Flow | Nodes | Material Symbols | Controls / minimap | CJK labels | Console |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1280x800 | 224px expanded; 56px collapsed | 1280 <= 1280 | 1056x800 expanded; 1224x800 collapsed | 9 | loaded | no critical overlap | visually intact | favicon 404 only |
| 768x1024 | 224px expanded | 768 <= 768 | 544x1024 | 9 | loaded | no critical overlap | intact | no new app errors |
| 375x812 | forced 56px compact rail | 375 <= 375 | 319x812 | 9 | loaded | no critical overlap | intact | no errors |

## Interaction and visual QA

- Desktop collapse toggle changed sidebar/main widths from 224/1056px to 56/1224px.
- Monitor and Policy submenus both expanded; clicking `活动监视` produced the active `aria-current="page"` state.
- Keyboard focus on sidebar controls rendered a 2px solid cool-blue focus outline.
- Fresh reloads were used for tablet and mobile checks.
- Mobile labels/submenus remained hidden in the compact rail; the React Flow canvas stayed pannable rather than resizing node cards.
- React Flow controls, minimap, and canvas topbar did not geometrically overlap each other at any target viewport.
- Screenshots visually confirm CJK labels are not clipped. Off-screen graph content at 375px is expected pannable-canvas behavior from `DESIGN.md`.
- The minimap has non-zero dimensions at every viewport. Its dark/low-contrast appearance follows the configured dark mask and is not a blocking overlap or sizing defect.

## Fixes

No UI-polish regression requiring a code change was found. No source files were modified.

## Evidence

- `desktop-expanded.png`
- `desktop-collapsed.png`
- `tablet.png`
- `mobile.png`
- `lint.txt`
- `build.txt`
- `preview.log`
- `preview.pid`
- `cleanup.txt`
