import {describe, expect, it} from 'vitest'
import {rootLayoutSkillCount, shouldPromptRootLayoutMigrate} from './rootLayout'

describe('shouldPromptRootLayoutMigrate', () => {
  it('prompts when unelevated and a skill still uses hub-root layout', () => {
    expect(
      shouldPromptRootLayoutMigrate({
        skills: [{rootLayout: true}, {rootLayout: false}],
        elevated: false,
        skippedThisSession: false,
      }),
    ).toBe(true)
  })

  it('does not prompt when already elevated', () => {
    expect(
      shouldPromptRootLayoutMigrate({
        skills: [{rootLayout: true}],
        elevated: true,
        skippedThisSession: false,
      }),
    ).toBe(false)
  })

  it('does not prompt after skip this session', () => {
    expect(
      shouldPromptRootLayoutMigrate({
        skills: [{rootLayout: true}],
        elevated: false,
        skippedThisSession: true,
      }),
    ).toBe(false)
  })

  it('does not prompt when no root-layout skills remain', () => {
    expect(
      shouldPromptRootLayoutMigrate({
        skills: [{}, {rootLayout: false}],
        elevated: false,
        skippedThisSession: false,
      }),
    ).toBe(false)
  })
})

describe('rootLayoutSkillCount', () => {
  it('counts only root-layout skills', () => {
    expect(rootLayoutSkillCount([{rootLayout: true}, {}, {rootLayout: true}])).toBe(2)
    expect(rootLayoutSkillCount([])).toBe(0)
  })
})
