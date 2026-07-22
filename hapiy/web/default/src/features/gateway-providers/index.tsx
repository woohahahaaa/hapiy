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

import { Boxes, Plus, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import type { GatewayProvider } from './types'
import { MOCK_GATEWAY_PROVIDERS } from './mock/data'

function StatusBadge(props: { status: GatewayProvider['status'] }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-600/90 text-white',
    disabled: 'bg-muted-foreground/60 text-white',
    error: 'bg-destructive text-white',
  }
  const labels: Record<GatewayProvider['status'], string> = {
    active: 'Active',
    disabled: 'Disabled',
    error: 'Error',
  }
  return (
    <Badge variant='outline' className={cn('border-0 text-[11px] px-2 py-0.5', styles[props.status] ?? '')}>
      {labels[props.status]}
    </Badge>
  )
}

function ProviderForm(props: {
  provider?: GatewayProvider
}) {
  const { t } = useTranslation()
  const p = props.provider

  return (
    <div className={sideDrawerFormClassName()}>
      <div className='grid gap-4'>
        <div className='grid gap-2'>
          <Label>{t('Name')}</Label>
          <Input defaultValue={p?.name} placeholder='e.g. DeepSeek Official' />
        </div>
        <div className='grid gap-2'>
          <Label>{t('Type')}</Label>
          <Input defaultValue={p?.type} placeholder='openai / anthropic / google' />
        </div>
        <div className='grid gap-2'>
          <Label>{t('Base URLs')}</Label>
          {Array.from(
            { length: Math.max(1, p?.base_urls ?? 1) },
            (_, i) => `base-url-${i + 1}`
          ).map((fieldKey, i) => (
            <Input key={fieldKey} defaultValue={p ? `https://api${i + 1}.example.com` : ''} placeholder={`https://api${i + 1}.example.com`} />
          ))}
        </div>
        <div className='grid gap-2'>
          <Label>{t('API Keys')}</Label>
          {Array.from(
            { length: Math.max(1, p?.keys ?? 1) },
            (_, i) => `api-key-${i + 1}`
          ).map((fieldKey, i) => (
            <Input key={fieldKey} defaultValue={p ? `sk-${p.id}-key-${i + 1}` : ''} placeholder='sk-...' type='password' />
          ))}
        </div>
        <div className='grid gap-2'>
          <Label>{t('Models')}</Label>
          <Input defaultValue={p?.models.join(', ') ?? ''} placeholder='model1, model2, ...' />
        </div>
      </div>
    </div>
  )
}

export function GatewayProvidersPage() {
  const { t } = useTranslation()
  const [providers] = useState<GatewayProvider[]>(MOCK_GATEWAY_PROVIDERS)
  const [editingProvider, setEditingProvider] = useState<GatewayProvider | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleEdit = (provider: GatewayProvider) => {
    setEditingProvider(provider)
    setDrawerOpen(true)
  }

  const handleAdd = () => {
    setEditingProvider(null)
    setDrawerOpen(true)
  }

  const rows = useMemo(() => providers, [providers])

  return (
    <div className='min-h-[calc(100vh-3rem)] bg-muted/20 p-6'>
      <div className='mx-auto max-w-6xl'>
        <div className='mb-6 flex items-start justify-between'>
          <div className='flex gap-3'>
            <div className='rounded-xl bg-primary/10 p-3 text-primary'>
              <Boxes className='size-6' />
            </div>
            <div>
              <h1 className='text-2xl font-semibold'>{t('Provider Management')}</h1>
              <p className='mt-1 text-sm text-muted-foreground'>
                {t('Manage providers, base URLs and key pools')}
              </p>
            </div>
          </div>
          <Button onClick={handleAdd}>
            <Plus className='mr-2 size-4' />{t('Add Provider')}
          </Button>
        </div>

        <div className='space-y-2'>
          {rows.map((provider) => (
            <button
              type='button'
              key={provider.id}
              onClick={() => handleEdit(provider)}
              className='flex w-full items-center justify-between rounded-xl border bg-background p-4 text-left transition hover:border-primary/50 hover:shadow-sm'
            >
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <p className='font-medium'>{provider.name}</p>
                  <StatusBadge status={provider.status} />
                </div>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {provider.base_urls} Base URLs · {provider.keys} Keys · {provider.models.length} Models
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
                {editingProvider ? t('Edit Provider') : t('Add Provider')}
              </SheetTitle>
              <SheetDescription>
                {editingProvider
                  ? t('Update provider configuration')
                  : t('Configure a new provider')}
              </SheetDescription>
            </SheetHeader>

            <ProviderForm provider={editingProvider ?? undefined} />

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
