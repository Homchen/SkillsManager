import {describe, expect, it} from 'vitest'
import {findSkillFile, resolveSkillHref, resolveSkillRelativeHref} from './skillRelativeHref'

describe('resolveSkillHref', () => {
  it('resolves ./ relative to SKILL.md', () => {
    expect(resolveSkillHref('SKILL.md', './references/metrics.md')).toEqual({
      kind: 'local',
      path: 'references/metrics.md',
    })
  })

  it('resolves bare relative paths', () => {
    expect(resolveSkillHref('SKILL.md', 'references/metrics.md')).toEqual({
      kind: 'local',
      path: 'references/metrics.md',
    })
  })

  it('resolves from nested files within the skill', () => {
    expect(resolveSkillHref('docs/guide.md', './setup.md')).toEqual({
      kind: 'local',
      path: 'docs/setup.md',
    })
    expect(resolveSkillHref('docs/guide.md', '../SKILL.md')).toEqual({
      kind: 'local',
      path: 'SKILL.md',
    })
  })

  it('resolves skill-root absolute paths as local', () => {
    expect(resolveSkillHref('docs/guide.md', '/references/metrics.md')).toEqual({
      kind: 'local',
      path: 'references/metrics.md',
    })
  })

  it('strips hash and query', () => {
    expect(resolveSkillHref('SKILL.md', './references/metrics.md#cpu')).toEqual({
      kind: 'local',
      path: 'references/metrics.md',
    })
    expect(resolveSkillHref('SKILL.md', './a.md?x=1')).toEqual({
      kind: 'local',
      path: 'a.md',
    })
  })

  it('resolves sibling skill links like ../lark-shared/SKILL.md', () => {
    expect(resolveSkillHref('SKILL.md', '../lark-shared/SKILL.md')).toEqual({
      kind: 'skill',
      skillId: 'lark-shared',
      path: 'SKILL.md',
    })
    expect(resolveSkillHref('SKILL.md', '../lark-shared')).toEqual({
      kind: 'skill',
      skillId: 'lark-shared',
      path: 'SKILL.md',
    })
    expect(resolveSkillHref('docs/a.md', '../../lark-shared/refs/x.md')).toEqual({
      kind: 'skill',
      skillId: 'lark-shared',
      path: 'refs/x.md',
    })
  })

  it('rejects external, schemes, anchors, and deeper escapes', () => {
    expect(resolveSkillHref('SKILL.md', 'https://example.com')).toBeNull()
    expect(resolveSkillHref('SKILL.md', 'mailto:a@b.c')).toBeNull()
    expect(resolveSkillHref('SKILL.md', '#section')).toBeNull()
    expect(resolveSkillHref('SKILL.md', '../../outside/SKILL.md')).toBeNull()
    expect(resolveSkillHref('docs/a.md', '../../../x.md')).toBeNull()
  })
})

describe('resolveSkillRelativeHref', () => {
  it('returns only local paths', () => {
    expect(resolveSkillRelativeHref('SKILL.md', './a.md')).toBe('a.md')
    expect(resolveSkillRelativeHref('SKILL.md', '../lark-shared/SKILL.md')).toBeNull()
  })
})

describe('findSkillFile', () => {
  const files = ['SKILL.md', 'references/metrics.md', 'Docs/Guide.md']

  it('returns exact match', () => {
    expect(findSkillFile('references/metrics.md', files)).toBe('references/metrics.md')
  })

  it('falls back to case-insensitive match', () => {
    expect(findSkillFile('docs/guide.md', files)).toBe('Docs/Guide.md')
  })

  it('returns undefined when missing', () => {
    expect(findSkillFile('missing.md', files)).toBeUndefined()
  })
})
