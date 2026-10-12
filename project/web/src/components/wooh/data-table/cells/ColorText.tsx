"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { parseColorTags } from "./parseColorTags";

type ColorTextProps = {
  value: string | null | undefined;
  className?: string;
};

export function ColorText({ value, className }: ColorTextProps) {
  if (value == null || value === "") return null;

  const segments = parseColorTags(value);

  return (
    <span className={cn(className)}>
      {segments.map((seg, idx) =>
        seg.color !== undefined ? (
          <span key={idx} style={{ color: seg.color }}>
            {seg.text}
          </span>
        ) : (
          <Fragment key={idx}>{seg.text}</Fragment>
        )
      )}
    </span>
  );
}
