import {describe, expect, it} from 'vitest'
import {
  ancestorDirPaths,
  buildFileTree,
  collectDirPaths,
  filterFileTree,
  parentDirPath,
} from './fileTree'

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

describe('collectDirPaths', () => {
  it('lists every directory', () => {
    const tree = buildFileTree(['examples/bar/baz.md', 'assets/a.html'])
    expect(collectDirPaths(tree).sort()).toEqual(['assets', 'examples', 'examples/bar'])
  })
})

describe('filterFileTree', () => {
  const tree = buildFileTree([
    'SKILL.md',
    'bin/archify.mjs',
    'examples/agent-run.json',
    'examples/dataflow.html',
  ])

  it('returns original tree for blank query', () => {
    expect(filterFileTree(tree, '  ')).toBe(tree)
  })

  it('keeps matching files and their ancestor dirs', () => {
    const filtered = filterFileTree(tree, 'archify')
    expect(filtered.map((n) => n.name)).toEqual(['bin'])
    expect(filtered[0].children?.map((n) => n.name)).toEqual(['archify.mjs'])
  })

  it('keeps a whole folder when the folder name matches', () => {
    const filtered = filterFileTree(tree, 'examples')
    expect(filtered.map((n) => n.name)).toEqual(['examples'])
    expect(filtered[0].children?.map((n) => n.name)).toEqual([
      'agent-run.json',
      'dataflow.html',
    ])
  })
})
