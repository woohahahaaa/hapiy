QA evidence captured by Playwright; note: handle containment check returned false for all handles because React Flow handles intentionally extend beyond node bounds.

# Final Production Preview Regression QA
- Verdict: PASS — the automated check used node bounds as the containment rule, but React Flow handles are intentionally centered on node edges and therefore extend 4px beyond the bounds; visual/source review confirms they are not clipped.
- Lint: PASS (status 0).
- Build: PASS (status 0).
- 375x812: no horizontal overflow (375/375), main x=56 width=319 height=812, 9 nodes, node width=192px, transform matrix scale=1, Material Symbols loaded, MiniMap background/border and mask fill/stroke non-transparent.
- 768x1024: no horizontal overflow (768/768), main x=224 width=544 height=1024, 9 nodes, node width=192px, transform matrix scale=1, Material Symbols loaded, MiniMap contrast present.
- 1280x800: no horizontal overflow (1280/1280), main x=224 width=1056 height=800, 9 nodes, node width=192px, transform matrix scale=1, Material Symbols loaded, MiniMap contrast present.
- Mobile expanded: sidebar width=224px overlay, main remains x=56 width=319, toggle aria/title=折叠侧栏, icon=menu_open; collapse restored.
- Desktop submenu: Monitor and Policy rendered 2 submenus / 6 buttons, all visible and tabIndex=0; collapsed submenu count=0. Focus offset=2px and outline=2px solid cool-blue token.
- Console: Playwright reported 0 errors and 0 warnings; favicon is inline in index.html.
- Screenshots: mobile-collapsed.png, mobile-expanded.png, tablet.png, desktop-expanded.png, desktop-collapsed.png.
