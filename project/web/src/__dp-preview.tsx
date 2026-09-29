import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import '@/i18n/i18n'
import '@/index.css'
import { DatePicker, type DatePickerProps } from '@/components/DatePicker'

function PickerRow({ label, props }: { label: string; props: Omit<DatePickerProps, 'value' | 'onChange'> }) {
  const [value, setValue] = useState<string | undefined>(undefined)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10 }}>
      <span style={{ width: 150 }}>{label}</span>
      <DatePicker {...props} aria-label={label} value={value} onChange={setValue} />
      <span style={{ fontFamily: 'monospace', color: '#999' }}>{value ?? '(empty)'}</span>
    </div>
  )
}

function Demo() {
  return (
    <div style={{ padding: 24 }}>
      <PickerRow label="只选年" props={{ precision: 'year' }} />
      <PickerRow label="只选年月" props={{ precision: 'month' }} />
      <PickerRow label="年月日" props={{}} />
      <PickerRow label="年月日时分秒" props={{ precision: 'second' }} />
      <PickerRow label="只选时分秒" props={{ precision: 'second', mode: 'time' }} />
      <PickerRow label="限定2026年" props={{ min: '2026-01-01', max: '2026-12-31' }} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Demo />)
