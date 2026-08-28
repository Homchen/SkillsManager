export type AppView = 'skills' | 'organize' | 'editor' | 'settings' | 'usage'

export type TranslationTask = {
  active: boolean
  message: string
  tone?: 'info' | 'error' | 'success'
  sourceID?: string
  /** Target language tag for a completed/in-progress translation version. */
  targetLanguage?: string
  /** Relative path currently being translated (when phase is translating). */
  file?: string
}

export type SkillStatus =
  | 'normal'
  | 'real_copy_only'
  | 'conflict'
  | 'broken_link'
  | 'hub_only'

export type LocationKind = 'hub' | 'symlink' | 'real_copy' | 'broken_link'

export interface SkillLocation {
  toolId: string
  path: string
  kind: LocationKind
  linkTarget?: string
}

export interface SkillEntry {
  id: string
  name: string
  description?: string
  group?: string
  hubPath?: string
  status: SkillStatus
  locations: SkillLocation[]
  defaultLanguage?: string
  translationCount?: number
}

export interface SkillI18nInfo {
  defaultLanguage: string
  languages: string[]
  translationCount: number
}

export interface GroupInfo {
  id: string
}

export const DEFAULT_GROUP_ID = 'default'
export function groupDisplayName(id: string): string {
  return id === DEFAULT_GROUP_ID ? '默认' : id
}

export type SkillsLayout = 'flat' | 'grouped'

export interface ToolMapping {
  id: string
  path: string
  enabled: boolean
  isHub?: boolean
}

export const STATUS_LABELS: Record<SkillStatus, string> = {
  normal: '正常',
  real_copy_only: '仅副本',
  conflict: '冲突',
  broken_link: '断链',
  hub_only: '仅源仓',
}

export interface TrashItem {
  id: string
  name: string
  trashPath: string
  deletedAt: string
  expiresAt: string
}

export interface LinkSnapshot {
  skillIds: string[]
  savedAt: string
  count: number
}

export interface BulkLinkFailure {
  skillId?: string
  path?: string
  reason: string
}

export interface ToolBulkLinkResult {
  toolId: string
  linked: number
  removed: number
  skipped: number
  failed?: BulkLinkFailure[]
}

export interface BulkLinkResult {
  tools: ToolBulkLinkResult[]
  totals: { linked: number; removed: number; skipped: number; failed: number }
}

export interface ImportSkillItem {
  id: string
  status: 'imported' | 'skipped' | 'failed' | string
  reason?: string
}

export interface ImportSkillsResult {
  imported: number
  skipped: number
  failed: number
  items: ImportSkillItem[]
}

export interface SkillUsageItem {
  id: string
  name: string
  count: number
  lastUsedAt?: string
  daily: Record<string, number>
}

export interface SkillUsageSummary {
  skills: SkillUsageItem[]
  hasAnyRecord: boolean
}
