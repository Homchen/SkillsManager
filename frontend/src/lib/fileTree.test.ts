import {describe, expect, it} from 'vitest'
import {ancestorDirPaths, buildFileTree, parentDirPath} from './fileTree'

describe('buildFileTree', () => {
  it('builds nested dirs with files sorted dirs-first', () => {
    const tree = buildFileTree([
      'SKILL.md',
      'examples/foo.md',
      'examples/bar/baz.md',
      'z-last.md',
    ])
    expect(tree.map((n) => n.name)).toEqual(['examples', 'SKILL.md', 'z-last.md'])
    expect(tree[0].kind).toBe('dir')
    expect(tree[0].children?.map((n) => n.name)).toEqual(['bar', 'foo.md'])
    expect(tree[0].children?.[0].children?.[0]).toMatchObject({
      name: 'baz.md',
      path: 'examples/bar/baz.md',
      kind: 'file',
    })
  })

  it('normalizes backslashes', () => {
    const tree = buildFileTree(['a\\b\\c.md'])
    expect(tree[0]).toMatchObject({name: 'a', kind: 'dir'})
    expect(tree[0].children?.[0].children?.[0].path).toBe('a/b/c.md')
  })

  it('keeps empty directory markers', () => {
    const tree = buildFileTree(['SKILL.md', 'empty/nested/'])
    expect(tree.map((n) => n.name)).toEqual(['empty', 'SKILL.md'])
    expect(tree[0]).toMatchObject({kind: 'dir', path: 'empty'})
    expect(tree[0].children?.[0]).toMatchObject({
      name: 'nested',
      path: 'empty/nested',
      kind: 'dir',
      children: [],
    })
  })
})

describe('ancestorDirPaths', () => {
  it('returns parent dirs', () => {
    expect(ancestorDirPaths('examples/bar/baz.md')).toEqual(['examples', 'examples/bar'])
    expect(ancestorDirPaths('SKILL.md')).toEqual([])
  })
})

describe('parentDirPath', () => {
  it('returns parent directory', () => {
    expect(parentDirPath('examples/bar/baz.md')).toBe('examples/bar')
    expect(parentDirPath('SKILL.md')).toBe('')
  })
})
