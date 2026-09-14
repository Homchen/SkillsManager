export type ToolBadge = {
  displayName: string
  letter: string
  gradient: string
  shadowColor: string
  accentColor: string
}

type Palette = {
  gradient: string
  shadowColor: string
  accentColor: string
}

const PALETTES: Palette[] = [
  {gradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', shadowColor: 'rgba(79, 70, 229, 0.28)', accentColor: '#4f46e5'},
  {gradient: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)', shadowColor: 'rgba(8, 145, 178, 0.28)', accentColor: '#0891b2'},
  {gradient: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', shadowColor: 'rgba(5, 150, 105, 0.28)', accentColor: '#059669'},
  {gradient: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)', shadowColor: 'rgba(217, 119, 6, 0.28)', accentColor: '#d97706'},
  {gradient: 'linear-gradient(135deg, #be123c 0%, #f43f5e 100%)', shadowColor: 'rgba(190, 18, 60, 0.28)', accentColor: '#be123c'},
  {gradient: 'linear-gradient(135deg, #475569 0%, #64748b 100%)', shadowColor: 'rgba(71, 85, 105, 0.28)', accentColor: '#475569'},
]

function normalizeToolId(id: string): string {
  return id.trim().toLowerCase()
}

/** Whole-id or hyphen/underscore/dot token match. Never substring-match. */
function idMatches(norm: string, ...candidates: string[]): boolean {
  const tokens = norm.split(/[-_.\s]+/).filter(Boolean)
  return candidates.some((candidate) => {
    const want = candidate.toLowerCase()
    return norm === want || tokens.includes(want)
  })
}

function badge(
  displayName: string,
  letter: string,
  palette: Palette,
): ToolBadge {
  return {displayName, letter, ...palette}
}

/**
 * Visual identity for a tool card. Matching is token-based so "codex" is never
 * confused with a generic "code" id just because it contains the letters "code".
 */
export function getToolBadge(id: string): ToolBadge {
  const norm = normalizeToolId(id)
  const letter = (id.trim()[0] || 'T').toUpperCase()

  if (idMatches(norm, 'cursor')) {
    return badge('Cursor', 'C', {
      gradient: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
      shadowColor: 'rgba(16, 185, 129, 0.28)',
      accentColor: '#10b981',
    })
  }
  if (idMatches(norm, 'claude')) {
    return badge('Claude Code', 'C', {
      gradient: 'linear-gradient(135deg, #d97706 0%, #f97316 100%)',
      shadowColor: 'rgba(234, 88, 12, 0.28)',
      accentColor: '#ea580c',
    })
  }
  if (idMatches(norm, 'opencode')) {
    return badge('OpenCode', 'O', {
      gradient: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
      shadowColor: 'rgba(79, 70, 229, 0.28)',
      accentColor: '#6366f1',
    })
  }
  if (idMatches(norm, 'codex')) {
    return badge('Codex', 'C', {
      gradient: 'linear-gradient(135deg, #111827 0%, #374151 100%)',
      shadowColor: 'rgba(17, 24, 39, 0.32)',
      accentColor: '#111827',
    })
  }
  if (idMatches(norm, 'trae')) {
    return badge('Trae', 'T', {
      gradient: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
      shadowColor: 'rgba(124, 58, 237, 0.28)',
      accentColor: '#7c3aed',
    })
  }
  if (idMatches(norm, 'cline', 'roo')) {
    return badge('Cline', 'C', {
      gradient: 'linear-gradient(135deg, #ea580c 0%, #fb923c 100%)',
      shadowColor: 'rgba(234, 88, 12, 0.28)',
      accentColor: '#ea580c',
    })
  }
  if (idMatches(norm, 'agents')) {
    return badge('Agents', 'A', {
      gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      shadowColor: 'rgba(99, 102, 241, 0.28)',
      accentColor: '#8b5cf6',
    })
  }
  if (idMatches(norm, 'copilot', 'github')) {
    return badge('Copilot', 'G', {
      gradient: 'linear-gradient(135deg, #1f2937 0%, #374151 100%)',
      shadowColor: 'rgba(31, 41, 55, 0.28)',
      accentColor: '#374151',
    })
  }
  if (idMatches(norm, 'aider')) {
    return badge('Aider', 'A', {
      gradient: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)',
      shadowColor: 'rgba(13, 148, 136, 0.28)',
      accentColor: '#0d9488',
    })
  }
  if (idMatches(norm, 'bolt')) {
    return badge('Bolt', 'B', {
      gradient: 'linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)',
      shadowColor: 'rgba(225, 29, 72, 0.28)',
      accentColor: '#e11d48',
    })
  }
  if (idMatches(norm, 'deepseek', 'deepseek-harness', 'dsh')) {
    return badge('DeepSeek', 'D', {
      gradient: 'linear-gradient(135deg, #4f46e5 0%, #2563eb 100%)',
      shadowColor: 'rgba(37, 99, 235, 0.28)',
      accentColor: '#2563eb',
    })
  }
  if (idMatches(norm, 'qoder')) {
    return badge('Qoder', 'Q', {
      gradient: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
      shadowColor: 'rgba(15, 118, 110, 0.28)',
      accentColor: '#0f766e',
    })
  }
  if (idMatches(norm, 'workbuddy')) {
    return badge('Workbuddy', 'W', {
      gradient: 'linear-gradient(135deg, #c2410c 0%, #fb923c 100%)',
      shadowColor: 'rgba(194, 65, 12, 0.28)',
      accentColor: '#c2410c',
    })
  }
  if (idMatches(norm, 'pi')) {
    return badge('Pi', 'P', {
      gradient: 'linear-gradient(135deg, #0e7490 0%, #22d3ee 100%)',
      shadowColor: 'rgba(14, 116, 144, 0.28)',
      accentColor: '#0e7490',
    })
  }
  if (idMatches(norm, 'omp')) {
    return badge('OMP', 'O', {
      gradient: 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)',
      shadowColor: 'rgba(21, 128, 61, 0.28)',
      accentColor: '#15803d',
    })
  }

  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  const picked = PALETTES[Math.abs(hash) % PALETTES.length]
  return badge(id.trim() || 'Tool', letter, picked)
}
