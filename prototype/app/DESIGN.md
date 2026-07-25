# hapiy Prototype Design System

## Atmosphere & Identity

Build a quiet, precise operator console for a technical API relay dashboard. The visual language is Tweakcn Minimal Neutral in dark mode only: compact, readable, neutral, and information dense without feeling cramped. Use one cool blue focus accent for active and keyboard focus states. Do not use gradients, decorative illustrations, ornamental clutter, or emoji icons. Preserve the existing menu labels and topology behavior.

The primary canvas is a dark React Flow workspace. The sidebar is a stable navigation rail, while graph nodes are operational cards that should be easy to scan at a glance. Prefer hierarchy through tonal contrast, typography, and restrained borders rather than color variety.

## Color

Use the existing OKLCH tokens from `src/index.css` as the source of truth. Keep all values below unchanged unless a component needs a transparent blend of an existing token.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `oklch(0.2050 0 0)` | App and graph canvas |
| `--foreground` | `oklch(0.9850 0 0)` | Primary text |
| `--card` | `oklch(0.1650 0 0)` | Node cards and floating surfaces |
| `--card-foreground` | `oklch(0.9850 0 0)` | Text on cards |
| `--popover` | `oklch(0.2050 0 0)` | Menus and popovers |
| `--primary` | `oklch(0.9220 0 0)` | Primary neutral action and endpoint accent |
| `--primary-foreground` | `oklch(0.2050 0 0)` | Text on primary |
| `--secondary` | `oklch(0.2690 0 0)` | Secondary controls |
| `--muted` | `oklch(0.2690 0 0)` | Muted surface |
| `--muted-foreground` | `oklch(0.7080 0 0)` | Secondary text, edges, handles |
| `--accent` | `oklch(0.3710 0 0)` | Hover and selected neutral surface |
| `--border` | `oklch(0.2690 0 0)` | Dividers, card borders, controls |
| `--ring` | `oklch(0.5560 0 0)` | Focus and connecting handles |
| `--sidebar` | `oklch(0.2690 0 0)` | Sidebar surface |
| `--sidebar-primary` | `oklch(0.4880 0.2430 264.3760)` | Cool blue active and focus accent |
| `--sidebar-border` | `oklch(0.2750 0 0)` | Sidebar dividers |
| `--destructive` | `oklch(0.7040 0.1910 22.2160)` | Destructive or failure state only |

Use chart accents only for node type identity and existing graph semantics: `--chart-1` endpoint, `--chart-2` route, `--chart-4` channel, `oklch(0.5 0.15 80)` auto switch, and `oklch(0.5 0.1 200)` auto reply. Apply node accent fills at 12% opacity with a 3px left header rule, as in the existing node styles. Never introduce a second focus color or a light-mode palette. Keep `color-scheme: dark`.

## Typography

Use `"DM Sans", ui-sans-serif, sans-serif, system-ui` for all interface and node text. Use `"Geist Mono", ui-monospace, monospace` for URLs, model names, rules, latency, IDs, and other technical values. Load Google Material Symbols for icons, using the existing `material-symbols-outlined` class and named ligatures such as `hub`, `monitoring`, `cloud`, `key`, `tune`, `settings`, `bolt`, `menu_open`, and `menu`.

Keep the existing scale: 14px, weight 500 for top-level navigation; 13px for submenu labels and node headers; 12px for node base text; 11px for node properties; 10px for compact technical metadata. Use a 1.0 to 1.35 line height for compact controls and 1.4 for readable body copy. Keep normal tracking at `0em`. Do not use serif text or oversized display headings in the operator workspace.

## Spacing & Layout

Use a 4px base scale, exposed by `--spacing: 0.25rem`. Valid spacing steps are 4, 8, 12, 16, 20, 24, 32, and 40px. Prefer these values for padding, gaps, offsets, and control dimensions. The existing 16px sidebar inset, 8px menu top padding, 12px node horizontal padding, 12px node body inset, and 4px node property gap are canonical examples.

Support these viewport targets:

| Viewport | Layout rule |
| --- | --- |
| 375px | Default to the 44px compact rail at widths up to 640px. Manual expansion opens a 272px overlay while the graph keeps its 44px offset and remains pannable. |
| 768px | Allow the 208px expanded sidebar and 44px collapsed rail. Keep node cards at their intrinsic width and let React Flow handle panning. |
| 1280px | Default to the 208px expanded sidebar, with the graph occupying the remaining width. Preserve generous graph breathing room without adding decorative panels. |

The sidebar geometry follows the verified local New API source in `code/web/src/components/ui/sidebar.tsx`, including its constants and `sidebarMenuButtonVariants`: desktop is 208px (`13rem`) expanded, collapsed is 44px (`2.75rem`), and the mobile overlay is 272px (`17rem`). At viewport widths `<= 640px`, state defaults and switches to collapsed; manual expansion opens the 272px overlay while the main area keeps a 44px left offset. The top-left header is 48px tall and contains the collapse toggle, which is 32px. There is no logo or product-name block. Menu buttons are 32px tall with 8px padding and a 16px icon. Submenu rows use the same 32px height and 8px padding rhythm. The main area remains 100vh high with overflow hidden.

Node cards are 192px wide. Use 8px 12px header padding with the separate 3px left accent rule, 8px 12px body padding, 4px property gap, and 8px circular handles. Keep graph background dots at a 20px gap and 1px size. Do not resize nodes to fit the viewport. At small widths, users pan and zoom the graph instead.

## Components

- **Sidebar:** Use the existing Material Symbols, labels, active state, nested submenu, hover state, and the top-left collapse toggle. Do not add a logo or product-name block. Expanded items show icon, label, and child arrow. Collapsed items center the icon, hide labels and submenus, and use `--sidebar-primary` for the active item. Keep the 1px right and header dividers.
- **Navigation item:** Use `--sidebar-accent` for hover and the New API-like muted surface for active items. Active text uses medium weight and active icons use the primary color. Inactive text uses `--muted-foreground`. Menu buttons and submenu rows use the verified 32px height, 8px padding, and 16px icon rhythm.
- **Node card:** Use `--card`, a 1px `--border`, an 11px radius, and the existing `--shadow-sm`. Headers use 13px semibold text and a 1px bottom divider. Bodies use compact rows with muted property labels and foreground values.
- **Node types:** Endpoint, route, channel, auto switch, and auto reply keep their existing accent mapping and 12% tonal overlay. Auto switch slots use 6px vertical gaps, 6px 8px padding, a 1px accent-mixed border, and a half-radius surface.
- **React Flow controls:** Controls use `--card` background, a 1px `--border`, a 10px utility radius, 34px control buttons, and foreground SVG icons. Hover uses `--accent`. The minimap uses `--card`, a 1px `--border`, a 10px utility radius, and the existing dark mask; size it to 128x84px on desktop and 104x72px on mobile. Hide attribution as already configured.
- **Graph states:** Edges use `--muted-foreground` at 1.5px, connection paths use `--primary` at 2px, and selection uses the existing blue accent at 8% fill with a 30% border. Handles use muted foreground, become foreground on hover, `--ring` while connecting, and `--chart-2` when valid.
- **Focus:** Every button, menu item, submenu item, control, handle, and other keyboard target needs a visible `:focus-visible` outline using `--sidebar-primary` or the existing cool blue token, with a 2px outline and 2px offset. Never remove the focus indicator for a cleaner appearance.

## Motion & Interaction

Motion is functional and short. Use the existing timing character: 150ms for color and background changes and 200ms for desktop sidebar width, icon rotation, and arrow transitions. Submenus render only while open rather than animating layout. Mobile sidebar and canvas layout changes are immediate. Use `ease` or a similarly calm easing curve. Animate only `width`, `transform`, `opacity`, and color-like properties where the existing prototype already does so. Avoid bouncing, parallax, continuous decorative motion, and layout-shifting effects.

Hover, active, focus, connecting, and valid states must be visually distinct but remain within the neutral palette and the single cool blue focus accent. Respect `prefers-reduced-motion: reduce` by shortening transitions to near zero. Collapsing the sidebar hides labels and submenus without changing menu labels or navigation behavior.

## Depth & Surface

Use a mixed depth strategy. Establish most hierarchy with tonal surfaces: `--background` for the canvas, `--sidebar` for navigation, `--card` for nodes and controls, and `--accent` or `--muted` for interaction surfaces. Add a subtle 1px `--border` to separate adjacent regions. Do not use gradients.

Shadows are reserved for floating graph cards and floating React Flow controls. Use the existing `--shadow-sm` for node cards and the existing neutral shadow family for controls or other clearly floating graph utilities. Do not add shadows to every sidebar item, menu row, or inline section. Use 10px utility radii, 11px node radii, and 8px submenu radii; apply the existing radius proportions to smaller internal slots only where needed. Keep surfaces opaque or use only restrained accent overlays that preserve the dark neutral base.
