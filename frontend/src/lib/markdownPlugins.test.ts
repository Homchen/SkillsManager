import {createElement} from 'react'
import {describe, expect, it} from 'vitest'
import {isExternalHref, textFromChildren} from './markdownPlugins'

describe('isExternalHref', () => {
  it('matches http(s) and protocol-relative URLs', () => {
    expect(isExternalHref('https://example.com')).toBe(true)
    expect(isExternalHref('http://example.com')).toBe(true)
    expect(isExternalHref('//cdn.example.com/x')).toBe(true)
  })

  it('rejects in-page, relative, and other schemes', () => {
    expect(isExternalHref('#section')).toBe(false)
    expect(isExternalHref('/docs/a')).toBe(false)
    expect(isExternalHref('docs/a.md')).toBe(false)
    expect(isExternalHref('mailto:a@b.c')).toBe(false)
    expect(isExternalHref(undefined)).toBe(false)
  })
})

describe('textFromChildren', () => {
  it('joins strings and numbers', () => {
    expect(textFromChildren(['hello', ' ', 1])).toBe('hello 1')
  })

  it('recurses into element props.children', () => {
    const nested = createElement('span', null, createElement('em', null, 'graph TD\n  A-->B'))
    expect(textFromChildren(nested)).toBe('graph TD\n  A-->B')
  })
})
