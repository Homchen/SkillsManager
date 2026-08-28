export type SettingsSaveInput = {
  hubPath?: string
  tools?: Array<{id?: string; path?: string}>
  trashRetentionDays?: number
  translationEngine?: string
  microsoftTranslatorKey?: string
  openAIBaseURL?: string
  openAIAPIKey?: string
  openAIModel?: string
  openAITemperature?: number
}

export type SettingsFieldId =
  | 'hubPath'
  | 'microsoftTranslatorKey'
  | 'openAIBaseURL'
  | 'openAIAPIKey'
  | 'openAIModel'
  | 'openAITemperature'
  | 'translationTargetLanguage'
  | 'trashRetentionDays'
  | `tool:${number}:id`
  | `tool:${number}:path`

export type SettingsSaveIssue = {
  field: SettingsFieldId
  message: string
}

/** Matches config.ClearSecret: explicit delete of a ~/.skillsmanager/.env key. */
export const CLEAR_SECRET = '\u0000'

/** Map a password field for SaveConfig. Empty/omitted keeps the existing .env value. */
export function secretForSave(value?: string, opts?: {clear?: boolean}): string {
  if (opts?.clear) {
    return CLEAR_SECRET
  }
  return (value ?? '').trim()
}

export function normalizeTranslationEngine(engine?: string): string {
  return engine || 'microsoft_android'
}

/** Clamp AI translation temperature to the [0, 1] range. */
export function normalizeOpenAITemperature(value?: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return 0.2
  }
  return n
}

export function settingsFieldSelector(field: SettingsFieldId): string {
  return `[data-settings-field="${field}"]`
}

export function parseToolField(
  field: SettingsFieldId,
): {index: number; part: 'id' | 'path'} | null {
  const match = /^tool:(\d+):(id|path)$/.exec(field)
  if (!match) return null
  return {index: Number(match[1]), part: match[2] as 'id' | 'path'}
}

/** 保存前校验；返回第一处问题及应对齐的设置项。 */
export function findSettingsSaveIssue(cfg: SettingsSaveInput): SettingsSaveIssue | null {
  const hubPath = (cfg.hubPath ?? '').trim()
  if (!hubPath) {
    return {field: 'hubPath', message: '请填写源仓路径'}
  }

  const tools = cfg.tools ?? []
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i]
    if (!(t.id ?? '').trim()) {
      return {field: `tool:${i}:id`, message: `第 ${i + 1} 个工具缺少 ID`}
    }
    if (!(t.path ?? '').trim()) {
      return {field: `tool:${i}:path`, message: `工具「${t.id}」缺少路径`}
    }
  }

  const days = Number(cfg.trashRetentionDays)
  if (!Number.isFinite(days) || days <= 0) {
    return {field: 'trashRetentionDays', message: '回收站保留天数须为正整数'}
  }

  const engine = normalizeTranslationEngine(cfg.translationEngine)
  if (engine === 'microsoft') {
    if (!(cfg.microsoftTranslatorKey ?? '').trim()) {
      return {field: 'microsoftTranslatorKey', message: '请填写微软翻译 Subscription Key'}
    }
  }
  if (engine === 'openai_compatible') {
    if (!(cfg.openAIBaseURL ?? '').trim()) {
      return {field: 'openAIBaseURL', message: '请填写 OpenAI 兼容接口地址'}
    }
    if (!(cfg.openAIAPIKey ?? '').trim()) {
      return {field: 'openAIAPIKey', message: '请填写 OpenAI 兼容接口的 API Key'}
    }
    if (!(cfg.openAIModel ?? '').trim()) {
      return {field: 'openAIModel', message: '请填写 OpenAI 兼容接口的模型名称'}
    }
    if (cfg.openAITemperature !== undefined && cfg.openAITemperature !== null) {
      const temperature = Number(cfg.openAITemperature)
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
        return {field: 'openAITemperature', message: '模型温度须在 0–1 之间'}
      }
    }
  }

  return null
}

/** 把后端保存错误尽量对到具体设置项；对不上则只展示文案。 */
export function mapSaveConfigError(message: string): SettingsSaveIssue | null {
  if (message.includes('源仓')) {
    return {field: 'hubPath', message}
  }
  if (message.includes('语言')) {
    return {field: 'translationTargetLanguage', message}
  }
  return null
}
