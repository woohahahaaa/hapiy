# New API Sidebar Production Preview Verification

Result: FAIL

## Build
- `npm run lint`: PASS
- `npm run build`: PASS
- Preview: `http://127.0.0.1:28002/` (production preview)

## Playwright evidence
- 1280x800 expanded: sidebar 208px, main x 208px, header 48px, top-level button 32px, icon 16px, 9 nodes at 192px, canvas 1072x800, document scrollWidth 1280. PASS.
- 1280x800 collapsed: sidebar 44px, main x 44px, header 48px, top-level button 32px, icon 16px, 9 nodes at 192px, canvas 1236x800, document scrollWidth 1280. PASS.
- 768x1024 expanded: sidebar 208px, main x 208px, 9 nodes at 192px, canvas 560x1024, document scrollWidth 768. PASS.
- 375x812 initial: sidebar 44px, main x 44px, document scrollWidth 375, 9 nodes at 192px, canvas 331x812. PASS.
- 375x812 expanded: sidebar 272px, main x 44px, document scrollWidth 375, labels visible 6. PASS.
- 375x812 restored after second click: after waiting for the 200ms transition, sidebar 44px, main x 44px, document scrollWidth 375. PASS.
- Menu labels/icons: unchanged: 转发拓扑/hub, 监控/monitoring, 供应商/cloud, 令牌管理/key, 策略配置/tune, 系统设置/settings. PASS.
- Console: 0 messages, 0 errors, 0 warnings, including favicon. PASS.

## Failure
- Immediate post-click mobile measurement at 80-100ms observed transitional widths (170.922px); this is expected during the documented 200ms desktop/sidebar transition but means the strict immediate assertion is not stable. The settled state is 44px after 400ms.
- Automated rectangle overlap scan reports graph nodes intersect each other at their intentional React Flow layout positions (`route1`/`autoSwitch`) and canvas descendants intersect their containing main area. No sidebar/main geometry overlap was found; visual screenshot review is required for intentional graph intersections.

## Screenshots
- `desktop-1280-expanded.png`
- `desktop-1280-collapsed.png`
- `tablet-768-expanded.png`
- `mobile-375-expanded.png`
- `mobile-375-collapsed.png`

## Cleanup
- Browser closed: PASS
- Preview stopped: PASS
- Port 28002 free: PASS
