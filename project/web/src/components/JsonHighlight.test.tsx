import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { JsonHighlight, JsonTokens, tokenizeJson } from '@/components/JsonHighlight'

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

function render(el: ReactElement): string {
  return decodeHtml(renderToStaticMarkup(el))
}

describe('tokenizeJson', () => {
  it('emits a key token for object property names', () => {
    const tokens = tokenizeJson('{"a":1}')
    expect(tokens.map((t) => t.kind)).toEqual(['punct', 'key', 'punct', 'number', 'punct'])
    expect(tokens[1].text).toBe('"a"')
    expect(tokens[3].text).toBe('1')
  })

  it('treats strings inside arrays as string tokens, not keys', () => {
    const tokens = tokenizeJson('["hello","world"]')
    expect(tokens.map((t) => t.kind)).toEqual(['punct', 'string', 'punct', 'string', 'punct'])
  })

  it('colors booleans and null distinctly from numbers', () => {
    const tokens = tokenizeJson('[true,false,null,1,-2,3.5]')
    expect(tokens.map((t) => t.kind)).toEqual([
      'punct', 'boolean', 'punct', 'boolean', 'punct', 'null', 'punct',
      'number', 'punct', 'number', 'punct', 'number', 'punct',
    ])
  })

  it('preserves whitespace as its own tokens', () => {
    const tokens = tokenizeJson('{\n  "a": 1\n}')
    const whitespace = tokens.filter((t) => t.kind === 'whitespace').map((t) => t.text)
    expect(whitespace).toEqual(['\n  ', ' ', '\n'])
  })

  it('handles escaped quotes inside strings without splitting them', () => {
    const tokens = tokenizeJson(String.raw`{"a":"he said \"hi\""}`)
    const keyToken = tokens.find((t) => t.kind === 'key')
    expect(keyToken?.text).toBe('"a"')
    const valueToken = tokens.find((t) => t.kind === 'string')
    expect(valueToken?.text).toBe(String.raw`"he said \"hi\""`)
  })
})

describe('JsonTokens', () => {
  it('renders each token kind with its color class', () => {
    const html = render(<JsonTokens text='{"a":1,"b":"x","c":true,"d":null}' />)
    expect(html).toContain('class="text-sky-700 dark:text-sky-300">"a"')
    expect(html).toContain('class="text-emerald-700 dark:text-emerald-300">"x"')
    expect(html).toContain('class="text-amber-700 dark:text-amber-300">1')
    expect(html).toContain('class="text-violet-700 dark:text-violet-300">true')
    expect(html).toContain('class="text-rose-700 dark:text-rose-300">null')
    expect(html).toContain('class="text-muted-foreground">{')
  })

  it('emits whitespace as a raw text node, not a span', () => {
    const html = render(<JsonTokens text="  " />)
    expect(html).toBe('<span>  </span>')
  })
})

describe('JsonHighlight', () => {
  it('JSON-stringifies plain objects before highlighting', () => {
    const html = render(<JsonHighlight value={{ name: 'hapiy', n: 42 }} />)
    expect(html).toContain('"name"')
    expect(html).toContain('"hapiy"')
    expect(html).toContain('42')
    expect(html).toContain('text-sky-700')
    expect(html).toContain('text-amber-700')
  })

  it('returns null for empty / undefined / null values', () => {
    expect(render(<JsonHighlight value="" />)).toBe('')
    expect(render(<JsonHighlight value={undefined} />)).toBe('')
    expect(render(<JsonHighlight value={null} />)).toBe('')
  })

  it('prettifies compact JSON strings that start with { or [', () => {
    const html = render(<JsonHighlight value='{"a":1,"b":[2,3]}' />)
    expect(html).toContain('\n')
  })

  it('falls back to muted plain text for non-JSON strings', () => {
    const html = render(<JsonHighlight value="just a sentence" />)
    expect(html).toContain('<pre')
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('just a sentence')
  })

  it('keeps raw pretty-printed JSON strings as-is', () => {
    const pretty = '{\n  "a": 1\n}'
    const html = render(<JsonHighlight value={pretty} />)
    expect(html).toContain('text-sky-700')
    expect(html).toContain('1')
  })
})