import {isExternalHref} from './markdownPlugins'

export type SkillHrefTarget =
  | {kind: 'local'; path: string}
  /** Sibling skill under the same hub group (`../other-skill/...`). */
  | {kind: 'skill'; skillId: string; path: string}

/** Strip query/hash and decode percent-encoding; null if empty. */
function hrefPathPart(href: string): string | null {
  const trimmed = href.trim()
  if (!trimmed) return null
  const bare = trimmed.split(/[?#]/, 1)[0]
  if (!bare) return null
  try {
    return decodeURIComponent(bare)
  } catch {
    return bare
  }
}

/**
 * Resolve a markdown href for the skill editor.
 * - local: path inside the current skill
 * - skill: `../other-skill/...` sibling skill (one level above skill root)
 * Returns null for external URLs, schemes, anchors, or deeper escapes.
 */
export function resolveSkillHref(fromFile: string, href: string): SkillHrefTarget | null {
  if (!href || isExternalHref(href)) return null
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  // mailto:, data:, javascript:, etc.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null

  const pathPart = hrefPathPart(trimmed)
  if (!pathPart) return null

  const normalized = pathPart.replace(/\\/g, '/')
  // Root-absolute `/foo` stays inside the current skill.
  if (normalized.startsWith('/')) {
    const stack = normalizeSegments(normalized.replace(/^\/+/, ''))
    if (!stack) return null
    return {kind: 'local', path: stack.join('/')}
  }

  const from = fromFile.replace(/\\/g, '/').replace(/^\/+/, '')
  const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const joined = [fromDir, normalized].filter(Boolean).join('/')

  const stack: string[] = []
  let escaped = 0
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length > 0) {
        stack.pop()
      } else {
        escaped++
      }
      continue
    }
    stack.push(part)
  }

  if (escaped === 0) {
    if (stack.length === 0) return null
    return {kind: 'local', path: stack.join('/')}
  }

  // One level above skill root → sibling skill: ../skill-id[/path]
  if (escaped === 1) {
    if (stack.length === 0) return null
    const skillId = stack[0]
    if (!skillId || skillId === '.' || skillId === '..') return null
    const path = stack.length > 1 ? stack.slice(1).join('/') : 'SKILL.md'
    return {kind: 'skill', skillId, path}
  }

  return null
}

function normalizeSegments(rel: string): string[] | null {
  const stack: string[] = []
  for (const part of rel.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.length === 0 ? null : stack
}

/**
 * Resolve a markdown href to a path inside the current skill.
 * Returns null for external / sibling / escaping links.
 */
export function resolveSkillRelativeHref(fromFile: string, href: string): string | null {
  const target = resolveSkillHref(fromFile, href)
  return target?.kind === 'local' ? target.path : null
}

/** Prefer exact match, then case-insensitive (Windows-friendly). */
export function findSkillFile(resolved: string, files: string[]): string | undefined {
  const norm = resolved.replace(/\\/g, '/')
  const exact = files.find((f) => f.replace(/\\/g, '/') === norm)
  if (exact) return exact
  const lower = norm.toLowerCase()
  return files.find((f) => f.replace(/\\/g, '/').toLowerCase() === lower)
}
