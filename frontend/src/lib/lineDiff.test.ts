import {describe, expect, it} from 'vitest'
import {
  changeToRows,
  joinLines,
  lineDiff,
  normalizeText,
  splitLines,
  type DiffHunk,
} from './lineDiff'

function equalLines(hunks: DiffHunk[]): string[] {
  return hunks.filter((h) => h.type === 'equal').flatMap((h) => (h.type === 'equal' ? h.lines : []))
}

function changeCount(hunks: DiffHunk[]): number {
  return hunks.filter((h) => h.type === 'change').length
}

describe('normalizeText / splitLines', () => {
  it('normalizes CRLF and CR to LF', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('splits without trailing empty line from final newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([])
  })

  it('treats trailing newline-only difference as equal', () => {
    expect(normalizeText('a\nb\n')).toBe(normalizeText('a\nb'))
    expect(lineDiff('a\nb\n', 'a\nb')).toEqual([{type: 'equal', lines: ['a', 'b']}])
  })
})

describe('lineDiff', () => {
  it('identical texts produce a single equal hunk', () => {
    const text = 'one\ntwo\nthree'
    const hunks = lineDiff(text, text)
    expect(hunks).toEqual([{type: 'equal', lines: ['one', 'two', 'three']}])
  })

  it('pure insert', () => {
    const hunks = lineDiff('a\nc', 'a\nb\nc')
    expect(hunks).toEqual([
      {type: 'equal', lines: ['a']},
      {type: 'change', a: [], b: ['b']},
      {type: 'equal', lines: ['c']},
    ])
  })

  it('pure delete', () => {
    const hunks = lineDiff('a\nb\nc', 'a\nc')
    expect(hunks).toEqual([
      {type: 'equal', lines: ['a']},
      {type: 'change', a: ['b'], b: []},
      {type: 'equal', lines: ['c']},
    ])
  })

  it('middle modification', () => {
    const hunks = lineDiff('a\nold\nc', 'a\nnew\nc')
    expect(hunks).toEqual([
      {type: 'equal', lines: ['a']},
      {type: 'change', a: ['old'], b: ['new']},
      {type: 'equal', lines: ['c']},
    ])
  })

  it('trailing whitespace-only differences are equal', () => {
    const hunks = lineDiff('hello  \nworld\t', 'hello\nworld')
    expect(hunks).toEqual([{type: 'equal', lines: ['hello  ', 'world\t']}])
  })

  it('patience unique anchor splits changes on both sides', () => {
    const a = joinLines(['start', 'onlyA1', 'ANCHOR_UNIQUE', 'onlyA2', 'end'])
    const b = joinLines(['start', 'onlyB1', 'ANCHOR_UNIQUE', 'onlyB2', 'end'])
    const hunks = lineDiff(a, b)
    expect(hunks).toEqual([
      {type: 'equal', lines: ['start']},
      {type: 'change', a: ['onlyA1'], b: ['onlyB1']},
      {type: 'equal', lines: ['ANCHOR_UNIQUE']},
      {type: 'change', a: ['onlyA2'], b: ['onlyB2']},
      {type: 'equal', lines: ['end']},
    ])
  })

  it('patience LIS keeps ordered unique lines when others cross', () => {
    // UNIQUE_A/B order reverses → cannot both be anchors; block lines stay equal.
    const a = joinLines([
      'header',
      'UNIQUE_A',
      'block-line-1',
      'block-line-2',
      'UNIQUE_B',
      'footer',
    ])
    const b = joinLines([
      'header',
      'UNIQUE_B',
      'block-line-1',
      'block-line-2',
      'UNIQUE_A',
      'footer',
    ])
    const hunks = lineDiff(a, b)
    const equals = equalLines(hunks)
    expect(equals).toContain('header')
    expect(equals).toContain('footer')
    expect(equals).toContain('block-line-1')
    expect(equals).toContain('block-line-2')
    // Crossed uniques become change hunks, not one whole-file replace.
    expect(changeCount(hunks)).toBeGreaterThanOrEqual(1)
    expect(changeCount(hunks)).toBeLessThan(4)
  })

  it('large divergent middles still produce coherent hunks', () => {
    const left = joinLines(['START', ...Array.from({length: 40}, (_, i) => `L${i}`), 'END'])
    const right = joinLines(['START', ...Array.from({length: 40}, (_, i) => `R${i}`), 'END'])
    const hunks = lineDiff(left, right)
    expect(hunks[0]).toEqual({type: 'equal', lines: ['START']})
    expect(hunks[hunks.length - 1]).toEqual({type: 'equal', lines: ['END']})
    expect(changeCount(hunks)).toBeGreaterThanOrEqual(1)
  })

  it('empty vs content', () => {
    expect(lineDiff('', 'x\ny')).toEqual([{type: 'change', a: [], b: ['x', 'y']}])
    expect(lineDiff('x\ny', '')).toEqual([{type: 'change', a: ['x', 'y'], b: []}])
    expect(lineDiff('', '')).toEqual([])
  })
})

describe('changeToRows', () => {
  it('represents a line change as delete then insert (git-style)', () => {
    const rows = changeToRows(['hello world'], ['hello earth'])
    expect(rows).toEqual([
      {kind: 'del', a: 'hello world'},
      {kind: 'ins', b: 'hello earth'},
    ])
  })

  it('never invents a mod/~ row', () => {
    const rows = changeToRows(['aaa'], ['zzz'])
    expect(rows.every((r) => r.kind === 'del' || r.kind === 'ins')).toBe(true)
  })
})
