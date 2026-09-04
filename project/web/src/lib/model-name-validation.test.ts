import { describe, expect, it } from 'vitest'
import { getModelNameConflicts } from './model-name-validation'

describe('getModelNameConflicts', () => {
  const historical = [
    { id: 'one', model: 'deepseek-v4-flash', aliases: ['deepseek'] },
  ]

  it('detects model names matching historical aliases case-insensitively', () => {
    const conflicts = getModelNameConflicts(
      { model: 'DEEPSEEK', aliases: [] },
      historical,
      null,
    )
    expect(conflicts).toEqual([{ name: 'DEEPSEEK', source: 'history' }])
  })

  it('detects aliases matching historical model names', () => {
    const conflicts = getModelNameConflicts(
      { model: 'new-model', aliases: ['DeepSeek-V4-Flash'] },
      historical,
      null,
    )
    expect(conflicts).toEqual([{ name: 'DeepSeek-V4-Flash', source: 'history' }])
  })

  it('detects duplicate names inside the current form', () => {
    const conflicts = getModelNameConflicts(
      { model: 'new-model', aliases: ['NEW-MODEL'] },
      historical,
      null,
    )
    expect(conflicts).toEqual([{ name: 'NEW-MODEL', source: 'current' }])
  })

  it('excludes the model currently being edited from the history set', () => {
    const conflicts = getModelNameConflicts(
      { model: 'deepseek-v4-flash', aliases: ['deepseek'] },
      historical,
      'one',
    )
    expect(conflicts).toEqual([])
  })
})
