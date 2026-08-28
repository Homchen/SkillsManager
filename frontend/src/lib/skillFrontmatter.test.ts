import {describe, expect, it} from 'vitest'
import {descriptionFromFrontmatter, parseSkillFrontmatter} from './skillFrontmatter'

describe('parseSkillFrontmatter', () => {
  it('parses plain single-line fields', () => {
    const {meta, body} = parseSkillFrontmatter(
      '---\nname: demo\ndescription: Use when testing\n---\n\n# Body\n',
    )
    expect(meta.name).toBe('demo')
    expect(meta.description).toBe('Use when testing')
    expect(body).toBe('\n# Body\n')
  })

  it('folds > block scalar descriptions into one line', () => {
    const {meta} = parseSkillFrontmatter(`---
name: folded
description: >
  First line of the description
  continues on the next line.
---

# Body
`)
    expect(meta.description).toBe(
      'First line of the description continues on the next line.',
    )
  })

  it('keeps | literal newlines', () => {
    const {meta} = parseSkillFrontmatter(`---
description: |
  Line one
  Line two
---

`)
    expect(meta.description).toBe('Line one\nLine two')
  })

  it('stops block scalar at the next key', () => {
    const {meta} = parseSkillFrontmatter(`---
description: >
  alpha
  beta
name: after-desc
---
`)
    expect(meta.description).toBe('alpha beta')
    expect(meta.name).toBe('after-desc')
  })

  it('descriptionFromFrontmatter reads folded scalars', () => {
    expect(
      descriptionFromFrontmatter(`---
description: >
  hello
  world
---
`),
    ).toBe('hello world')
  })
})
