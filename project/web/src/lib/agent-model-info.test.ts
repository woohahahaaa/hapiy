import { describe, expect, it } from 'vitest'
import { filterValuesFor, fieldValueAt } from './agent-model-info'

describe('filterValuesFor', () => {
  it('passes everything when no whitelist is set', () => {
    expect(filterValuesFor(undefined, ['text', 'image', 'pdf'])).toEqual(['text', 'image', 'pdf'])
    expect(filterValuesFor([], ['text', 'image'])).toEqual(['text', 'image'])
  })

  it('drops literals outside the whitelist', () => {
    expect(filterValuesFor(['text', 'image', 'video', 'audio'], ['text', 'image', 'pdf'])).toEqual(['text', 'image'])
  })

  it('is case-insensitive and trims', () => {
    expect(filterValuesFor(['Text'], [' text ', 'PDF'])).toEqual([' text '])
  })

  it('keeps only allowed elements', () => {
    expect(filterValuesFor(['text'], ['pdf', 'xls'])).toEqual([])
  })
})

describe('fieldValueAt', () => {
  it('reads dotted paths', () => {
    expect(fieldValueAt({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1)
    expect(fieldValueAt({ a: { b: 2 } }, 'a.b.missing')).toBeUndefined()
    expect(fieldValueAt(null, 'a.b')).toBeUndefined()
  })
})