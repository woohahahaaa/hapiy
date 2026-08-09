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
    expect(html).toContain('"a": 1')
  })

  it('completely_different_renders_all_red_and_green', () => {
    const html = render(<DiffView before={{ a: 1 }} after={{ b: 2 }} />)
    expect(html).toContain('rose-')
    expect(html).toContain('emerald-')
    expect(html).toContain('"a": 1')
    expect(html).toContain('"b": 2')
    expect(html).toContain('{')
    expect(html).toContain('}')
  })

  it('nil_before_renders_after_as_plain', () => {
    const html = render(<DiffView before={null} after={{ a: 1 }} />)
    expect(html).not.toContain('emerald-')
    expect(html).not.toContain('rose-')
    expect(html).toContain('"a": 1')
  })

  it('nil_after_renders_before_as_plain', () => {
    const html = render(<DiffView before={{ a: 1 }} after={null} />)
    expect(html).not.toContain('emerald-')
    expect(html).not.toContain('rose-')
    expect(html).toContain('"a": 1')
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

  it('json_pretty_print_indents_two_spaces', () => {
    const html = render(<DiffView before={{ a: { b: 1 } }} after={{ a: { b: 1 } }} />)
    expect(html).toContain('"a": {')
    expect(html).toContain('"b": 1')
    // Each rendered line is wrapped in a span whose text is `prefix + ' ' + line + '\n'`,
    // so a JSON line with N leading spaces appears in HTML with N+2 leading spaces.
    // The `> {N}` regex anchors exactly N spaces after the span opening tag so a
    // wider indent (e.g. 4-space-per-level) would not match: `> {6}` requires exactly
    // 6 spaces between `>` and the next non-space char. With 2-space-per-level JSON
    // indent: level-1 `"a"` has 2 leading spaces → 4 in HTML; level-2 `"b"` has 4 → 6.
    expect(html).toMatch(/> {4}"a": {/)
    expect(html).toMatch(/> {6}"b": 1/)
    expect(html).toMatch(/> {4}}/)
    expect(html).toMatch(/> {2}}/)
  })
})
