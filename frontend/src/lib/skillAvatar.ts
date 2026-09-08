const AVATAR_PALETTES = [
  {bg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', border: '#bfdbfe', text: '#1d4ed8'},
  {bg: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', border: '#bbf7d0', text: '#15803d'},
  {bg: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)', border: '#e9d5ff', text: '#7e22ce'},
  {bg: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)', border: '#fed7aa', text: '#c2410c'},
  {bg: 'linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)', border: '#a5f3fc', text: '#0e7490'},
  {bg: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)', border: '#fecdd3', text: '#be123c'},
  {bg: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', border: '#cbd5e1', text: '#334155'},
  {bg: 'linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)', border: '#fef08a', text: '#a16207'},
]

export type SkillAvatarTheme = (typeof AVATAR_PALETTES)[number] & {char: string}

export function getSkillAvatarTheme(nameOrId: string): SkillAvatarTheme {
  let hash = 0
  const clean = (nameOrId || '').trim()
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i)
    hash |= 0
  }
  const idx = Math.abs(hash) % AVATAR_PALETTES.length
  const palette = AVATAR_PALETTES[idx]
  const char = clean ? clean.charAt(0).toUpperCase() : 'S'
  return {...palette, char}
}
