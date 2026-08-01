---
slug: topology-magic-layout
status: approved-writing-plan
intent: clear
pending-action: write .omo/plans/topology-magic-layout.md
approach: Split responsibilities: components render configurable sizes; magic wand measures current DOM node bounds and computes only edge-to-edge positions.
---

# Draft: topology-magic-layout

## Components (topology ledger)
- C1 | Shared topology config separates render parameters from layout gaps | active | project/web/src/config/topology.json
- C2 | Provider/slot/modelHub components render according to confirmed sizing rules | active | project/web/src/nodes/ProviderNode.tsx; project/web/src/nodes/SlotNode.tsx; project/web/src/nodes/ModelHubNode.tsx
- C3 | Slot component equalizes its children during rendering, not layout | active | project/web/src/components/topology/SlotContainer.tsx; project/web/src/components/topology/slot-items/SlotItemCard.tsx
- C4 | Magic wand lays out groups from live DOM sizes with edge gaps | active | project/web/src/pages/TopologyPage.tsx; project/web/src/lib/topology-auto-layout.ts
- C5 | Automated regression and browser verification prove real dimensions and spacing | active | project/web/src/lib/topology-auto-layout.test.ts

## Open assumptions (announced defaults)
- Actual React Flow node wrapper bounds are the authoritative dimensions; layout coordinates use the same coordinate space after normalizing browser scale. Reversible; required to honor the user requirement.
- Existing six-slot order remains SLOT_ORDER. Repository evidence confirms this; no new slot ordering behavior.
- Existing provider-id grouping and deterministic ordering remain unless directly required by the confirmed layout rules.

## Findings (cited - path:lines)
- `project/web/src/pages/TopologyPage.tsx:399-412`: magic wand currently calls layout without the measured size map.
- `project/web/src/lib/topology-auto-layout.ts:41-44,89-95,108-135`: layout currently uses fixed config dimensions and already expresses edge-to-edge arithmetic, but needs live sizes and final alignment semantics.
- `project/web/src/lib/use-reactflow-node-sizes.ts:7-61`: ResizeObserver already records `.react-flow__node` bounding boxes keyed by `data-id`; it is not wired into TopologyPage.
- `project/web/src/nodes/ProviderNode.tsx:61-65`: Provider has fixed config width constraints; inner padding is component-local and stays out of JSON.
- `project/web/src/nodes/SlotNode.tsx:56-64`: Slot currently applies fixed min/max dimensions, conflicting with no slot max-width rule.
- `project/web/src/components/topology/SlotContainer.tsx:23-57`: empty and populated slot rendering paths exist; populated children and add button share a vertical stack.
- `project/web/src/nodes/ModelHubNode.tsx:29-36`: modelHub currently has min/max constraints, conflicting with content-plus-padding-only rule.
- `project/web/src/config/topology-config.ts:23-55`: current config schema is dagre/nodeDimensions/initialPositions and must be reshaped or extended without provider padding.
- `project/web/src/lib/topology-auto-layout.test.ts:32-105`: existing tests assert fixed dimensions and need conversion to explicit injected sizes and edge-gap assertions.

## Decisions (with rationale)
- Node rendering owns node size; magic wand must not synthesize or mutate dimensions.
- `node.minWidth=200` and `node.maxWidth=300` apply to Provider and slot-internal items, not the slot shell.
- Slot shell has no max-width; its component equalizes all internal items to the slot-local maximum, including the add button.
- modelHub has no min/max width; its component uses content and padding only.
- All horizontal and vertical gaps are literal edge-to-edge distances.
- Provider internal padding remains hard-coded in ProviderNode and is not configurable JSON.
- The shared JSON is the source for configurable render rules and layout gaps; changing it affects component rendering and subsequent measured layout.

## Scope IN
- Update topology configuration shape and values needed for shared node sizing, slot/modelHub padding, and layout edge gaps.
- Update Provider, Slot/SlotContainer, slot-item, and modelHub rendering to follow the confirmed ownership rules.
- Wire live DOM size measurement into magic-wand layout.
- Implement deterministic group, top/left/right/center alignment and edge-gap calculations.
- Add/adjust unit tests and browser QA.

## Scope OUT (Must NOT have)
- Magic wand must not calculate content widths, equalize slot children, or use fixed config dimensions when live measurements exist.
- Do not put Provider internal padding in JSON.
- Do not give the slot shell a 300px max-width.
- Do not give modelHub a min-width or max-width.
- Do not change persistence semantics beyond saving calculated positions already used by the page.

## Open questions
- None blocking after user approval; exact existing CSS metrics should be preserved unless the shared configurable values are explicitly replacing them.

## Approval gate
status: approved
User explicitly said `开干`; write the decision-complete plan artifact now. Execution remains the worker phase (`start-work`).
