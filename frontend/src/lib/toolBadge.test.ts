import {describe, expect, it} from 'vitest'
import {getToolBadge} from './toolBadge'

describe('getToolBadge', () => {
  it('treats Codex as Codex', () => {
    const badge = getToolBadge('codex')
    expect(badge.displayName).toBe('Codex')
    expect(badge.letter).toBe('C')
  })

  it('treats OpenCode as OpenCode', () => {
    const badge = getToolBadge('opencode')
    expect(badge.displayName).toBe('OpenCode')
    expect(badge.letter).toBe('O')
  })

  it('keeps default hub tools distinct from each other', () => {
    expect(getToolBadge('cursor').displayName).toBe('Cursor')
    expect(getToolBadge('claude').displayName).toBe('Claude Code')
    expect(getToolBadge('agents').displayName).toBe('Agents')
    expect(getToolBadge('pi').displayName).toBe('Pi')
    expect(getToolBadge('omp').displayName).toBe('OMP')
    expect(getToolBadge('deepseek-harness').displayName).toBe('DeepSeek')
    expect(getToolBadge('qoder-cn').displayName).toBe('Qoder')
    expect(getToolBadge('trae-cn').displayName).toBe('Trae')
    expect(getToolBadge('workbuddy').displayName).toBe('Workbuddy')
  })
})
