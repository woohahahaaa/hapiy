import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DateRangeFilter } from './DateRangeFilter'

describe('DateRangeFilter', () => {
  it('uses_our_date_pickers_instead_of_native_date_inputs', () => {
    const html = renderToStaticMarkup(<DateRangeFilter value={{}} onChange={() => {}} />)
    expect(html).not.toContain('type="date"')
    expect(html).toContain('开始')
    expect(html).toContain('结束')
    expect(html).toContain('今天')
  })
})
