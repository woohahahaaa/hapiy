import { describe, expect, it } from 'vitest'
import {
  configFormatForPath,
  isYAMLConfigPath,
  stringifyConfigValue,
  toYAML,
} from '@/lib/agent-config-format'

describe('configFormatForPath', () => {
  it('follows the take-over file suffix', () => {
    expect(isYAMLConfigPath('~/.dsh/profiles/desktop/cordis.patch.yml')).toBe(true)
    expect(isYAMLConfigPath('C:\\Users\\x\\.dsh\\cordis.patch.YAML')).toBe(true)
    expect(isYAMLConfigPath('~/.config/opencode/opencode.json')).toBe(false)
    expect(isYAMLConfigPath(undefined)).toBe(false)
    expect(configFormatForPath('a.yml')).toBe('yaml')
    expect(configFormatForPath('a.jsonc')).toBe('json')
  })
})

describe('stringifyConfigValue', () => {
  it('keeps json snippets as pretty JSON', () => {
    expect(stringifyConfigValue({ apiKey: 'sk-1' }, 'json')).toBe('{\n  "apiKey": "sk-1"\n}')
  })

  it('renders the same value as YAML for yaml files', () => {
    expect(stringifyConfigValue({ apiKey: 'sk-1' }, 'yaml')).toBe('apiKey: sk-1')
  })

  it('passes already-serialized strings through untouched', () => {
    expect(stringifyConfigValue('provider:\n  a: 1', 'yaml')).toBe('provider:\n  a: 1')
  })

  it('renders empty values as empty text', () => {
    expect(stringifyConfigValue(null, 'yaml')).toBe('')
    expect(stringifyConfigValue(undefined, 'json')).toBe('')
  })
})

describe('toYAML', () => {
  it('mirrors the dsh provider block shape', () => {
    const yaml = toYAML({
      apiKeyEnv: 'HAPIY_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://hapiy.example.com:6060/proxy/__xgimiDSH',
      models: [
        { id: 'gpt-5.6-sol' },
        { id: 'deepseek-v4.1-flash', maxTokens: 393216, input: ['text', 'image'] },
      ],
    })
    expect(yaml).toBe(
      [
        'apiKeyEnv: HAPIY_API_KEY',
        'api: openai-completions',
        'baseURL: https://hapiy.example.com:6060/proxy/__xgimiDSH',
        'models:',
        '  - id: gpt-5.6-sol',
        '  - id: deepseek-v4.1-flash',
        '    maxTokens: 393216',
        '    input:',
        '      - text',
        '      - image',
      ].join('\n'),
    )
  })

  it('quotes ambiguous scalars so they read back as strings', () => {
    expect(toYAML({ id: 'true', n: '123', empty: '', spaced: ' x ', hash: 'a # b', colon: 'a: b' })).toBe(
      [
        'id: "true"',
        'n: "123"',
        'empty: ""',
        'spaced: " x "',
        'hash: "a # b"',
        'colon: "a: b"',
      ].join('\n'),
    )
  })

  it('keeps urls, dots and dashes as plain scalars', () => {
    expect(toYAML({ url: 'https://gw.example.com/v1', id: 'gpt-5.6-sol', proto: 'openai-messages' })).toBe(
      ['url: https://gw.example.com/v1', 'id: gpt-5.6-sol', 'proto: openai-messages'].join('\n'),
    )
  })

  it('handles booleans, numbers, null and empty containers', () => {
    expect(toYAML({ on: true, off: false, n: 0, none: null, list: [], obj: {} })).toBe(
      ['"on": true', '"off": false', 'n: 0', 'none: null', 'list: []', 'obj: {}'].join('\n'),
    )
  })

  it('indents nested objects under list items', () => {
    expect(toYAML({ models: [{ id: 'x', compat: { supportsDeveloperRole: false } }] })).toBe(
      ['models:', '  - id: x', '    compat:', '      supportsDeveloperRole: false'].join('\n'),
    )
  })
})
