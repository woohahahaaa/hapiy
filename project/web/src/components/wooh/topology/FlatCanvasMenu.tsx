import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { REQUEST_REWRITE_SLOT_TYPES, type RewriteSlotType } from '@/lib/flat-topology'

const ROW_CLASS = 'flex min-h-8 w-full items-center rounded-none px-2 text-sm transition-colors'
const PLAIN_ROW_CLASS = cn(ROW_CLASS, 'bg-muted/40 hover:bg-muted hover:text-foreground')
const EMERGENCY_ROW_CLASS = cn(ROW_CLASS, 'bg-warning/10 text-warning hover:bg-warning/20 hover:text-warning')

interface FlatCanvasMenuProps {
  x: number
  y: number
  mode: 'corner' | 'cursor'
  onAddFullWorkflow: () => void
  onAddEmergencyWorkflow: () => void
  onAddEntry: () => void
  onAddProviderSlot: () => void
  onAddSlot: (slotType: RewriteSlotType) => void
  onAddSwitch: () => void
  onClose: () => void
}

export function FlatCanvasMenu({
  x,
  y,
  mode,
  onAddFullWorkflow,
  onAddEmergencyWorkflow,
  onAddEntry,
  onAddProviderSlot,
  onAddSlot,
  onAddSwitch,
  onClose,
}: FlatCanvasMenuProps) {
  const { t } = useTranslation('topology')
  const positionStyle = mode === 'corner' ? { right: x, bottom: y } : { left: x, top: y }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-transparent"
        onMouseDown={(e) => {
          if (e.button === 0) onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
        aria-hidden="true"
      />
      <div
        className={cn(
          'fixed z-50 w-56 rounded-none border border-border bg-popover p-2 text-popover-foreground shadow-lg',
        )}
        style={positionStyle}
        role="menu"
      >
        <button
          type="button"
          onClick={() => {
            onAddFullWorkflow()
            onClose()
          }}
          className={PLAIN_ROW_CLASS}
        >
          <span>{t('menu.addFullWorkflow')}</span>
        </button>
        <div className="my-1.5 border-t border-border-subtle" />
        <button
          type="button"
          onClick={() => {
            onAddEntry()
            onClose()
          }}
          className={PLAIN_ROW_CLASS}
        >
          <span>{t('menu.addEntry')}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onAddProviderSlot()
            onClose()
          }}
          className={PLAIN_ROW_CLASS}
        >
          <span>{t('menu.addProviderSlot')}</span>
        </button>
        {REQUEST_REWRITE_SLOT_TYPES.map((slotType) => (
          <button
            key={slotType}
            type="button"
            onClick={() => {
              onAddSlot(slotType)
              onClose()
            }}
            className={PLAIN_ROW_CLASS}
          >
            <span>{t('menu.addSlot', { slot: t(`slot.${slotType}`) })}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            onAddSwitch()
            onClose()
          }}
          className={PLAIN_ROW_CLASS}
        >
          <span>{t('menu.addSwitch')}</span>
        </button>
        <div className="my-1.5 border-t border-border-subtle" />
        <button
          type="button"
          onClick={() => {
            onAddEmergencyWorkflow()
            onClose()
          }}
          className={EMERGENCY_ROW_CLASS}
        >
          <span>{t('menu.addEmergencyWorkflow')}</span>
        </button>
      </div>
    </>
  )
}
