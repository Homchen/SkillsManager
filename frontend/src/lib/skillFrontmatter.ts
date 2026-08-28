/** Parse SKILL.md YAML frontmatter without a full YAML library. */

const KEY_RE = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/
const BLOCK_STYLE_RE = /^([|>])([+-])?([1-9][0-9]*)?\s*$/

function leadingSpaces(s: string): number {
  let n = 0
  for (const ch of s) {
    if (ch === ' ' || ch === '\t') n++
    else break
  }
  return n
}

function unquoteYAMLScalar(s: string): string {
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    return s.slice(1, -1)
  }
  return s
}

function joinBlockScalar(folded: boolean, content: string[]): string {
  if (!folded) return content.join('\n')
  let out = ''
  for (const line of content) {
    if (line === '') {
      if (out && !out.endsWith('\n')) out += '\n'
      out += '\n'
      continue
    }
    if (out && !out.endsWith('\n')) out += ' '
    out += line
  }
  return out
}

function readBlockScalar(
  folded: boolean,
  explicitIndent: number,
  lines: string[],
  start: number,
  keyIndent: number,
): {value: string; consumed: number} {
  let contentIndent = explicitIndent > 0 ? keyIndent + explicitIndent : 0
  const content: string[] = []
  let consumed = 0

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (trimmed === '---') break

    const indent = leadingSpaces(raw)
    const isBlank = trimmed === ''

    if (!isBlank && indent <= keyIndent) break
    if (!isBlank && contentIndent === 0) contentIndent = indent

    if (isBlank) {
      content.push('')
    } else if (contentIndent > 0 && indent < contentIndent) {
      break
    } else {
      content.push(raw.slice(contentIndent))
    }
    consumed++
  }

  return {value: joinBlockScalar(folded, content).trim(), consumed}
}

function parseYAMLScalar(
  inline: string,
  lines: string[],
  next: number,
  keyIndent: number,
): {value: string; consumed: number} {
  const trimmed = inline.trim()
  const m = trimmed.match(BLOCK_STYLE_RE)
  if (m) {
    const folded = m[1] === '>'
    const explicitIndent = m[3] ? Number(m[3]) : 0
    return readBlockScalar(folded, explicitIndent, lines, next, keyIndent)
  }
  return {value: unquoteYAMLScalar(trimmed), consumed: 0}
}

export function parseSkillFrontmatter(text: string): {
  meta: Record<string, string>
  body: string
} {
  const normalized = text.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
    return {meta: {}, body: text}
  }
  const endMatch = normalized.match(/\r?\n---\r?\n/)
  if (!endMatch || endMatch.index == null) {
    return {meta: {}, body: text}
  }
  const fenceStart = normalized.startsWith('---\r\n') ? 5 : 4
  const yaml = normalized.slice(fenceStart, endMatch.index)
  const body = normalized.slice(endMatch.index + endMatch[0].length)
  const lines = yaml.split(/\r?\n/)
  const meta: Record<string, string> = {}

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(KEY_RE)
    if (!m) continue
    const keyIndent = m[1].length
    const key = m[2]
    const {value, consumed} = parseYAMLScalar(m[3], lines, i + 1, keyIndent)
    meta[key] = value
    i += consumed
  }

  return {meta, body}
}

export function descriptionFromFrontmatter(text: string): string {
  return parseSkillFrontmatter(text).meta.description ?? ''
}
