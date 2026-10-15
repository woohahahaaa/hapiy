"use client"

import type { JSX } from "react"
import * as React from "react"
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
import { AppIcon } from '@/components/wooh/AppIcon'

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

  // 缓存恢复出来的页码可能已越界（数据变少、日志被清空）：回到最后一页，
  // 避免刷新后停在空页上。total 为 0 时不判定——首帧数据还没回来，
  // 否则刚恢复的页码会被立刻清成第一页。
  React.useEffect(() => {
    if (total > 0 && offset >= total) {
      onOffsetChange(Math.max(0, Math.floor((total - 1) / limit) * limit))
    }
  }, [offset, total, limit, onOffsetChange])

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
          <SelectContent side="top">
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
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          className="hidden lg:inline-flex"
          disabled={!hasPrev}
          aria-label={t('pagination.first')}
          onClick={() => onOffsetChange(0)}
        >
          <AppIcon name="first_page" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={!hasPrev}
          aria-label={t('pagination.prev')}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          <AppIcon name="chevron_left" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={!hasNext}
          aria-label={t('pagination.next')}
          onClick={() => onOffsetChange(offset + limit)}
        >
          <AppIcon name="chevron_right" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="hidden lg:inline-flex"
          disabled={!hasNext}
          aria-label={t('pagination.last')}
          onClick={() => onOffsetChange(Math.max(0, (Math.ceil(total / limit) - 1) * limit))}
        >
          <AppIcon name="last_page" />
        </Button>
      </div>
    </div>
  )
}