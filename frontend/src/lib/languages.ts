export type SkillLanguage = {
  value: string
  label: string
}

/** Fixed first-party language list (BCP 47 tags). */
export const SKILL_LANGUAGES: SkillLanguage[] = [
  {value: 'en', label: '英语'},
  {value: 'zh-CN', label: '简体中文'},
  {value: 'zh-TW', label: '繁体中文'},
  {value: 'ja', label: '日语'},
  {value: 'ko', label: '韩语'},
  {value: 'fr', label: '法语'},
  {value: 'de', label: '德语'},
  {value: 'es', label: '西班牙语'},
  {value: 'pt', label: '葡萄牙语'},
  {value: 'ru', label: '俄语'},
  {value: 'ar', label: '阿拉伯语'},
]

export function languageLabel(tag?: string | null): string {
  const value = (tag ?? '').trim()
  if (!value) return '未指定语言'
  return SKILL_LANGUAGES.find((lang) => lang.value === value)?.label ?? value
}
