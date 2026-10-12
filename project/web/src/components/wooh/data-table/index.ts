// Public API for the data-table component.
// Pages should import from `@/components/data-table` rather than reaching into subfolders.

export type {
  ColumnAlign,
  ColumnDef,
  ColumnDisplayConfig,
  ColumnOverflow,
  ColumnSlot,
  ColumnWidthConfig,
} from './ColumnDef'

// The orchestrator component.
export { DataTable } from './DataTable'
export type { DataTableProps } from './DataTable'

// Cell renderers, in case a page wants to use them outside a DataTable.
export { ColorText } from './cells/ColorText'
export { parseColorTags } from './cells/parseColorTags'
export { DefaultCell } from './cells/DefaultCell'
export { DateCell } from './cells/DateCell'
export { NumberCell } from './cells/NumberCell'

// Magic wand auto-width feature.
export { MagicWandButton, MagicWandPicker } from './features/MagicWand'
export type {
  MagicWandButtonProps,
  MagicWandPickerProps,
} from './features/MagicWand'
export {
  useAutoColumnWidth,
  measureText,
  CHAR_WIDTH_PX,
  CJK_WIDTH_PX,
} from './features/useAutoColumnWidth'

// Column settings popover with lock support.
export { ColumnSettingsPopover } from './features/ColumnSettingsPopover'

// Bottom pagination.
export { Pagination } from './ui/Pagination'