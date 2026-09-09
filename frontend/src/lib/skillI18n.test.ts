import {describe, expect, it} from 'vitest'
import {skillLanguageSelectValues} from './skillI18n'

describe('skillLanguageSelectValues', () => {
  it('does not throw when languages is null (unset original language)', () => {
    const i18n = {defaultLanguage: '', languages: null, translationCount: 0}
    expect(() => skillLanguageSelectValues(i18n)).not.toThrow()
    expect(skillLanguageSelectValues(i18n)).toEqual([''])
  })

  it('does not throw when languages is undefined', () => {
    expect(skillLanguageSelectValues({defaultLanguage: ''})).toEqual([''])
    expect(skillLanguageSelectValues(null)).toEqual([''])
  })

  it('uses defaultLanguage when languages is empty', () => {
    expect(
      skillLanguageSelectValues({
        defaultLanguage: 'en',
        languages: [],
        translationCount: 0,
      }),
    ).toEqual(['en'])
  })

  it('returns existing language versions', () => {
    expect(
      skillLanguageSelectValues({
        defaultLanguage: 'en',
        languages: ['en', 'zh-CN'],
        translationCount: 1,
      }),
    ).toEqual(['en', 'zh-CN'])
  })
})
