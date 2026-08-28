import {describe, expect, it} from 'vitest'
import {normalizeText, splitLines} from './lineDiff'
import {blocksToText, buildInitialBlocks} from './mergeBlocks'

describe('buildInitialBlocks', () => {
  it('starts clean when existing is empty', () => {
    const blocks = buildInitialBlocks('a\nshared\n', 'b\nshared\n', '')
    const conflicts = blocks.filter((b) => b.kind === 'conflict')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({resolved: false, result: []})
  })

  it('restores keep_b when existing equals B', () => {
    const a = 'old\nshared\n'
    const b = 'new\nshared\n'
    const blocks = buildInitialBlocks(a, b, b)
    const conflicts = blocks.filter((b) => b.kind === 'conflict')
    expect(conflicts.every((c) => c.kind === 'conflict' && c.resolved)).toBe(true)
    expect(splitLines(blocksToText(blocks))).toEqual(splitLines(b))
  })

  it('discards lossy draft that is only equal lines after clear', () => {
    // Accept then clear: blocksToText keeps equal hunks only → "shared\n"
    const a = 'left-only\nshared\ntail-a\n'
    const b = 'right-only\nshared\ntail-b\n'
    const lossyAfterClear = 'shared\n'
    const blocks = buildInitialBlocks(a, b, lossyAfterClear)
    const conflicts = blocks.filter((b) => b.kind === 'conflict')
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.every((c) => c.kind === 'conflict' && !c.resolved && c.result.length === 0)).toBe(
      true,
    )
  })

  it('discards misaligned leftover that would previously fake all-resolved', () => {
    const a = 'aaa\ncommon\nxxx\n'
    const b = 'bbb\ncommon\nyyy\n'
    // Neither side has zzz, so this must not be force-fitted into conflict slots.
    const bogus = 'bbb\ncommon\nzzz\n'
    const blocks = buildInitialBlocks(a, b, bogus)
    const conflicts = blocks.filter((c) => c.kind === 'conflict')
    const fullyResolved = conflicts.every((c) => c.kind === 'conflict' && c.resolved)
    if (fullyResolved) {
      expect(normalizeText(blocksToText(blocks))).toBe(normalizeText(bogus))
    }
    expect(fullyResolved).toBe(false)
    expect(conflicts.every((c) => c.kind === 'conflict' && c.result.length === 0)).toBe(true)
  })

  it('restores mixed keep_a / keep_b when the draft matches both slots', () => {
    const a = 'aaa\ncommon\nxxx\n'
    const b = 'bbb\ncommon\nyyy\n'
    const mixed = 'bbb\ncommon\nxxx\n'
    const blocks = buildInitialBlocks(a, b, mixed)
    const conflicts = blocks.filter((c) => c.kind === 'conflict')
    expect(conflicts).toHaveLength(2)
    expect(conflicts.every((c) => c.kind === 'conflict' && c.resolved)).toBe(true)
    expect(normalizeText(blocksToText(blocks))).toBe(normalizeText(mixed))
  })
})
