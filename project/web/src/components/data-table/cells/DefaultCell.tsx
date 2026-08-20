"use client";

import { cn } from "@/lib/utils";
import { ColorText } from "./ColorText";

type DefaultCellProps = Readonly<{
  value: string | number | null | undefined;
  emptyText?: string;
  showEmpty?: boolean;
  className?: string;
}>;

export function DefaultCell({
  value,
  emptyText,
  showEmpty = true,
  className,
}: DefaultCellProps): JSX.Element | null {
  const isEmpty = value === null || value === undefined || value === "";
  if (isEmpty) {
    if (!showEmpty) return null;
    return (
      <span className={cn("text-muted-foreground/40", className)}>
        {emptyText ?? "-"}
      </span>
    );
  }
  return <ColorText value={String(value)} className={className} />;
}