import type {SkillI18nInfo} from '../types'

type SkillI18nLike = {
  defaultLanguage?: string | null
  languages?: string[] | null
}

/**
 * Language tags for the editor language <Select>.
 * IPC may send `languages: null` when no versions exist (unset original language).
 */
export function skillLanguageSelectValues(
  i18n: SkillI18nLike | SkillI18nInfo | null | undefined,
): string[] {
  const languages = i18n?.languages
  if (languages && languages.length > 0) return languages
  return [i18n?.defaultLanguage ?? '']
}
