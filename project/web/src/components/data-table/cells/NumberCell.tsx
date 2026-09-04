"use client";

import { cn } from "@/lib/utils";
import type { JSX } from "react";
import { ColorText } from "./ColorText";

type NumberCellProps = Readonly<{
  value: number | string | null | undefined;
  format?: (n: number) => string;
  emptyText?: string;
  showEmpty?: boolean;
  className?: string;
}>;

export function NumberCell({
  value,
  format,
  emptyText,
  showEmpty = true,
  className,
}: NumberCellProps): JSX.Element | null {
  const isEmpty = value === null || value === undefined || value === "";
  if (isEmpty) {
    if (!showEmpty) return null;
    return (
      <span className={cn("text-muted-foreground/40", className)}>
        {emptyText ?? "-"}
      </span>
    );
  }

  const text =
    typeof value === "number" ? (format?.(value) ?? String(value)) : value;

  return <ColorText value={text} className={className} />;
}