# Draft: provider-slot-workflow

## Status: Planning approved → writing plan

## Decisions recorded
- Fork 1 (persistence): A — reuse `topology_configs` table, extend JSON
- Fork 2 (notification): A — Toast + switch stays OFF on conflict
- Fork 3 (test strategy): A — TDD (Vitest + Playwright E2E)

## Approach
9 components, sequential waves by dependency chain:
Wave 0: Backend (C9: response rewrite table/routes + topology_configs extension)
Wave 1: Types + Components (C2: NodeType, ResponseModifyNode, LogOutputNode; C8: LogOutputNode fields)
Wave 2: PolicyPage (C1: response rewrite tab)
Wave 3: Slot UI (C4: SlotContainer component, drag-reorder)
Wave 4: TopologyPage refactor (C3: buildNodes/buildEdges rewrite; C7: ModelHub simplification; C6: Provider 3B rules)
Wave 5: Node addition UX (C5: double-click + bottom-right button)
Wave 6: Integration + E2E

## Architecture decisions
- Slot order: ①requestModify ②responseModify ③autoReply ④concurrency ⑤autoSwitch ⑥logOutput
- Slot config stored in topology_configs.nodes JSON, keyed by provider_id
- Node indices: 1-based, serial execution within slot
- Ant-line: CSS dashed border animation
- Model group: virtual parent with forced position sync
