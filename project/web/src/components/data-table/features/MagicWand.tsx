"use client";

import * as React from "react";
import type { JSX } from "react"
import { useTranslation } from "react-i18next";

import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from "@/components/dialog";
import { cn } from "@/lib/utils";

const TOOLTIP_OFFSET_PX = 12;

// ── Trigger button ──
// Lives inside the column-settings popover header (next to the title).
// Only reports activation; all flow state lives in the picker component.

export type MagicWandButtonProps = {
  onActivate?: (active: boolean) => void;
  isActive?: boolean;
};

export function MagicWandButton({
  onActivate,
  isActive = false,
}: MagicWandButtonProps): JSX.Element {
  const { t } = useTranslation('ui');
  const handleToggle = React.useCallback(() => {
    onActivate?.(!isActive);
  }, [isActive, onActivate]);

  return (
    <Button
      variant={isActive ? "secondary" : "outline"}
      size="icon-sm"
      className="border border-border"
      aria-label={isActive ? t("magicWand.exitAutoWidth") : t("magicWand.autoWidth")}
      title={isActive ? t("magicWand.exitAutoWidth") : t("magicWand.autoWidth")}
      onClick={handleToggle}
    >
      <AppIcon name="auto_fix_high" size={24} theme="outline" fill="currentColor" />
    </Button>
  );
}

// ── Picker + tooltip ──
// Rendered at DataTable level (always mounted) so it survives the settings
// popover closing. Shows a cursor-following hint while active, then a centered
// dialog asking for the width unit once a reference row has been picked.
//
// NOTE: the dialog is deliberately NON-modal. Radix's modal dialog locks body
// scroll, which triggers a full-screen black render on iPad/Android WebView
// when opened from a touch-driven click. Non-modal avoids the scroll lock; the
// open state is derived from `pendingReference` so the dialog closes as soon
// as the parent clears it (apply or dismiss).

export type MagicWandPickerProps = {
  onActivate?: (active: boolean) => void;
  onApply?: (mode: "percent" | "pixel") => void;
  /** Called when the dialog is dismissed without choosing. */
  onDismiss?: () => void;
  isActive?: boolean;
  /** Cursor position (clientX/clientY) for the follow-the-cursor tooltip. */
  cursorPos?: { x: number; y: number } | null;
  /**
   * The row the parent picked while magic mode was active. Non-null opens the
   * unit dialog; the parent clears it on apply/dismiss.
   */
  pendingReference?: { row: unknown; rowIdx: number } | null;
};

export function MagicWandPicker(props: MagicWandPickerProps): JSX.Element {
  const {
    onActivate,
    onApply,
    onDismiss,
    isActive = false,
    cursorPos = null,
    pendingReference = null,
  } = props;
  const { t } = useTranslation('ui');

  const dialogOpen = pendingReference !== null;

  // Keep callback identities out of the effect's dep list so a parent that
  // passes inline lambdas doesn't re-trigger on every render. Reads go through
  // the ref.
  const cbRef = React.useRef({ onActivate, onApply });
  React.useEffect(() => {
    cbRef.current.onActivate = onActivate;
    cbRef.current.onApply = onApply;
  }, [onActivate, onApply]);

  // Deactivate (hide the cursor tooltip) as soon as a reference row lands.
  React.useEffect(() => {
    if (!pendingReference) return;
    cbRef.current.onActivate?.(false);
  }, [pendingReference]);

  // Keep the follow-cursor tooltip inside the viewport: measure its rendered
  // size and flip the offset to the other side of the cursor when it would
  // overflow the right or bottom screen edge. The tooltip is rendered hidden
  // until the first clamp so it never flashes at an unclamped position.
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const [clampedPos, setClampedPos] = React.useState<{ x: number; y: number } | null>(null);
  React.useLayoutEffect(() => {
    if (!isActive || !cursorPos) {
      setClampedPos(null);
      return;
    }
    const rect = tooltipRef.current?.getBoundingClientRect();
    const pad = 8;
    let x = cursorPos.x + TOOLTIP_OFFSET_PX;
    let y = cursorPos.y + TOOLTIP_OFFSET_PX;
    if (rect) {
      if (x + rect.width + pad > window.innerWidth) {
        x = cursorPos.x - rect.width - TOOLTIP_OFFSET_PX;
      }
      if (y + rect.height + pad > window.innerHeight) {
        y = cursorPos.y - rect.height - TOOLTIP_OFFSET_PX;
      }
      x = Math.max(pad, x);
      y = Math.max(pad, y);
    }
    setClampedPos({ x, y });
  }, [isActive, cursorPos]);

  const handlePick = React.useCallback((mode: "percent" | "pixel") => {
    cbRef.current.onApply?.(mode);
  }, []);

  return (
    <>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) onDismiss?.();
        }}
      >
        <DialogContent
          width="xs"
          scrollFooter
        >
          <DialogHeader>
            <DialogTitle>{t('magicWand.referencePicked')}</DialogTitle>
            <DialogDescription>{t('magicWand.chooseUnit')}</DialogDescription>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => handlePick("percent")}
              >
                {t('magicWand.percent')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => handlePick("pixel")}
              >
                {t('magicWand.pixel')}
              </Button>
            </>
          } />
        </DialogContent>
      </Dialog>

      {isActive && (
        <div
          ref={tooltipRef}
          aria-hidden
          className={cn(
            "pointer-events-none fixed z-50",
            "rounded-xs border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md",
            "whitespace-nowrap",
          )}
          style={{
            left: clampedPos ? clampedPos.x : 0,
            top: clampedPos ? clampedPos.y : 0,
            visibility: clampedPos ? "visible" : "hidden",
          }}
        >
          {t('magicWand.pickHint')}
        </div>
      )}
    </>
  );
}
