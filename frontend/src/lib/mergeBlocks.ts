import {joinLines, lineDiff, normalizeText, splitLines, type DiffHunk} from './lineDiff'

export type ConflictBlock = {
  id: string
  a: string[]
  b: string[]
  result: string[]
  resolved: boolean
}

export type EqualBlock = {
  id: string
  lines: string[]
}

export type Block =
  | ({kind: 'equal'} & EqualBlock)
  | ({kind: 'conflict'} & ConflictBlock)

export function hunksToBlocks(hunks: DiffHunk[]): Block[] {
  return hunks.map((h, idx) => {
    if (h.type === 'equal') {
      return {kind: 'equal', id: `e-${idx}`, lines: h.lines}
    }
    return {
      kind: 'conflict',
      id: `c-${idx}`,
      a: h.a,
      b: h.b,
      result: [],
      resolved: false,
    }
  })
}

export function blocksToText(blocks: Block[]): string {
  const lines: string[] = []
  for (const b of blocks) {
    if (b.kind === 'equal') lines.push(...b.lines)
    else lines.push(...b.result)
  }
  return joinLines(lines)
}

/**
 * Restore merge UI state from a previously saved result.
 * Incomplete / misaligned drafts must not be force-fitted into conflict slots —
 * that produces "all resolved" with wrong Result after remount.
 */
export function buildInitialBlocks(textA: string, textB: string, existing: string): Block[] {
  const base = hunksToBlocks(lineDiff(textA, textB))
  if (!existing) return base

  const normExisting = normalizeText(existing)
  if (normExisting === normalizeText(textA)) {
    return base.map((b) =>
      b.kind === 'equal' ? b : {...b, result: [...b.a], resolved: true},
    )
  }
  if (normExisting === normalizeText(textB)) {
    return base.map((b) =>
      b.kind === 'equal' ? b : {...b, result: [...b.b], resolved: true},
    )
  }

  const existingLines = splitLines(existing)
  let cursor = 0
  const mapped: Block[] = base.map((b) => {
    if (b.kind === 'equal') {
      cursor += b.lines.length
      return b
    }
    const sliceA = existingLines.slice(cursor, cursor + b.a.length)
    const sliceB = existingLines.slice(cursor, cursor + b.b.length)
    if (b.a.length > 0 && joinLines(sliceA) === joinLines(b.a)) {
      cursor += b.a.length
      return {...b, result: [...b.a], resolved: true}
    }
    if (b.b.length > 0 && joinLines(sliceB) === joinLines(b.b)) {
      cursor += b.b.length
      return {...b, result: [...b.b], resolved: true}
    }
    // Ambiguous leftover text: do not guess a partial slot fill.
    return {...b, result: [], resolved: false}
  })

  const allResolved = mapped.every((b) => b.kind === 'equal' || b.resolved)
  const consumedAll = cursor === existingLines.length
  if (allResolved && consumedAll && normalizeText(blocksToText(mapped)) === normExisting) {
    return mapped
  }
  return base
}
