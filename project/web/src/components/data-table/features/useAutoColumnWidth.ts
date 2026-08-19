"use client";

import * as React from "react";

import type { ColumnDef } from "../ColumnDef";
import type { ColumnDisplayConfig } from "@/lib/dashboard-api";
import { parseColorTags } from "../cells/parseColorTags";

// ── Public structural types ──
//
// The `slot` field is intentionally NOT part of the upstream `ColumnDef`
// yet — cells that need it will set it via a runtime cast. We re-declare a
// structural view here so the algorithm can read `slot` without modifying
// `DataTable.tsx`.

export type ColumnLike = ColumnDef<unknown> & {
  readonly slot?: {
    readonly line1?: string | ((row: unknown) => string | null | undefined);
    readonly line2?: string | ((row: unknown) => string | null | undefined);
  };
};

// ── Tuning constants ──
//
// Average pixel width for a single character in a `text-xs font-mono` table.
// This is intentionally rough — the algorithm distributes widths
// proportionally, so absolute accuracy matters less than ratio accuracy.
// Tweak to taste if columns feel too cramped or too spacious.
export const CHAR_WIDTH_PX = 7.2;

// CJK glyphs are roughly ~1.6× wider than monospace ASCII at the same point
// size, so we count them with a larger fixed width.
export const CJK_WIDTH_PX = 12;

// Minimum pixel width a measured column is allowed to keep. A cell that is
// empty in the picked reference row measures ~0; flooring it prevents the
// column from collapsing to zero (invisible) width during auto layout.
export const MIN_COL_PX = 40;

// ── Helpers ──

/**
 * Rough pixel-width estimator for a string at `text-xs font-mono` rendering.
 * Counts CJK characters at {@link CJK_WIDTH_PX} and other characters at
 * {@link CHAR_WIDTH_PX}. This is intentionally approximate; the distribution
 * algorithm only needs proportional accuracy. Exported for unit testing.
 */
export function measureText(s: unknown): number {
  const str = toStringValue(s);
  if (!str) return 0;
  let px = 0;
  for (let i = 0; i < str.length; i++) {
    px += isCjkCode(str.charCodeAt(i)) ? CJK_WIDTH_PX : CHAR_WIDTH_PX;
  }
  return px;
}

function isCjkCode(code: number): boolean {
  // Covers the common CJK ranges encountered in CJK-language tables:
  //   0x3000–0x303F  CJK Symbols & Punctuation
  //   0x3400–0x4DBF  CJK Unified Ideographs Extension A
  //   0x4E00–0x9FFF  CJK Unified Ideographs (the main block)
  //   0xF900–0xFAFF  CJK Compatibility Ideographs
  //   0xFF00–0xFFEF  Halfwidth / Fullwidth Forms
  return (
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

function configToPx(
  cfg: ColumnDisplayConfig["width"],
  containerWidth: number,
): number {
  if (cfg.kind === "pixel") return cfg.value;
  if (containerWidth > 0) return (cfg.value / 100) * containerWidth;
  // No container width yet — treat the percent value as a raw pixel hint.
  // The caller will likely reject this result anyway.
  return cfg.value;
}

function toStringValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return "";
}

/**
 * Width estimate for cell content. Color tags (`<#hex>text</#hex>`) are markup,
 * not glyphs, so they are stripped before measuring — the visible text is what
 * defines the column's natural width. Text is measured at its full expanded
 * width regardless of how it renders (wrap/ellipsis).
 */
function visualWidth(v: unknown): number {
  const str = toStringValue(v);
  if (!str) return 0;
  const plain = parseColorTags(str).map((seg) => seg.text).join("");
  return measureText(plain);
}

function naturalWidthFor(
  col: ColumnLike,
  referenceRow: Record<string, unknown>,
  cfgWidth: ColumnDisplayConfig["width"],
  containerWidth: number,
): number {
  // (1) DOM-rendered cells can't be measured from the returned JSX. If the
  //     column exposes an `accessor` (raw text), measure that — it reflects
  //     the real content width and keeps the proportions honest. Otherwise
  //     fall back to the current config width.
  if (col.render) {
    if (col.accessor) {
      const v = typeof col.accessor === "function"
        ? col.accessor(referenceRow)
        : referenceRow[col.accessor];
      return visualWidth(v);
    }
    return configToPx(cfgWidth, containerWidth);
  }
  // (2) Two-line "slot" cells — take the wider of the two lines.
  if (col.slot) {
    const line1 = typeof col.slot.line1 === "function"
      ? col.slot.line1(referenceRow)
      : col.slot.line1;
    const line2 = typeof col.slot.line2 === "function"
      ? col.slot.line2(referenceRow)
      : col.slot.line2;
    return Math.max(visualWidth(line1), visualWidth(line2));
  }
  // (3) Single-line string value.
  return visualWidth(referenceRow[col.key]);
}

// ── Hook ──

export type UseAutoColumnWidthOpts = {
  referenceRow: Record<string, unknown> | null;
  columns: readonly ColumnDef<unknown>[];
  configs: readonly ColumnDisplayConfig[];
  containerWidth: number;
  /**
   * Indices of columns whose width is FIXED (won't be redistributed). Their
   * current config width is preserved as-is and the remaining width is
   * distributed among unlocked columns proportionally to their natural widths.
   */
  lockedIndices?: readonly number[];
};

export type UseAutoColumnWidthResult = {
  /** Ideal width per column in pixels. */
  pixelWidths: number[];
  /**
   * Sum of natural widths divided by containerWidth. >1 means natural
   * widths exceed the container (consider trimming); <1 means there's slack.
   * Used when converting to percentage mode.
   */
  ratio: number;
};

export function useAutoColumnWidth(opts: {
  referenceRow: Record<string, unknown> | null;
  columns: readonly ColumnDef<unknown>[];
  configs: readonly ColumnDisplayConfig[];
  containerWidth: number;
  lockedIndices?: readonly number[];
}): {
  pixelWidths: number[];
  ratio: number;
} {
  const { referenceRow, columns, configs, containerWidth, lockedIndices } =
    opts;

  return React.useMemo<UseAutoColumnWidthResult>(() => {
    const n = columns.length;
    if (n === 0) return { pixelWidths: [], ratio: 1 };

    const lockedSet = new Set(lockedIndices ?? []);

    // Bailouts — return the current configs in pixel form (no distribution).
    //  • No container width → can't convert percent → pixel sensibly.
    //  • No reference row   → can't measure anything.
    //  • All columns locked → nothing to redistribute.
    if (containerWidth <= 0 || referenceRow === null || lockedSet.size >= n) {
      const passthrough = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        const cfg = configs[i] ?? { width: columns[i]!.defaultWidth };
        passthrough[i] = configToPx(cfg.width, containerWidth);
      }
      return { pixelWidths: passthrough, ratio: 1 };
    }

    // Compute widths for every column. Locked columns keep their CURRENT
    // config width in pixels — the magic wand must not touch them — while
    // unlocked columns are measured from the reference row's content.
    // Empty cells floor at MIN_COL_PX so a column with no text in the picked
    // row doesn't collapse to zero width.
    const natural = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const cfg = configs[i] ?? { width: columns[i]!.defaultWidth };
      natural[i] = lockedSet.has(i)
        ? configToPx(cfg.width, containerWidth)
        : Math.max(
            naturalWidthFor(
              columns[i] as ColumnLike,
              referenceRow,
              cfg.width,
              containerWidth,
            ),
            MIN_COL_PX,
          );
    }

    // Distribute `remaining` width among unlocked columns proportional to
    // their natural widths. Locked columns keep their current pixel width.
    let lockedTotal = 0;
    let unlockedNaturalTotal = 0;
    for (let i = 0; i < n; i++) {
      if (lockedSet.has(i)) {
        lockedTotal += natural[i]!;
      } else {
        unlockedNaturalTotal += natural[i]!;
      }
    }
    const remaining = Math.max(0, containerWidth - lockedTotal);

    const out = new Array<number>(n);
    if (unlockedNaturalTotal > 0 && remaining > 0) {
      for (let i = 0; i < n; i++) {
        if (lockedSet.has(i)) {
          out[i] = natural[i]!;
        } else {
          out[i] = (natural[i]! / unlockedNaturalTotal) * remaining;
        }
      }
    } else if (remaining > 0) {
      // Every unlocked column has zero natural width (e.g. all values were
      // empty strings). Spread the remaining space evenly so they remain
      // visible.
      const unlockedCount = n - lockedSet.size;
      const each = unlockedCount > 0 ? remaining / unlockedCount : 0;
      for (let i = 0; i < n; i++) {
        out[i] = lockedSet.has(i) ? natural[i]! : each;
      }
    } else {
      // Container is fully consumed by locked columns.
      for (let i = 0; i < n; i++) out[i] = natural[i]!;
    }

    const ratio = containerWidth > 0
      ? natural.reduce((a, b) => a + b, 0) / containerWidth
      : 1;
    return {
      pixelWidths: out,
      ratio: Number.isFinite(ratio) ? ratio : 1,
    };
  }, [referenceRow, columns, configs, containerWidth, lockedIndices]);
}