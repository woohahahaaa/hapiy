import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DatePicker } from './DatePicker'

describe('DatePicker', () => {
  it('empty_value_renders_placeholder_without_native_date_input', () => {
    const html = renderToStaticMarkup(
      <DatePicker value={undefined} onChange={() => {}} placeholder="开始" />,
    )
    expect(html).toContain('开始')
    expect(html).not.toContain('type="date"')
    expect(html).toContain('<button')
  })

  it('value_renders_localized_label_and_hides_placeholder', () => {
    const html = renderToStaticMarkup(
      <DatePicker value="2026-03-05" onChange={() => {}} placeholder="开始" />,
    )
    expect(html).toContain('2026/03/05')
    expect(html).not.toContain('开始')
    expect(html).not.toContain('type="date"')
  })
})
