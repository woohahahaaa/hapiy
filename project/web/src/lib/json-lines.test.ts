import { describe, expect, it } from 'vitest'
import { splitJsonLines, lineCount } from './json-lines'

describe('splitJsonLines', () => {
  it('splits on hard newlines', () => {
    expect(splitJsonLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  it('keeps trailing empty lines', () => {
    expect(splitJsonLines('a\n\n')).toEqual(['a', '', ''])
  })

  it('returns a single element for text without newlines', () => {
    expect(splitJsonLines('abc')).toEqual(['abc'])
  })

  it('returns a single empty element for empty text', () => {
    expect(splitJsonLines('')).toEqual([''])
  })
})

describe('lineCount', () => {
  it('counts hard lines', () => {
    expect(lineCount('a\nb\nc')).toBe(3)
    expect(lineCount('a\n\n')).toBe(3)
  })

  it('counts empty text as one line', () => {
    expect(lineCount('')).toBe(1)
  })

  it('counts a single line without trailing newline as one', () => {
    expect(lineCount('abc')).toBe(1)
  })
})
