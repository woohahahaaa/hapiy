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

import { KeyRound, Plus, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { MOCK_GATEWAY_TOKENS } from './mock/data'
import type { GatewayToken } from './types'

function StatusBadge(props: { status: GatewayToken['status'] }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-600/90 text-white',
    disabled: 'bg-muted-foreground/60 text-white',
    expired: 'bg-amber-600/90 text-white',
  }
  const labels: Record<GatewayToken['status'], string> = {
    active: 'Active',
    disabled: 'Disabled',
    expired: 'Expired',
  }
  return (
    <Badge
      variant='outline'
      className={cn('border-0 text-[11px] px-2 py-0.5', styles[props.status] ?? '')}
    >
      {labels[props.status]}
    </Badge>
  )
}

function TokenForm(props: { token?: GatewayToken }) {
  const { t } = useTranslation()
  const tk = props.token

  return (
    <div className={sideDrawerFormClassName()}>
      <div className='grid gap-4'>
        <div className='grid gap-2'>
          <Label>{t('Name')}</Label>
          <Input defaultValue={tk?.name} placeholder='e.g. agent-main' />
        </div>
        <div className='grid gap-2'>
          <Label>{t('Token Value')}</Label>
          <Input
            defaultValue={tk?.value}
            placeholder='sk-gw-...'
            type='password'
            readOnly={!!tk}
          />
        </div>
        <div className='grid gap-2'>
          <Label>{t('Groups')}</Label>
          <Input defaultValue={tk?.groups.join(', ') ?? ''} placeholder='default, production' />
        </div>
      </div>
    </div>
  )
}

export function GatewayTokensPage() {
  const { t } = useTranslation()
  const [tokens] = useState<GatewayToken[]>(MOCK_GATEWAY_TOKENS)
  const [editingToken, setEditingToken] = useState<GatewayToken | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleEdit = (token: GatewayToken) => {
    setEditingToken(token)
    setDrawerOpen(true)
  }

  const handleAdd = () => {
    setEditingToken(null)
    setDrawerOpen(true)
  }

  const rows = useMemo(() => tokens, [tokens])

  return (
    <div className='min-h-[calc(100vh-3rem)] bg-muted/20 p-6'>
      <div className='mx-auto max-w-6xl'>
        <div className='mb-6 flex items-start justify-between'>
          <div className='flex gap-3'>
            <div className='rounded-xl bg-primary/10 p-3 text-primary'>
              <KeyRound className='size-6' />
            </div>
            <div>
              <h1 className='text-2xl font-semibold'>{t('API Token Management')}</h1>
              <p className='mt-1 text-sm text-muted-foreground'>
                {t('Manage downstream agent tokens for gateway access')}
              </p>
            </div>
          </div>
          <Button onClick={handleAdd}>
            <Plus className='mr-2 size-4' />{t('Add Token')}
          </Button>
        </div>

        <div className='space-y-2'>
          {rows.map((token) => (
            <button
              type='button'
              key={token.id}
              onClick={() => handleEdit(token)}
              className='flex w-full items-center justify-between rounded-xl border bg-background p-4 text-left transition hover:border-primary/50 hover:shadow-sm'
            >
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <p className='font-medium'>{token.name}</p>
                  <StatusBadge status={token.status} />
                </div>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {token.requests.toLocaleString()} requests · Last used {token.last_used}
                </p>
              </div>
              <Settings2 className='ml-3 size-4 shrink-0 text-muted-foreground' />
            </button>
          ))}
        </div>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent className={sideDrawerContentClassName('sm:max-w-md')}>
            <SheetHeader className={sideDrawerHeaderClassName()}>
              <SheetTitle>
                {editingToken ? t('Edit Token') : t('Add Token')}
              </SheetTitle>
              <SheetDescription>
                {editingToken
                  ? t('Update token configuration')
                  : t('Create a new API token for downstream agents')}
              </SheetDescription>
            </SheetHeader>

            <TokenForm token={editingToken ?? undefined} />

            <SheetFooter className={sideDrawerFooterClassName()}>
              <SheetClose>
                <Button variant='outline'>{t('Cancel')}</Button>
              </SheetClose>
              <Button>{t('Save')}</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
