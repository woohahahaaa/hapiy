"use client"

import type { JSX } from "react"
import { useTranslation } from "react-i18next"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"

const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100]

type PaginationProps = {
  limit: number
  offset: number
  total: number
  pageSizeOptions?: readonly number[]
  onOffsetChange: (offset: number) => void
  onLimitChange?: (limit: number) => void
}

export function Pagination({
  limit,
  offset,
  total,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onOffsetChange,
  onLimitChange,
}: PaginationProps): JSX.Element | null {
  const { t } = useTranslation('ui')
  if (total === 0) return null

  const hasPrev = offset > 0
  const hasNext = offset + limit < total
  const currentPage = Math.floor(offset / limit) + 1
  const pageText =
    total > 0 ? t('pagination.pageOf', { page: currentPage, total }) : ""

  const handleLimitChange = (value: string) => {
    const next = Number(value)
    if (!Number.isFinite(next) || next <= 0) return
    onLimitChange?.(next)
    onOffsetChange(0)
  }

  return (
    <div className="mt-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('pagination.perPage')}</span>
        <Select value={String(limit)} onValueChange={handleLimitChange}>
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {pageSizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{t('pagination.rows')}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {pageText || t('pagination.pageOf', { page: 1, total: 0 })}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrev}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          {t('pagination.prev')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext}
          onClick={() => onOffsetChange(offset + limit)}
        >
          {t('pagination.next')}
        </Button>
      </div>
    </div>
  )
}