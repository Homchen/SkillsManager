import type {SkillEntry} from '../types'

export type ToolPresence = 'broken' | 'linked' | 'copy' | 'none'

export function toolPresence(skill: SkillEntry, toolId: string): ToolPresence {
  let copy = false
  for (const loc of skill.locations ?? []) {
    if (loc.toolId !== toolId) continue
    if (loc.kind === 'broken_link') return 'broken'
    if (loc.kind === 'symlink') return 'linked'
    if (loc.kind === 'real_copy') copy = true
  }
  return copy ? 'copy' : 'none'
}

export function toolPresenceLabel(presence: ToolPresence, want: boolean): string {
  const currentlyOn = presence === 'linked' || presence === 'broken'
  if (want && !currentlyOn) return '将接入'
  if (!want && currentlyOn) return '将断开'
  if (presence === 'broken') return '断链'
  if (presence === 'linked') return '已链接'
  if (presence === 'copy') return '仅副本'
  return '未链接'
}

export function formatEnableDelta(add: number, remove: number): string {
  if (add === 0 && remove === 0) return '未更改'
  const parts: string[] = []
  if (add > 0) parts.push(`接入 ${add} 个`)
  if (remove > 0) parts.push(`断开 ${remove} 个`)
  return `将${parts.join('，')}`
}
