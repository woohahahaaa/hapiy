import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { DiffView } from './DiffView'

// react-dom/server escapes `"` in text content to `&quot;` (and other entities);
// newlines pass through verbatim. Decode entities so assertions can match raw JSON text.
function decodeHtml(html: string): string {
  return html
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
}

function render(diff: ReactElement): string {
  return decodeHtml(renderToStaticMarkup(diff))
}

describe('DiffView', () => {
  it('identical_bodies_render_no_diff_lines', () => {
    const html = render(<DiffView before={{ a: 1 }} after={{ a: 1 }} />)
    expect(html).not.toContain('emerald-')
    expect(html).not.toContain('rose-')
    expect(html).toContain('"a"')
    expect(html).toContain('1')
  })

  it('completely_different_renders_all_red_and_green', () => {
    const html = render(<DiffView before={{ a: 1 }} after={{ b: 2 }} />)
    expect(html).toContain('rose-')
    expect(html).toContain('emerald-')
    expect(html).toContain('"a"')
    expect(html).toContain('"b"')
    expect(html).toContain('1')
    expect(html).toContain('2')
    expect(html).toContain('{')
    expect(html).toContain('}')
  })

  it('nil_before_renders_after_as_plain', () => {
    const html = render(<DiffView before={null} after={{ a: 1 }} />)
    expect(html).not.toContain('emerald-')
    expect(html).not.toContain('rose-')
    expect(html).toContain('"a"')
    expect(html).toContain('1')
  })

  it('nil_after_renders_before_as_plain', () => {
    const html = render(<DiffView before={{ a: 1 }} after={null} />)
    expect(html).not.toContain('emerald-')
    expect(html).not.toContain('rose-')
    expect(html).toContain('"a"')
    expect(html).toContain('1')
  })

  it('both_nil_returns_empty_placeholder', () => {
    const html = render(<DiffView before={null} after={null} />)
    expect(html).toContain('（空）')
    expect(html).not.toContain('<pre')
  })

  it('string_body_renders_as_is', () => {
    const html = render(<DiffView before="hello" after="world" />)
    expect(html).toContain('hello')
    expect(html).not.toContain('{"hello"}')
    expect(html).not.toContain('"hello"')
  })

  it('json_lines_get_token_color_classes', () => {
    const html = render(<DiffView before={{ a: 1 }} after={{ a: 1 }} />)
    expect(html).toContain('"a"')
    expect(html).toContain('text-sky-700')
    expect(html).toContain('text-amber-700')
  })
})
