import {describe, expect, it} from 'vitest'
import {
  CLEAR_SECRET,
  findSettingsSaveIssue,
  mapSaveConfigError,
  parseToolField,
  secretForSave,
  settingsFieldSelector,
} from './settingsSave'

const valid = {
  hubPath: 'C:\\hub',
  tools: [{id: 'cursor', path: 'C:\\cursor'}],
  trashRetentionDays: 7,
  translationEngine: 'microsoft_android',
}

describe('findSettingsSaveIssue', () => {
  it('returns null when required fields are present', () => {
    expect(findSettingsSaveIssue(valid)).toBeNull()
  })

  it('points at hubPath when source path is empty', () => {
    expect(findSettingsSaveIssue({...valid, hubPath: '  '})).toEqual({
      field: 'hubPath',
      message: '请填写源仓路径',
    })
  })

  it('points at the tool path field when a tool path is missing', () => {
    expect(
      findSettingsSaveIssue({
        ...valid,
        tools: [{id: 'cursor', path: ''}],
      }),
    ).toEqual({
      field: 'tool:0:path',
      message: '工具「cursor」缺少路径',
    })
  })

  it('points at OpenAI API key when the compatible engine has no key', () => {
    expect(
      findSettingsSaveIssue({
        ...valid,
        translationEngine: 'openai_compatible',
        openAIBaseURL: 'https://example.com/v1',
        openAIModel: 'gpt-test',
        openAIAPIKey: '',
        openAITemperature: 0.2,
      }),
    ).toEqual({
      field: 'openAIAPIKey',
      message: '请填写 OpenAI 兼容接口的 API Key',
    })
  })

  it('points at temperature when OpenAI temperature is out of range', () => {
    expect(
      findSettingsSaveIssue({
        ...valid,
        translationEngine: 'openai_compatible',
        openAIBaseURL: 'https://example.com/v1',
        openAIModel: 'gpt-test',
        openAIAPIKey: 'sk-test',
        openAITemperature: 1.5,
      }),
    ).toEqual({
      field: 'openAITemperature',
      message: '模型温度须在 0–1 之间',
    })
  })

  it('accepts temperature zero for OpenAI compatible engine', () => {
    expect(
      findSettingsSaveIssue({
        ...valid,
        translationEngine: 'openai_compatible',
        openAIBaseURL: 'https://example.com/v1',
        openAIModel: 'gpt-test',
        openAIAPIKey: 'sk-test',
        openAITemperature: 0,
      }),
    ).toBeNull()
  })

  it('points at trash retention when days are invalid', () => {
    expect(findSettingsSaveIssue({...valid, trashRetentionDays: 0})).toEqual({
      field: 'trashRetentionDays',
      message: '回收站保留天数须为正整数',
    })
  })
})

describe('settings field helpers', () => {
  it('builds a data-attribute selector', () => {
    expect(settingsFieldSelector('openAIAPIKey')).toBe('[data-settings-field="openAIAPIKey"]')
  })

  it('parses tool field ids', () => {
    expect(parseToolField('tool:2:path')).toEqual({index: 2, part: 'path'})
    expect(parseToolField('hubPath')).toBeNull()
  })

  it('maps backend hub errors to the hub field', () => {
    expect(mapSaveConfigError('创建源仓目录失败: access denied')).toMatchObject({
      field: 'hubPath',
    })
  })

  it('leaves unmapped backend errors without a field', () => {
    expect(mapSaveConfigError('磁盘已满')).toBeNull()
  })
})

describe('secretForSave', () => {
  it('keeps empty and whitespace as omit-keep sentinels', () => {
    expect(secretForSave(undefined)).toBe('')
    expect(secretForSave('')).toBe('')
    expect(secretForSave('  ')).toBe('')
  })

  it('trims a provided key', () => {
    expect(secretForSave(' sk-live ')).toBe('sk-live')
  })

  it('uses CLEAR_SECRET only when the caller explicitly clears', () => {
    expect(secretForSave('', {clear: true})).toBe(CLEAR_SECRET)
    expect(secretForSave('sk-live', {clear: true})).toBe(CLEAR_SECRET)
    expect(CLEAR_SECRET).toBe('\u0000')
  })
})
