"use client";

import * as React from "react";

import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TOOLTIP_TEXT = "请点击一行作为宽度参考";
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
  const handleToggle = React.useCallback(() => {
    onActivate?.(!isActive);
  }, [isActive, onActivate]);

  return (
    <Button
      variant={isActive ? "secondary" : "ghost"}
      size="icon-sm"
      aria-label={isActive ? "退出自动列宽" : "自动列宽"}
      title={isActive ? "退出自动列宽" : "自动列宽"}
      onClick={handleToggle}
    >
      <AppIcon name="auto_fix_high" size={14} />
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

  const handlePick = React.useCallback((mode: "percent" | "pixel") => {
    cbRef.current.onApply?.(mode);
  }, []);

  return (
    <>
      <Dialog
        modal={false}
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) onDismiss?.();
        }}
      >
        <DialogContent
          width="sm"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>宽度参考已选择</DialogTitle>
            <DialogDescription>选择宽度单位</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => handlePick("percent")}
            >
              百分比
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => handlePick("pixel")}
            >
              像素
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isActive && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none fixed z-50",
            "rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md",
            "whitespace-nowrap",
          )}
          style={{
            left: cursorPos ? cursorPos.x : 0,
            top: cursorPos ? cursorPos.y - TOOLTIP_OFFSET_PX : 0,
            transform: "translate(-50%, -100%)",
          }}
        >
          {TOOLTIP_TEXT}
        </div>
      )}
    </>
  );
}
