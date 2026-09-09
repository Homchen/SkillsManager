import {describe, expect, it} from 'vitest'
import {fileGlyphKind} from './fileGlyph'

describe('fileGlyphKind', () => {
  it('marks directories', () => {
    expect(fileGlyphKind('examples', 'dir')).toBe('dir')
  })

  it('marks SKILL.md regardless of case or nested path', () => {
    expect(fileGlyphKind('SKILL.md')).toBe('skill')
    expect(fileGlyphKind('docs/skill.md')).toBe('skill')
  })

  it('classifies common extensions', () => {
    expect(fileGlyphKind('notes.md')).toBe('markdown')
    expect(fileGlyphKind('bin/archify.mjs')).toBe('code')
    expect(fileGlyphKind('examples/run.json')).toBe('json')
    expect(fileGlyphKind('assets/template.html')).toBe('html')
    expect(fileGlyphKind('theme.css')).toBe('style')
    expect(fileGlyphKind('config.yaml')).toBe('data')
    expect(fileGlyphKind('cover.png')).toBe('image')
    expect(fileGlyphKind('LICENSE')).toBe('file')
  })
})
