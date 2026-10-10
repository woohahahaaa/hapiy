import { describe, expect, it } from 'vitest'
import { parseTheme, parseThemeRegistry } from './theme-registry'

describe('parseTheme', () => {
  it('normalizes bare HSL triplets and keeps modern color functions', () => {
    const theme = parseTheme({
      name: 'zinc',
      cssVars: {
        light: { background: '0 0% 100%', primary: 'oklch(0.5 0.1 200)' },
        dark: { background: '#000000', primary: 'hsl(210 40% 98%)' },
      },
    })
    expect(theme.light['--background']).toBe('hsl(0 0% 100%)')
    expect(theme.light['--primary']).toBe('oklch(0.5 0.1 200)')
    expect(theme.dark['--background']).toBe('#000000')
    expect(theme.dark['--primary']).toBe('hsl(210 40% 98%)')
  })

  it('merges shared theme vars into both modes', () => {
    const theme = parseTheme({
      label: 'Brand',
      cssVars: {
        theme: { radius: '0.75rem' },
        light: { primary: 'oklch(0.6 0.2 20)' },
        dark: { primary: 'oklch(0.7 0.2 20)' },
      },
    })
    expect(theme.name).toBe('Brand')
    expect(theme.light['--radius']).toBe('0.75rem')
    expect(theme.dark['--radius']).toBe('0.75rem')
  })

  it('rejects payloads without any variables', () => {
    expect(() => parseTheme({ name: 'empty' })).toThrow()
  })
})

describe('parseThemeRegistry', () => {
  it('returns an empty list for blank or malformed input', () => {
    expect(parseThemeRegistry('')).toEqual([])
    expect(parseThemeRegistry('not json')).toEqual([])
    expect(parseThemeRegistry('{"a":1}')).toEqual([])
  })

  it('skips corrupt entries and dedupes by id', () => {
    const raw = JSON.stringify([
      { name: 'Zinc', cssVars: { light: { background: '0 0% 100%' } } },
      { name: 'Broken' },
      { name: 'Zinc', cssVars: { light: { background: '0 0% 0%' } } },
    ])
    const themes = parseThemeRegistry(raw)
    expect(themes).toHaveLength(1)
    expect(themes[0].name).toBe('Zinc')
  })
})
