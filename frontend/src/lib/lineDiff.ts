export type DiffHunk =
  | {type: 'equal'; lines: string[]}
  | {type: 'change'; a: string[]; b: string[]}

/**
 * One visual row inside a change hunk — git line-level ops only:
 * delete (−) / insert (+). No invented “modified (~)” class.
 */
export type ChangeRow =
  | {kind: 'del'; a: string}
  | {kind: 'ins'; b: string}

type Token =
  | {op: 'equal'; line: string}
  | {op: 'delete'; line: string}
  | {op: 'insert'; line: string}

type EqFn = (a: string, b: string) => boolean

/** Expand a change hunk into git-style del/ins rows (Myers edit script). */
export function changeToRows(a: string[], b: string[]): ChangeRow[] {
  if (a.length === 0 && b.length === 0) return []
  if (a.length === 0) return b.map((line) => ({kind: 'ins' as const, b: line}))
  if (b.length === 0) return a.map((line) => ({kind: 'del' as const, a: line}))

  const tokens = myersTokens(a, b, linesEqual)
  const rows: ChangeRow[] = []
  for (const t of tokens) {
    if (t.op === 'equal') continue
    if (t.op === 'delete') rows.push({kind: 'del', a: t.line})
    else rows.push({kind: 'ins', b: t.line})
  }
  return rows
}
/** Normalize newlines to `\n` so CRLF/LF do not create false conflicts. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/g, '')
}

/** Split text into lines after newline normalization. */
export function splitLines(text: string): string[] {
  const normalized = normalizeText(text)
  if (normalized === '') return []
  const parts = normalized.split('\n')
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop()
  }
  return parts
}

export function joinLines(lines: string[]): string {
  if (lines.length === 0) return ''
  return lines.join('\n')
}

/** Trailing spaces/tabs ignored when deciding whether two lines match. */
function lineKey(line: string): string {
  return line.replace(/[ \t]+$/g, '')
}

function linesEqual(a: string, b: string): boolean {
  return lineKey(a) === lineKey(b)
}

/**
 * Line-based diff aligned with git xdiff:
 * - CRLF normalized
 * - trailing-whitespace-insensitive match
 * - patience unique-line anchors, Myers between anchors
 * - shared lines extracted from replace hunks
 */
export function lineDiff(textA: string, textB: string): DiffHunk[] {
  return coalesce(diffLines(splitLines(textA), splitLines(textB)))
}

function diffLines(a: string[], b: string[]): DiffHunk[] {
  const raw = patienceTokens(a, b, linesEqual)
  return materialize(raw)
}

/* -------------------------------------------------------------------------- */
/* Patience (git xpatience.c ideas) + Myers (git xdiffi.c ideas)              */
/* -------------------------------------------------------------------------- */

/**
 * Find unique common lines as anchors (patience), grow equal ranges, recurse
 * between anchors; fall back to Myers when no unique matches remain.
 */
function patienceTokens(a: string[], b: string[], eq: EqFn): Token[] {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []
  if (n === 0) return b.map((line) => ({op: 'insert' as const, line}))
  if (m === 0) return a.map((line) => ({op: 'delete' as const, line}))

  // Trim matching prefix / suffix first (cheap common case).
  let startA = 0
  let startB = 0
  while (startA < n && startB < m && eq(a[startA], b[startB])) {
    startA++
    startB++
  }
  let endA = n
  let endB = m
  while (endA > startA && endB > startB && eq(a[endA - 1], b[endB - 1])) {
    endA--
    endB--
  }

  const prefix: Token[] = a.slice(0, startA).map((line) => ({op: 'equal' as const, line}))
  const suffix: Token[] = a.slice(endA).map((line) => ({op: 'equal' as const, line}))

  const midA = a.slice(startA, endA)
  const midB = b.slice(startB, endB)
  if (midA.length === 0 && midB.length === 0) return [...prefix, ...suffix]
  if (midA.length === 0) {
    return [
      ...prefix,
      ...midB.map((line) => ({op: 'insert' as const, line})),
      ...suffix,
    ]
  }
  if (midB.length === 0) {
    return [
      ...prefix,
      ...midA.map((line) => ({op: 'delete' as const, line})),
      ...suffix,
    ]
  }

  const anchors = findPatienceAnchors(midA, midB, eq)
  if (anchors.length === 0) {
    return [...prefix, ...myersTokens(midA, midB, eq), ...suffix]
  }

  // Grow equal ranges around anchors (git walk_common_sequence).
  const grown = growAnchorRanges(midA, midB, anchors, eq)

  const middle: Token[] = []
  let ia = 0
  let ib = 0
  for (const g of grown) {
    middle.push(...patienceTokens(midA.slice(ia, g.a0), midB.slice(ib, g.b0), eq))
    for (let k = g.a0; k < g.a1; k++) {
      middle.push({op: 'equal', line: midA[k]})
    }
    ia = g.a1
    ib = g.b1
  }
  middle.push(...patienceTokens(midA.slice(ia), midB.slice(ib), eq))
  return [...prefix, ...middle, ...suffix]
}

/** Expand each anchor to maximal equal ranges; merge overlapping/adjacent. */
function growAnchorRanges(
  a: string[],
  b: string[],
  anchors: Array<[number, number]>,
  eq: EqFn,
): Array<{a0: number; a1: number; b0: number; b1: number}> {
  const ranges = anchors.map(([ax, bx]) => {
    let a0 = ax
    let b0 = bx
    let a1 = ax + 1
    let b1 = bx + 1
    while (a0 > 0 && b0 > 0 && eq(a[a0 - 1], b[b0 - 1])) {
      a0--
      b0--
    }
    while (a1 < a.length && b1 < b.length && eq(a[a1], b[b1])) {
      a1++
      b1++
    }
    return {a0, a1, b0, b1}
  })

  // Merge overlapping / touching ranges (anchors that grew into each other).
  ranges.sort((r, s) => r.a0 - s.a0)
  const merged: typeof ranges = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.a0 <= last.a1 && r.b0 <= last.b1) {
      last.a1 = Math.max(last.a1, r.a1)
      last.b1 = Math.max(last.b1, r.b1)
    } else {
      merged.push({...r})
    }
  }
  return merged
}

/**
 * Unique lines that appear once on each side, then LIS by B index (patience).
 * Returns pairs of indices into the given slices, already grown? No — raw
 * unique matches only; equal-range growth is handled by prefix/suffix trim
 * on recursive calls.
 */
function findPatienceAnchors(
  a: string[],
  b: string[],
  eq: EqFn,
): Array<[number, number]> {
  const countA = new Map<string, number>()
  const countB = new Map<string, number>()
  const indexA = new Map<string, number>()
  const indexB = new Map<string, number>()

  for (let i = 0; i < a.length; i++) {
    const k = lineKey(a[i])
    countA.set(k, (countA.get(k) ?? 0) + 1)
    indexA.set(k, i)
  }
  for (let j = 0; j < b.length; j++) {
    const k = lineKey(b[j])
    countB.set(k, (countB.get(k) ?? 0) + 1)
    indexB.set(k, j)
  }

  // Unique matches in A order.
  const matches: Array<{a: number; b: number}> = []
  for (let i = 0; i < a.length; i++) {
    const k = lineKey(a[i])
    if ((countA.get(k) ?? 0) !== 1) continue
    if ((countB.get(k) ?? 0) !== 1) continue
    const j = indexB.get(k)
    if (j === undefined) continue
    // Defend against hash/key collisions across unequal raw lines.
    if (!eq(a[i], b[j])) continue
    matches.push({a: i, b: j})
  }
  if (matches.length === 0) return []

  // Longest increasing subsequence by b index (patience sorting).
  const lis = longestIncreasingByB(matches)
  return lis.map((m) => [m.a, m.b] as [number, number])
}

function longestIncreasingByB(
  matches: Array<{a: number; b: number}>,
): Array<{a: number; b: number}> {
  // matches already ordered by a
  const tails: number[] = [] // indices into matches for increasing b
  const prev: number[] = new Array(matches.length).fill(-1)

  for (let i = 0; i < matches.length; i++) {
    const b = matches[i].b
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (matches[tails[mid]].b < b) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    if (lo === tails.length) tails.push(i)
    else tails[lo] = i
  }

  const out: Array<{a: number; b: number}> = []
  let cur = tails.length ? tails[tails.length - 1] : -1
  while (cur >= 0) {
    out.push(matches[cur])
    cur = prev[cur]
  }
  out.reverse()
  return out
}

/**
 * Myers O(ND) shortest edit script (middle-snake style, cf. xdiffi.c).
 * Produces equal / delete / insert tokens.
 */
function myersTokens(a: string[], b: string[], eq: EqFn): Token[] {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []
  if (n === 0) return b.map((line) => ({op: 'insert' as const, line}))
  if (m === 0) return a.map((line) => ({op: 'delete' as const, line}))

  const trace = myersTrace(a, b, eq)
  return backtrackTokens(a, b, trace, eq)
}

type VSnapshot = {v: Int32Array; offset: number; d: number}

function myersTrace(a: string[], b: string[], eq: EqFn): VSnapshot[] {
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max
  const v = new Int32Array(2 * max + 1)
  v.fill(-1)
  v[offset + 1] = 0
  const trace: VSnapshot[] = []

  for (let d = 0; d <= max; d++) {
    const snap = new Int32Array(v)
    trace.push({v: snap, offset, d})
    for (let k = -d; k <= d; k += 2) {
      const kIdx = offset + k
      let x: number
      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
        x = v[kIdx + 1] // down (insert)
      } else {
        x = v[kIdx - 1] + 1 // right (delete)
      }
      let y = x - k
      while (x < n && y < m && eq(a[x], b[y])) {
        x++
        y++
      }
      v[kIdx] = x
      if (x >= n && y >= m) return trace
    }
  }
  return trace
}

function backtrackTokens(
  a: string[],
  b: string[],
  trace: VSnapshot[],
  eq: EqFn,
): Token[] {
  const n = a.length
  const m = b.length
  let x = n
  let y = m
  const edits: Array<{x: number; y: number; nx: number; ny: number}> = []

  for (let d = trace.length - 1; d >= 0; d--) {
    const {v, offset} = trace[d]
    const k = x - y
    let prevK: number
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = v[offset + prevK]
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      edits.push({x: x - 1, y: y - 1, nx: x, ny: y})
      x--
      y--
    }
    if (d === 0) break
    edits.push({x: prevX, y: prevY, nx: x, ny: y})
    x = prevX
    y = prevY
  }

  edits.reverse()
  const tokens: Token[] = []
  for (const e of edits) {
    if (e.nx === e.x + 1 && e.ny === e.y + 1) {
      // diagonal — equal (prefer a's line)
      tokens.push({op: 'equal', line: a[e.x]})
    } else if (e.nx === e.x + 1) {
      tokens.push({op: 'delete', line: a[e.x]})
    } else {
      tokens.push({op: 'insert', line: b[e.y]})
    }
  }

  // Sanity: if empty files handled above, tokens should cover. eq unused but
  // kept for API symmetry with callers.
  void eq
  return tokens
}

/**
 * Turn tokens into hunks. A delete-run followed by an insert-run becomes one
 * change hunk, but only after re-diffing those two runs so common lines are
 * pulled back out as equal (prevents “same text inside red block”).
 */
function materialize(tokens: Token[]): DiffHunk[] {
  const out: DiffHunk[] = []
  let idx = 0
  while (idx < tokens.length) {
    const t = tokens[idx]
    if (t.op === 'equal') {
      const lines: string[] = []
      while (idx < tokens.length && tokens[idx].op === 'equal') {
        lines.push(tokens[idx].line)
        idx++
      }
      out.push({type: 'equal', lines})
      continue
    }

    const deletes: string[] = []
    const inserts: string[] = []
    while (idx < tokens.length && tokens[idx].op === 'delete') {
      deletes.push(tokens[idx].line)
      idx++
    }
    while (idx < tokens.length && tokens[idx].op === 'insert') {
      inserts.push(tokens[idx].line)
      idx++
    }
    // inserts before deletes (shouldn't happen with our backtrack order, but be safe)
    while (idx < tokens.length && tokens[idx].op === 'insert' && deletes.length === 0) {
      inserts.push(tokens[idx].line)
      idx++
    }

    if (deletes.length === 0 && inserts.length === 0) continue

    if (deletes.length === 0 || inserts.length === 0) {
      out.push({type: 'change', a: deletes, b: inserts})
      continue
    }

    if (isWhitespaceOnlyReplace(deletes, inserts)) {
      out.push({type: 'equal', lines: [...deletes]})
      continue
    }

    // Re-align the two sides: shared lines become equal hunks.
    const innerTokens = myersTokens(deletes, inserts, linesEqual)
    // Avoid infinite refine: materialize inner WITHOUT another replace re-diff
    // when the inner LCS still starts with the same delete+insert covering all.
    out.push(...materializeInner(innerTokens))
  }
  return out
}

/** Like materialize but replace hunks stay as single change (already aligned). */
function materializeInner(tokens: Token[]): DiffHunk[] {
  const out: DiffHunk[] = []
  let idx = 0
  while (idx < tokens.length) {
    if (tokens[idx].op === 'equal') {
      const lines: string[] = []
      while (idx < tokens.length && tokens[idx].op === 'equal') {
        lines.push(tokens[idx].line)
        idx++
      }
      out.push({type: 'equal', lines})
      continue
    }
    const deletes: string[] = []
    const inserts: string[] = []
    while (idx < tokens.length && tokens[idx].op === 'delete') {
      deletes.push(tokens[idx].line)
      idx++
    }
    while (idx < tokens.length && tokens[idx].op === 'insert') {
      inserts.push(tokens[idx].line)
      idx++
    }
    if (deletes.length === 0 && inserts.length === 0) continue
    if (isWhitespaceOnlyReplace(deletes, inserts)) {
      out.push({type: 'equal', lines: [...deletes]})
    } else {
      out.push({type: 'change', a: deletes, b: inserts})
    }
  }
  return out
}

function isWhitespaceOnlyReplace(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length === 0) return false
  return a.every((line, i) => linesEqual(line, b[i] ?? ''))
}

function coalesce(hunks: DiffHunk[]): DiffHunk[] {
  const out: DiffHunk[] = []
  for (const h of hunks) {
    if (h.type === 'equal' && h.lines.length === 0) continue
    if (h.type === 'change' && h.a.length === 0 && h.b.length === 0) continue
    const last = out[out.length - 1]
    if (h.type === 'equal' && last?.type === 'equal') {
      last.lines.push(...h.lines)
      continue
    }
    out.push(
      h.type === 'equal'
        ? {type: 'equal', lines: [...h.lines]}
        : {type: 'change', a: [...h.a], b: [...h.b]},
    )
  }
  return out
}
