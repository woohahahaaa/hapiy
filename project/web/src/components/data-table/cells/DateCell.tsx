"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { ColorText } from "./ColorText";

type DateCellProps = Readonly<{
  line1: string | null | undefined;
  line2?: string | null | undefined;
  emptyText?: string;
  showEmpty?: boolean;
  className?: string;
  /**
   * Overflow handling for each line:
   * - 'wrap' (default): lines wrap naturally and are always fully shown.
   * - 'ellipsis': each line is truncated to a single line with "…" when it
   *   exceeds the column width (width-based, not row-count-based).
   */
  overflow?: "ellipsis" | "wrap";
}>;

const LINE_BASE = "block leading-tight tabular-nums";

export function DateCell({
  line1,
  line2,
  emptyText,
  showEmpty = true,
  className,
  overflow = "wrap",
}: DateCellProps): JSX.Element | null {
  const l1Empty = line1 === null || line1 === undefined || line1 === "";
  const l2Empty = line2 === null || line2 === undefined || line2 === "";
  const bothEmpty = l1Empty && l2Empty;

  if (bothEmpty && !showEmpty) return null;

  if (bothEmpty) {
    return (
      <span className={cn("text-muted-foreground/40", className)}>
        {emptyText ?? "-"}
      </span>
    );
  }

  const lineClass =
    overflow === "ellipsis"
      ? cn(LINE_BASE, "overflow-hidden text-ellipsis whitespace-nowrap")
      : LINE_BASE;

  return (
    <Fragment>
      {!l1Empty && (
        <div className={cn(lineClass, className)}>
          <ColorText value={line1} />
        </div>
      )}
      {!l2Empty && (
        <div
          className={cn(
            lineClass,
            className,
          )}
        >
          <ColorText value={line2} />
        </div>
      )}
    </Fragment>
  );
}
