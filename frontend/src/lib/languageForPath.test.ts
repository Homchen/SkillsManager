import {describe, expect, it} from 'vitest'
import {isMarkdownPath, languageExtensionsForPath} from './languageForPath'

describe('isMarkdownPath', () => {
  it('detects md and markdown case-insensitively', () => {
    expect(isMarkdownPath('SKILL.md')).toBe(true)
    expect(isMarkdownPath('docs/A.Markdown')).toBe(true)
    expect(isMarkdownPath('a.json')).toBe(false)
    expect(isMarkdownPath(null)).toBe(false)
  })
})

describe('languageExtensionsForPath', () => {
  it('returns non-empty extensions for known languages', () => {
    expect(languageExtensionsForPath('a.md').length).toBeGreaterThan(0)
    expect(languageExtensionsForPath('a.json').length).toBeGreaterThan(0)
    expect(languageExtensionsForPath('a.yaml').length).toBeGreaterThan(0)
    expect(languageExtensionsForPath('a.yml').length).toBeGreaterThan(0)
    expect(languageExtensionsForPath('a.js').length).toBeGreaterThan(0)
    expect(languageExtensionsForPath('a.ts').length).toBeGreaterThan(0)
    expect(languageExtensionsForPath('a.tsx').length).toBeGreaterThan(0)
    expect(languageExtensionsForPath('a.py').length).toBeGreaterThan(0)
    expect(languageExtensionsForPath('a.sh').length).toBeGreaterThan(0)
  })

  it('uses yaml frontmatter support for markdown paths', () => {
    // yamlFrontmatter + heading theme（避免 --- 被当成 Setext 标题）
    expect(languageExtensionsForPath('SKILL.md').length).toBe(2)
    expect(languageExtensionsForPath('notes.markdown').length).toBe(2)
  })

  it('returns empty array for unknown or null', () => {
    expect(languageExtensionsForPath('a.txt')).toEqual([])
    expect(languageExtensionsForPath(null)).toEqual([])
  })
})
