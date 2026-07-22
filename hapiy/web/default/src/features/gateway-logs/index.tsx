/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTableColumnHeader,
  DataTablePage,
  DataTableRow,
  useDataTable,
} from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { useMediaQuery } from '@/hooks'
import { cn } from '@/lib/utils'

import type { GatewayLogEntry } from './types'
import { MOCK_GATEWAY_LOGS } from './mock/data'

function StatusBadge(props: { status: number }) {
  if (props.status >= 200 && props.status < 300) {
    return <Badge variant='default' className='bg-emerald-600/90 text-white text-[11px] px-1.5 py-0'>{props.status}</Badge>
  }
  if (props.status >= 400 && props.status < 500) {
    return <Badge variant='destructive' className='text-[11px] px-1.5 py-0'>{props.status}</Badge>
  }
  return <Badge variant='destructive' className='bg-orange-600/90 text-white text-[11px] px-1.5 py-0'>{props.status}</Badge>
}

function MethodBadge(props: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'bg-sky-600/90 text-white',
    POST: 'bg-emerald-600/90 text-white',
    PUT: 'bg-amber-600/90 text-white',
    DELETE: 'bg-red-600/90 text-white',
  }
  return (
    <Badge variant='outline' className={cn('font-mono text-[11px] px-1.5 py-0 border-0', colors[props.method] ?? 'bg-muted text-muted-foreground')}>
      {props.method}
    </Badge>
  )
}

function useLogsColumns(): ColumnDef<GatewayLogEntry>[] {
  const { t } = useTranslation()
  return useMemo<ColumnDef<GatewayLogEntry>[]>(() => [
    {
      id: 'timestamp',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Time')} />,
      accessorKey: 'timestamp',
      enableSorting: true,
      size: 170,
    },
    {
      id: 'method',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Method')} />,
      accessorKey: 'method',
      enableSorting: false,
      size: 80,
      cell: ({ row }) => <MethodBadge method={row.original.method} />,
    },
    {
      id: 'path',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Path')} />,
      accessorKey: 'path',
      enableSorting: false,
      size: 200,
      cell: ({ row }) => (
        <span className='font-mono text-[13px] text-muted-foreground'>{row.original.path}</span>
      ),
    },
    {
      id: 'model',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Model')} />,
      accessorKey: 'model',
      enableSorting: true,
      size: 140,
    },
    {
      id: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Status')} />,
      accessorKey: 'status',
      enableSorting: true,
      size: 80,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'duration',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Duration')} />,
      accessorKey: 'duration',
      enableSorting: true,
      size: 100,
      cell: ({ row }) => (
        <span className='font-mono text-[13px]'>{row.original.duration.toFixed(1)}s</span>
      ),
    },
    {
      id: 'tokens',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Tokens')} />,
      accessorKey: 'tokens',
      enableSorting: true,
      size: 90,
      cell: ({ row }) => (
        <span className='font-mono text-[13px]'>{row.original.tokens.toLocaleString()}</span>
      ),
    },
    {
      id: 'cost',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Cost')} />,
      accessorKey: 'cost',
      enableSorting: true,
      size: 80,
    },
    {
      id: 'provider',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Provider')} />,
      accessorKey: 'provider',
      enableSorting: true,
      size: 150,
    },
    {
      id: 'token_name',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Token')} />,
      accessorKey: 'token_name',
      enableSorting: true,
      size: 120,
    },
  ], [t])
}

export function GatewayLogsPage() {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [globalFilter, setGlobalFilter] = useState('')

  const columns = useLogsColumns()
  const data = useMemo(() => MOCK_GATEWAY_LOGS, [])

  const { table } = useDataTable({
    data,
    columns,
    columnFilters: [],
    globalFilter,
    onGlobalFilterChange: setGlobalFilter,
    enableRowSelection: false,
    withFilteredRowModel: true,
    withSortedRowModel: true,
    withPaginationRowModel: true,
    initialPagination: { pageIndex: 0, pageSize: isMobile ? 10 : 20 },
  })

  return (
    <div className='min-h-[calc(100vh-3rem)] bg-muted/20 p-6'>
      <div className='mx-auto max-w-7xl'>
        <div className='mb-6'>
          <h1 className='text-2xl font-semibold'>{t('Usage Logs')}</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            {t('View request status, queue, and history')}
          </p>
        </div>

        <DataTablePage
          table={table}
          columns={columns}
          emptyTitle={t('No Logs Found')}
          emptyDescription={t('Logs will appear here once requests are made through the gateway.')}
          skeletonKeyPrefix='gateway-log-skeleton'
          applyHeaderSize
          className='bg-background rounded-xl border p-4 sm:p-6'
          fixedHeight={false}
          showPagination
          paginationInFooter={false}
          toolbarProps={{
            searchPlaceholder: t('Search logs...'),
          }}
          renderRow={(row) => (
            <DataTableRow
              key={row.id}
              row={row}
              className='transition-colors hover:bg-muted/50'
            />
          )}
        />
      </div>
    </div>
  )
}
