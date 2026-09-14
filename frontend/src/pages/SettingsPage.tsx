import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ExportToolSkills,
  GetConfig,
  IsElevated,
  LogsDir,
  OpenFolder,
  OpenLogsFolder,
  ReloadConfig,
  RequestElevation,
  RevealInFolder,
  SaveConfig,
  SelectDirectory,
  TranslateSkillDescription,
} from '../../wailsjs/go/main/App'
import type {config} from '../../wailsjs/go/models'
import {AppToast, useAppToast} from '../components/AppToast'
import {Select} from '../components/Select'
import {
  IconActivity,
  IconCheck,
  IconCopy,
  IconCpu,
  IconDownload,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFolderOpen,
  IconKey,
  IconLanguages,
  IconLink,
  IconLock,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconRotateCcw,
  IconSave,
  IconShield,
  IconShieldAlert,
  IconShieldCheck,
  IconSliders,
  IconSparkles,
  IconTrash,
  IconWrench,
  IconX,
} from '../components/icons'
import {SKILL_LANGUAGES} from '../lib/languages'
import {getToolBadge} from '../lib/toolBadge'
import {logClientWarn} from '../lib/clientLog'
import {
  findSettingsSaveIssue,
  mapSaveConfigError,
  normalizeOpenAITemperature,
  normalizeTranslationEngine,
  parseToolField,
  secretForSave,
  settingsFieldSelector,
  type SettingsFieldId,
  type SettingsSaveIssue,
} from '../lib/settingsSave'

type AppConfig = config.Config
type ToolMapping = config.ToolMapping

export type SettingsTabId = 'general' | 'tools' | 'translation' | 'system'

const SETTINGS_TABS: Array<{
  id: SettingsTabId
  label: string
  subtitle: string
  icon: (props: {size?: number; className?: string}) => React.JSX.Element
}> = [
  {
    id: 'general',
    label: '常规与源仓',
    subtitle: '核心源仓路径、数据安全与全局策略',
    icon: IconSliders,
  },
  {
    id: 'tools',
    label: '工具生态',
    subtitle: '配置与监控各 Agent 客户端的技能目录',
    icon: IconWrench,
  },
  {
    id: 'translation',
    label: 'AI 与翻译',
    subtitle: '翻译引擎选择、大模型接口与凭据安全',
    icon: IconLanguages,
  },
  {
    id: 'system',
    label: '系统与诊断',
    subtitle: '管理员权限管理、调试日志与重温引导',
    icon: IconShield,
  },
]

const TRANSLATION_ENGINES = [
  {
    value: 'microsoft_android',
    label: '微软翻译（移动端通道）',
    desc: '开箱即用，无需配置 API Key，稳定快捷',
    badge: '推荐',
    badgeType: 'recommend',
  },
  {
    value: 'microsoft',
    label: '微软翻译（Azure Key）',
    desc: '需 Azure 认知服务订阅密钥，企业级稳定',
    badge: '官方',
    badgeType: 'official',
  },
  {
    value: 'openai_compatible',
    label: 'AI 翻译（OpenAI 兼容）',
    desc: '支持 OpenAI、DeepSeek、Ollama 等通用端点',
    badge: 'LLM',
    badgeType: 'llm',
  },
]

function getTemperatureSemantic(temp: number) {
  if (temp <= 0.2) return {label: '严谨专注 (推荐翻译)', color: '#059669', bg: '#ecfdf5'}
  if (temp <= 0.5) return {label: '平衡适中', color: '#2563eb', bg: '#eff6ff'}
  if (temp <= 0.8) return {label: '多样通顺', color: '#7c3aed', bg: '#f5f3ff'}
  return {label: '发散创意', color: '#d97706', bg: '#fffbeb'}
}

type Props = {
  onReplayOnboarding?: () => void
}

export type SettingsPageHandle = {
  /** 若有未保存改动则提示；返回 true 表示可以离开 */
  tryLeave: () => Promise<boolean>
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function nonHubTools(tools: ToolMapping[] | undefined, hubPath?: string): ToolMapping[] {
  const hub = (hubPath ?? '').trim().toLowerCase().replace(/[\\/]+$/, '')
  return (tools ?? []).filter((t) => {
    if (t.isHub) return false
    if (!hub) return true
    const p = (t.path ?? '').trim().toLowerCase().replace(/[\\/]+$/, '')
    return p !== hub
  })
}

/** 规范化后用于比较是否有真实改动（忽略编辑态、空白差异等） */
function configSnapshot(cfg: AppConfig): string {
  return JSON.stringify({
    hubPath: (cfg.hubPath ?? '').trim(),
    trashRetentionDays: Math.floor(Number(cfg.trashRetentionDays)) || 0,
    allowPermanentDelete: Boolean(cfg.allowPermanentDelete),
    deepScanIgnoreExtra: [...(cfg.deepScanIgnoreExtra ?? [])],
    translationEngine: normalizeTranslationEngine(cfg.translationEngine),
    translationTargetLanguage: cfg.translationTargetLanguage ?? 'zh-CN',
    microsoftTranslatorKey: (cfg.microsoftTranslatorKey ?? '').trim(),
    microsoftTranslatorRegion: (cfg.microsoftTranslatorRegion ?? 'eastasia').trim(),
    openAIBaseURL: (cfg.openAIBaseURL ?? 'https://api.openai.com/v1').trim(),
    openAIAPIKey: (cfg.openAIAPIKey ?? '').trim(),
    openAIModel: (cfg.openAIModel ?? 'gpt-5.6-terra').trim(),
    openAITemperature: normalizeOpenAITemperature(cfg.openAITemperature),
    logDebug: Boolean(cfg.logDebug),
    tools: (cfg.tools ?? []).map((t) => ({
      id: (t.id ?? '').trim(),
      path: (t.path ?? '').trim(),
      enabled: Boolean(t.enabled),
    })),
  })
}

function getFieldTab(field: SettingsFieldId): SettingsTabId {
  if (field === 'hubPath' || field === 'trashRetentionDays') return 'general'
  if (field.startsWith('tool:')) return 'tools'
  if (
    field.startsWith('translation') ||
    field.startsWith('microsoft') ||
    field.startsWith('openAI')
  ) {
    return 'translation'
  }
  return 'general'
}

const SettingsPage = forwardRef<SettingsPageHandle, Props>(function SettingsPage(
  {onReplayOnboarding},
  ref,
) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general')
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [elevated, setElevated] = useState<boolean | null>(null)
  const [elevating, setElevating] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const {toast, showToast, dismissToast} = useAppToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null)
  const [exportingToolId, setExportingToolId] = useState<string | null>(null)
  const [leavePromptOpen, setLeavePromptOpen] = useState(false)
  const leaveResolverRef = useRef<((proceed: boolean) => void) | null>(null)
  const [migratePrompt, setMigratePrompt] = useState<{from: string; to: string} | null>(null)
  const migrateResolverRef = useRef<((ok: boolean) => void) | null>(null)
  const [logsDir, setLogsDir] = useState('')
  const [highlightField, setHighlightField] = useState<SettingsFieldId | null>(null)
  const [highlightTick, setHighlightTick] = useState(0)

  // 密码显示/隐藏状态
  const [showMicrosoftKey, setShowMicrosoftKey] = useState(false)
  const [showOpenAIKey, setShowOpenAIKey] = useState(false)
  // 复制反馈标记
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // 大模型/翻译端点连通性测试状态
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{
    type: 'success' | 'error'
    message: string
    latencyMs?: number
  } | null>(null)

  const dirty = useMemo(() => {
    if (!cfg || !savedSnapshot) return false
    return configSnapshot(cfg) !== savedSnapshot
  }, [cfg, savedSnapshot])

  // 各分类未保存状态判断
  const tabDirtyMap = useMemo(() => {
    if (!cfg || !savedSnapshot) return {}
    try {
      const snap = JSON.parse(savedSnapshot) as Record<string, unknown>
      const currentSnap = JSON.parse(configSnapshot(cfg)) as Record<string, unknown>

      const generalDirty =
        snap.hubPath !== currentSnap.hubPath ||
        snap.trashRetentionDays !== currentSnap.trashRetentionDays ||
        snap.allowPermanentDelete !== currentSnap.allowPermanentDelete

      const toolsDirty = JSON.stringify(snap.tools) !== JSON.stringify(currentSnap.tools)

      const translationDirty =
        snap.translationEngine !== currentSnap.translationEngine ||
        snap.translationTargetLanguage !== currentSnap.translationTargetLanguage ||
        snap.microsoftTranslatorKey !== currentSnap.microsoftTranslatorKey ||
        snap.microsoftTranslatorRegion !== currentSnap.microsoftTranslatorRegion ||
        snap.openAIBaseURL !== currentSnap.openAIBaseURL ||
        snap.openAIAPIKey !== currentSnap.openAIAPIKey ||
        snap.openAIModel !== currentSnap.openAIModel ||
        snap.openAITemperature !== currentSnap.openAITemperature

      const systemDirty = snap.logDebug !== currentSnap.logDebug

      return {
        general: generalDirty,
        tools: toolsDirty,
        translation: translationDirty,
        system: systemDirty,
      }
    } catch {
      return {}
    }
  }, [cfg, savedSnapshot])

  const applyLoadedConfig = useCallback(
    (loaded: AppConfig, elev: boolean, dir: string) => {
      const next = {
        ...loaded,
        translationEngine: normalizeTranslationEngine(loaded.translationEngine),
        microsoftTranslatorRegion: loaded.microsoftTranslatorRegion || 'eastasia',
        tools: nonHubTools(loaded.tools, loaded.hubPath).map((t) => ({...t})),
        deepScanIgnoreExtra: [...(loaded.deepScanIgnoreExtra ?? [])],
      } as AppConfig
      setCfg(next)
      setSavedSnapshot(configSnapshot(next))
      setElevated(Boolean(elev))
      setLogsDir(dir || '')
      setEditingToolIndex(null)
    },
    [],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [loaded, elev, dir] = await Promise.all([GetConfig(), IsElevated(), LogsDir()])
      applyLoadedConfig(loaded, Boolean(elev), dir || '')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [applyLoadedConfig])

  const reloadFromDisk = useCallback(async () => {
    setError('')
    setStatus('')
    try {
      const [loaded, elev, dir] = await Promise.all([ReloadConfig(), IsElevated(), LogsDir()])
      applyLoadedConfig(loaded, Boolean(elev), dir || '')
      showToast({message: '已从本地配置文件重新加载', tone: 'success'})
    } catch (e) {
      setError(errMsg(e))
    }
  }, [applyLoadedConfig, showToast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!highlightField) return
    const timer = window.setTimeout(() => {
      const node = document.querySelector<HTMLElement>(settingsFieldSelector(highlightField))
      if (!node) return
      node.scrollIntoView({behavior: 'smooth', block: 'center'})
      node.classList.remove('is-flashing')
      void node.offsetWidth
      node.classList.add('is-flashing')
      const focusable = node.querySelector<HTMLElement>('input, button, [tabindex]')
      focusable?.focus({preventScroll: true})
    }, 40)

    const clear = window.setTimeout(() => setHighlightField(null), 1800)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(clear)
    }
  }, [highlightField, highlightTick, editingToolIndex, activeTab])

  function updateTool(index: number, patch: Partial<ToolMapping>) {
    if (!cfg) return
    const tools = (cfg.tools ?? []).map((t, i) =>
      i === index ? ({...t, ...patch} as ToolMapping) : t,
    )
    setCfg({...cfg, tools} as AppConfig)
    setStatus('')
  }

  async function addTool() {
    if (!cfg) return
    setError('')
    try {
      const dir = await SelectDirectory('选择工具目录', '')
      if (!dir) return
      const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
      let base = parts[parts.length - 1] ?? ''
      if (base.toLowerCase() === 'skills' && parts.length >= 2) {
        base = parts[parts.length - 2]
      }
      const id = base.replace(/^\./, '').trim()
      const nextIndex = (cfg.tools ?? []).length
      setCfg({
        ...cfg,
        tools: [...(cfg.tools ?? []), {id, path: dir, enabled: true} as ToolMapping],
      } as AppConfig)
      setActiveTab('tools')
      setEditingToolIndex(nextIndex)
      setStatus('')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  function removeTool(index: number) {
    if (!cfg) return
    const tools = (cfg.tools ?? []).filter((_, i) => i !== index)
    setCfg({...cfg, tools} as AppConfig)
    setEditingToolIndex((cur) => {
      if (cur === null) return null
      if (cur === index) return null
      if (cur > index) return cur - 1
      return cur
    })
    setStatus('')
  }

  async function pickHubPath() {
    if (!cfg) return
    setError('')
    try {
      const dir = await SelectDirectory('选择源仓文件夹', cfg.hubPath ?? '')
      if (!dir) return
      setCfg({...cfg, hubPath: dir} as AppConfig)
      setStatus('')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function pickToolPath(index: number) {
    if (!cfg) return
    const current = cfg.tools?.[index]?.path ?? ''
    setError('')
    try {
      const dir = await SelectDirectory('选择工具目录', current)
      if (!dir) return
      updateTool(index, {path: dir})
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function openLogsFolder() {
    setError('')
    try {
      await OpenLogsFolder()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function openFolder(path: string) {
    const p = path.trim()
    if (!p) {
      setError('请先填写路径')
      return
    }
    setError('')
    try {
      await OpenFolder(p)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function copyText(text: string, key: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      await navigator.clipboard.writeText(trimmed)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      // 忽略无法复制
    }
  }

  async function exportTool(toolId: string) {
    const id = toolId.trim()
    if (!id) {
      setError('工具缺少 ID')
      return
    }
    setExportingToolId(id)
    setError('')
    setStatus('')
    try {
      const res = await ExportToolSkills(id)
      const skip = res.skipped > 0 ? `（跳过 ${res.skipped}）` : ''
      setStatus(`已导出 ${res.exported} 个 skill → ${res.zipPath}${skip}`)
      try {
        await RevealInFolder(res.zipPath)
      } catch (e) {
        setStatus(
          `已导出 ${res.exported} 个 skill → ${res.zipPath}${skip}；无法打开所在位置：${errMsg(e)}`,
        )
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setExportingToolId(null)
    }
  }

  function revealSaveIssue(issue: SettingsSaveIssue) {
    setError(issue.message)
    setStatus('')
    logClientWarn('settings save blocked', issue.message)
    const targetTab = getFieldTab(issue.field)
    setActiveTab(targetTab)
    const tool = parseToolField(issue.field)
    if (tool) setEditingToolIndex(tool.index)
    setHighlightField(issue.field)
    setHighlightTick((n) => n + 1)
  }

  function fieldClass(field: SettingsFieldId, extra = 'field') {
    return highlightField === field ? `${extra} is-flashing` : extra
  }

  async function handleSave(): Promise<boolean> {
    if (!cfg) return false
    const issue = findSettingsSaveIssue(cfg)
    if (issue) {
      revealSaveIssue(issue)
      return false
    }
    const hubPath = (cfg.hubPath ?? '').trim()
    const tools = cfg.tools ?? []
    const days = Number(cfg.trashRetentionDays)

    const prevHub = (() => {
      try {
        const parsed = JSON.parse(savedSnapshot) as {hubPath?: string}
        return (parsed.hubPath ?? '').trim()
      } catch {
        return ''
      }
    })()
    const nextHub = hubPath
    const norm = (p: string) => p.toLowerCase().replace(/[\\/]+$/, '')
    if (prevHub && nextHub && norm(prevHub) !== norm(nextHub)) {
      const ok = await new Promise<boolean>((resolve) => {
        migrateResolverRef.current = resolve
        setMigratePrompt({from: prevHub, to: nextHub})
      })
      if (!ok) {
        return false
      }
    }

    setSaving(true)
    setError('')
    setStatus('')
    try {
      const payload = {
        ...cfg,
        hubPath,
        trashRetentionDays: Math.floor(days),
        tools: tools.map((t) => ({
          id: t.id.trim(),
          path: t.path.trim(),
          enabled: Boolean(t.enabled),
        })),
        deepScanIgnoreExtra: cfg.deepScanIgnoreExtra ?? [],
        allowPermanentDelete: Boolean(cfg.allowPermanentDelete),
        translationEngine: normalizeTranslationEngine(cfg.translationEngine),
        translationTargetLanguage: cfg.translationTargetLanguage ?? 'zh-CN',
        microsoftTranslatorKey: secretForSave(cfg.microsoftTranslatorKey),
        microsoftTranslatorRegion: (cfg.microsoftTranslatorRegion ?? 'eastasia').trim(),
        openAIBaseURL: (cfg.openAIBaseURL ?? 'https://api.openai.com/v1').trim(),
        openAIAPIKey: secretForSave(cfg.openAIAPIKey),
        openAIModel: (cfg.openAIModel ?? 'gpt-5.6-terra').trim(),
        openAITemperature: normalizeOpenAITemperature(cfg.openAITemperature),
        logDebug: Boolean(cfg.logDebug),
      } as AppConfig
      await SaveConfig(payload)
      try {
        const saved = await GetConfig()
        setCfg(saved)
        setSavedSnapshot(configSnapshot(saved))
      } catch {
        setCfg(payload)
        setSavedSnapshot(configSnapshot(payload))
      }
      setEditingToolIndex(null)
      setStatus('设置已保存成功')
      return true
    } catch (e) {
      const mapped = mapSaveConfigError(errMsg(e))
      if (mapped) {
        revealSaveIssue(mapped)
      } else {
        setError(errMsg(e))
        setStatus('')
      }
      return false
    } finally {
      setSaving(false)
    }
  }

  // 测试 OpenAI 兼容端点或已选翻译引擎连通性
  async function handleTestConnection(): Promise<void> {
    if (testingConnection || !cfg) return
    setTestingConnection(true)
    setTestResult(null)
    const startTime = Date.now()
    try {
      if (dirty) {
        const saved = await handleSave()
        if (!saved) {
          setTestingConnection(false)
          return
        }
      }
      const res = await TranslateSkillDescription('Hello world')
      const elapsed = Date.now() - startTime
      setTestResult({
        type: 'success',
        message: `连通测试成功！响应: "${res.trim()}"`,
        latencyMs: elapsed,
      })
    } catch (err: unknown) {
      const elapsed = Date.now() - startTime
      const errMsg = err instanceof Error ? err.message : String(err)
      setTestResult({
        type: 'error',
        message: errMsg || '端点连接失败，请检查网络、Base URL 或 API Key',
        latencyMs: elapsed,
      })
    } finally {
      setTestingConnection(false)
    }
  }

  // 监听 Ctrl+S / Cmd+S 快捷保存
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!saving && dirty) {
          void handleSave()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saving, dirty, cfg, savedSnapshot])

  function finishLeavePrompt(proceed: boolean) {
    setLeavePromptOpen(false)
    const resolve = leaveResolverRef.current
    leaveResolverRef.current = null
    resolve?.(proceed)
  }

  function finishMigratePrompt(ok: boolean) {
    setMigratePrompt(null)
    const resolve = migrateResolverRef.current
    migrateResolverRef.current = null
    resolve?.(ok)
  }

  useImperativeHandle(
    ref,
    () => ({
      async tryLeave() {
        if (!dirty) return true
        if (leavePromptOpen) return false
        return new Promise<boolean>((resolve) => {
          leaveResolverRef.current = resolve
          setLeavePromptOpen(true)
        })
      },
    }),
    [dirty, leavePromptOpen],
  )

  if (loading) {
    return (
      <div className="settings-page settings-loading-state">
        <div className="settings-loading-card">
          <div className="settings-spinner" aria-hidden="true" />
          <p className="muted">正在加载应用配置…</p>
        </div>
      </div>
    )
  }

  if (!cfg) {
    return (
      <div className="settings-page settings-error-state">
        {error ? <div className="error-banner">{error}</div> : null}
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          <IconRefresh size={16} />
          重试加载
        </button>
      </div>
    )
  }

  const translationEngine = normalizeTranslationEngine(cfg.translationEngine)
  const usesMicrosoft = translationEngine === 'microsoft'
  const usesOpenAICompatible = translationEngine === 'openai_compatible'

  async function requestElevation() {
    setElevating(true)
    setError('')
    setStatus('')
    try {
      await RequestElevation()
      const elev = await IsElevated()
      setElevated(elev)
      setStatus(elev ? '已处于管理员模式' : '提权未完成')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setElevating(false)
    }
  }

  const currentTabMeta = SETTINGS_TABS.find((t) => t.id === activeTab) ?? SETTINGS_TABS[0]

  return (
    <div className="settings-page">
      <AppToast toast={toast} onDismiss={dismissToast} />
      {/* 迁移源仓确认弹窗 */}
      {migratePrompt ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-confirm settings-dialog-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="migrate-hub-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-dialog-header">
              <div className="settings-dialog-icon-wrap warning">
                <IconFolderOpen size={24} />
              </div>
              <h2 id="migrate-hub-title">确定迁移源仓？</h2>
            </div>
            <p className="muted dialog-confirm-body">
              将把当前源仓内所有技能与回收站完整迁移：
              <br />
              <span className="settings-path-badge">{migratePrompt.from}</span>
              <span className="settings-path-arrow">→</span>
              <span className="settings-path-badge">{migratePrompt.to}</span>
              <br />
              并将同步更新所有已挂载工具目录中的符号链接。
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                onClick={() => finishMigratePrompt(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => finishMigratePrompt(true)}
              >
                确认迁移
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 离开未保存确认弹窗 */}
      {leavePromptOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog settings-dialog-surface"
            role="dialog"
            aria-labelledby="leave-settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-dialog-header">
              <div className="settings-dialog-icon-wrap warning">
                <IconSave size={24} />
              </div>
              <h2 id="leave-settings-title">保存设置更改？</h2>
            </div>
            <p className="muted">当前页面包含未保存的配置改动。若不保存离开，这些更改将会丢失。</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => finishLeavePrompt(false)}
              >
                留在当前页
              </button>
              <button
                type="button"
                className="btn danger-subtle"
                disabled={saving}
                onClick={() => finishLeavePrompt(true)}
              >
                放弃更改
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => {
                  void (async () => {
                    const ok = await handleSave()
                    if (ok) finishLeavePrompt(true)
                  })()
                }}
              >
                {saving ? '正在保存…' : '保存并离开'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 顶部粘性全局控制栏 */}
      <header className="settings-global-header">
        <div className="settings-header-intro">
          <div className="settings-header-icon-pill">
            <currentTabMeta.icon size={18} />
          </div>
          <div className="settings-header-titles">
            <h2 className="settings-main-title">{currentTabMeta.label}</h2>
            <p className="settings-subtitle">{currentTabMeta.subtitle}</p>
          </div>
        </div>

        <div className="settings-header-actions">
          {dirty ? (
            <div className="settings-dirty-pill" title="有未保存修改，可使用快捷键 Ctrl+S 保存">
              <span className="settings-dirty-dot" aria-hidden="true" />
              <span>未保存更改</span>
              <kbd className="settings-kbd">Ctrl+S</kbd>
            </div>
          ) : (
            <span className="settings-synced-pill">
              <span className="settings-synced-icon-wrap" aria-hidden="true">
                <IconCheck size={13} />
              </span>
              <span>配置已同步</span>
            </span>
          )}

          <button
            type="button"
            className="btn btn-ghost settings-reload-btn"
            title="从 settings.json 重新加载，并更新程序正在使用的配置"
            onClick={() => void reloadFromDisk()}
          >
            <IconRotateCcw size={15} />
            <span>重载</span>
          </button>

          <button
            type="button"
            className={`btn btn-primary settings-save-btn ${dirty ? 'is-dirty' : ''}`}
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
          >
            <IconSave size={15} />
            <span>{saving ? '保存中…' : '保存设置'}</span>
          </button>
        </div>
      </header>

      {/* 状态消息与错误横幅 */}
      {error ? (
        <div className="error-banner settings-banner-notice" role="alert">
          <IconShieldAlert size={18} />
          <span>{error}</span>
          <button
            type="button"
            className="settings-banner-close"
            onClick={() => setError('')}
            aria-label="关闭"
          >
            <IconX size={15} />
          </button>
        </div>
      ) : null}

      {status ? (
        <div className="settings-status-banner" role="status">
          <IconCheck size={16} />
          <span>{status}</span>
        </div>
      ) : null}

      {/* 主双栏架构：左侧分类导航 + 右侧设置内容 */}
      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="设置分类">
          <nav className="settings-nav-group">
            {SETTINGS_TABS.map((tab) => {
              const TabIcon = tab.icon
              const isCurrent = activeTab === tab.id
              const hasUnsaved = Boolean(tabDirtyMap[tab.id])
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`settings-nav-item ${isCurrent ? 'is-active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="settings-nav-indicator" aria-hidden="true" />
                  <span className="settings-nav-icon">
                    <TabIcon size={18} />
                  </span>
                  <span className="settings-nav-label">{tab.label}</span>
                  {hasUnsaved ? (
                    <span
                      className="settings-nav-dirty-badge"
                      title="该分类下有未保存修改"
                      aria-label="有未保存修改"
                    />
                  ) : null}
                </button>
              )
            })}
          </nav>

          {/* 侧栏底部状态胶囊 */}
          <div className="settings-sidebar-footer">
            <div className="settings-priv-mini-card">
              <div className="settings-priv-dot-wrapper">
                <span className={`settings-priv-dot ${elevated ? 'is-ok' : 'is-warn'}`} />
              </div>
              <div className="settings-priv-mini-text">
                <span className="settings-priv-mini-title">
                  {elevated ? '管理员模式' : '普通用户权限'}
                </span>
                <span className="settings-priv-mini-sub">
                  {elevated ? '软链接已就绪' : '整理功能受限'}
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* 右侧主设置面板内容 */}
        <main className="settings-content">
          {/* TAB 1: 常规与源仓 */}
          {activeTab === 'general' ? (
            <div className="settings-section-container">
              {/* 源仓路径核心配置 */}
              <div className="settings-card featured">
                <div className="settings-card-head">
                  <div className="settings-card-icon-pill">
                    <IconFolderOpen size={20} />
                  </div>
                  <div>
                    <h3 className="settings-card-title">技能源仓（Hub）</h3>
                    <p className="settings-card-desc">
                      SkillsManager 集中存放所有 Skill 的核心仓库。各 Agent 工具将通过符号链接直接挂载此目录。
                    </p>
                  </div>
                </div>

                <div
                  className={fieldClass('hubPath', 'settings-field-box')}
                  data-settings-field="hubPath"
                >
                  <label className="settings-field-label" htmlFor="settings-hub-path">
                    源仓存储绝对路径
                  </label>
                  <div className="settings-path-input-group">
                    <input
                      id="settings-hub-path"
                      className="settings-text-input"
                      value={cfg.hubPath ?? ''}
                      onChange={(e) => {
                        setCfg({...cfg, hubPath: e.target.value} as AppConfig)
                        setStatus('')
                      }}
                      placeholder="%USERPROFILE%\.skillsmanager\skills"
                    />
                    <button
                      type="button"
                      className="btn"
                      title="复制路径到剪贴板"
                      onClick={() => void copyText(cfg.hubPath ?? '', 'hubPath')}
                    >
                      {copiedKey === 'hubPath' ? (
                        <>
                          <IconCheck size={15} />
                          <span>已复制</span>
                        </>
                      ) : (
                        <>
                          <IconCopy size={15} />
                          <span>复制</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      title="打开文件夹浏览窗口"
                      onClick={() => void pickHubPath()}
                    >
                      <IconFolderOpen size={15} />
                      <span>浏览…</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      title="在系统资源管理器中打开此文件夹"
                      disabled={!(cfg.hubPath ?? '').trim()}
                      onClick={() => void openFolder(cfg.hubPath ?? '')}
                    >
                      <IconExternalLink size={15} />
                      <span>打开</span>
                    </button>
                  </div>
                  <div className="settings-field-hint">
                    默认推荐路径为 <code>%USERPROFILE%\.skillsmanager\skills</code>。修改后保存将提示迁移现有技能。
                  </div>
                </div>
              </div>

              {/* 回收站保留策略 */}
              <div className="settings-card">
                <div className="settings-card-head">
                  <div className="settings-card-icon-pill">
                    <IconTrash size={20} />
                  </div>
                  <div>
                    <h3 className="settings-card-title">回收站与清理策略</h3>
                    <p className="settings-card-desc">
                      在应用内删除的技能会安全移入源仓回收站（hub/_trash），保留期限内可随时一键恢复。
                    </p>
                  </div>
                </div>

                <div
                  className={fieldClass('trashRetentionDays', 'settings-field-box')}
                  data-settings-field="trashRetentionDays"
                >
                  <label className="settings-field-label" htmlFor="settings-trash-days">
                    回收站保留天数
                  </label>
                  <div className="settings-input-with-presets">
                    <input
                      id="settings-trash-days"
                      type="number"
                      min={1}
                      max={365}
                      step={1}
                      className="settings-text-input narrow"
                      value={cfg.trashRetentionDays ?? 7}
                      onChange={(e) => {
                        setCfg({
                          ...cfg,
                          trashRetentionDays: Number(e.target.value),
                        } as AppConfig)
                        setStatus('')
                      }}
                    />
                    <span className="settings-unit-text">天</span>

                    <div className="settings-preset-chips">
                      {[7, 14, 30, 90].map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`settings-chip ${(cfg.trashRetentionDays ?? 7) === d ? 'is-active' : ''}`}
                          onClick={() => {
                            setCfg({...cfg, trashRetentionDays: d} as AppConfig)
                            setStatus('')
                          }}
                        >
                          {d} 天
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-field-hint">
                    超过设定天数的文件会在源仓扫描时自动清理；若需长期归档建议放入未开启链接的分组。
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB 2: 工具生态 */}
          {activeTab === 'tools' ? (
            <div className="settings-section-container">
              <div className="settings-card">
                <div className="settings-card-head with-action">
                  <div className="settings-card-head-left">
                    <div className="settings-card-icon-pill">
                      <IconWrench size={20} />
                    </div>
                    <div>
                      <h3 className="settings-card-title">已挂载的 Agent 工具</h3>
                      <p className="settings-card-desc">
                        配置 Cursor、Claude Code、Codex 等 Agent 编程工具的技能存储目录。源仓整理时将把其中的技能软链挂载到此处。
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary settings-add-tool-btn"
                    onClick={() => void addTool()}
                  >
                    <IconPlus size={16} />
                    <span>添加工具</span>
                  </button>
                </div>

                {(cfg.tools ?? []).length === 0 ? (
                  <div className="settings-empty-tools">
                    <div className="settings-empty-icon-wrap">
                      <IconWrench size={32} />
                    </div>
                    <h4>暂无挂载的工具目录</h4>
                    <p className="muted">
                      点击右上角「添加工具」选择本地 Agent（如 .cursor/skills 或 .claude/skills）目录。
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void addTool()}
                    >
                      <IconPlus size={15} />
                      选择工具目录
                    </button>
                  </div>
                ) : (
                  <div className="settings-tools-grid">
                    {(cfg.tools ?? []).map((tool, index) => {
                      const editing = editingToolIndex === index
                      const badge = getToolBadge(tool.id)
                      const copyId = `tool-path-${index}`
                      return (
                        <div
                          key={index}
                          className={`settings-tool-card ${editing ? 'is-editing' : ''}`}
                        >
                          {/* 正常浏览卡片 */}
                          {!editing ? (
                            <div className="settings-tool-view-mode">
                              <div className="settings-tool-header">
                                <div className="settings-tool-identity">
                                  <span
                                    className="settings-tool-avatar"
                                    style={{
                                      background: badge.gradient,
                                      color: '#ffffff',
                                      boxShadow: `0 2px 8px ${badge.shadowColor}`,
                                    }}
                                    title={badge.displayName}
                                    aria-hidden="true"
                                  >
                                    {badge.letter}
                                  </span>
                                  <div className="settings-tool-meta">
                                    <div className="settings-tool-name-row">
                                      <strong className="settings-tool-name">
                                        {tool.id || '（未命名工具）'}
                                      </strong>
                                      <span
                                        className={`settings-tool-badge ${tool.enabled ? 'enabled' : 'disabled'}`}
                                      >
                                        <span className="settings-badge-dot" aria-hidden="true" />
                                        <span>{tool.enabled ? '已启用挂载' : '未挂载'}</span>
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="settings-tool-quick-switch">
                                  <label
                                    className="settings-switch-label"
                                    title={tool.enabled ? '点击禁用该工具挂载' : '点击启用该工具挂载'}
                                  >
                                    <span className="switch">
                                      <input
                                        type="checkbox"
                                        role="switch"
                                        checked={Boolean(tool.enabled)}
                                        aria-checked={Boolean(tool.enabled)}
                                        onChange={(e) =>
                                          updateTool(index, {enabled: e.target.checked})
                                        }
                                      />
                                      <span className="switch-ui" aria-hidden="true" />
                                    </span>
                                  </label>
                                </div>
                              </div>

                              {/* 专属的路径展示胶囊栏 */}
                              <div className="settings-tool-path-bar">
                                <div
                                  className="settings-tool-path-content"
                                  title={tool.path || '未配置路径'}
                                >
                                  <IconFolderOpen size={14} className="settings-path-icon" />
                                  <span className="settings-tool-path-text">
                                    {tool.path || '（未设置绝对路径）'}
                                  </span>
                                </div>
                                <div className="settings-tool-path-actions">
                                  <button
                                    type="button"
                                    className="settings-path-action-btn"
                                    title={copiedKey === copyId ? '已复制绝对路径' : '复制绝对路径'}
                                    onClick={() => void copyText(tool.path, copyId)}
                                  >
                                    {copiedKey === copyId ? (
                                      <>
                                        <IconCheck size={13} className="text-success" />
                                        <span className="settings-path-btn-text">已复制</span>
                                      </>
                                    ) : (
                                      <>
                                        <IconCopy size={13} />
                                        <span className="settings-path-btn-text">复制</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="settings-path-action-btn"
                                    title="在系统资源管理器中打开此目录"
                                    disabled={!tool.path.trim()}
                                    onClick={() => void openFolder(tool.path)}
                                  >
                                    <IconExternalLink size={13} />
                                    <span className="settings-path-btn-text">打开</span>
                                  </button>
                                </div>
                              </div>

                              {/* 底部操作栏 */}
                              <div className="settings-tool-footer-actions">
                                <div className="settings-tool-sub-actions">
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm settings-backup-btn"
                                    title="将该工具所有 Skill 导出为 Zip 备份"
                                    disabled={!tool.id.trim() || exportingToolId !== null}
                                    onClick={() => void exportTool(tool.id)}
                                  >
                                    <IconDownload size={14} />
                                    <span>
                                      {exportingToolId === tool.id ? '导出中…' : '备份 Zip'}
                                    </span>
                                  </button>
                                </div>

                                <div className="settings-tool-main-actions">
                                  <button
                                    type="button"
                                    className="btn btn-sm settings-edit-btn"
                                    onClick={() => setEditingToolIndex(index)}
                                  >
                                    <IconPencil size={13} />
                                    <span>编辑</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm settings-delete-btn"
                                    title="从列表中移除该工具映射"
                                    onClick={() => removeTool(index)}
                                  >
                                    <IconTrash size={13} />
                                    <span>删除</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* 编辑模式 */
                            <div className="settings-tool-edit-mode">
                              <div className="settings-tool-edit-header">
                                <div className="settings-tool-edit-title-group">
                                  <span
                                    className="settings-tool-avatar sm"
                                    style={{
                                      background: badge.gradient,
                                      color: '#ffffff',
                                    }}
                                    aria-hidden="true"
                                  >
                                    {badge.letter}
                                  </span>
                                  <div>
                                    <h4>编辑工具映射 (#{index + 1})</h4>
                                    <span className="settings-field-hint">
                                      修改工具标识与本地技能存放目录
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="settings-tool-edit-fields">
                                <label
                                  className={fieldClass(`tool:${index}:id`, 'settings-field-box')}
                                  data-settings-field={`tool:${index}:id`}
                                >
                                  <span className="settings-field-label">工具唯一 ID</span>
                                  <input
                                    className="settings-text-input"
                                    value={tool.id}
                                    onChange={(e) => updateTool(index, {id: e.target.value})}
                                    placeholder="例如 cursor, claude, opencode, codex"
                                    autoFocus
                                  />
                                </label>

                                <label
                                  className={fieldClass(`tool:${index}:path`, 'settings-field-box')}
                                  data-settings-field={`tool:${index}:path`}
                                >
                                  <span className="settings-field-label">工具技能绝对路径</span>
                                  <div className="settings-path-input-group">
                                    <input
                                      className="settings-text-input"
                                      value={tool.path}
                                      onChange={(e) =>
                                        updateTool(index, {path: e.target.value})
                                      }
                                      placeholder="例如 C:\Users\Admin\.cursor\skills"
                                    />
                                    <button
                                      type="button"
                                      className="btn"
                                      onClick={() => void pickToolPath(index)}
                                    >
                                      <IconFolderOpen size={15} />
                                      <span>浏览…</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-ghost"
                                      disabled={!tool.path.trim()}
                                      onClick={() => void openFolder(tool.path)}
                                    >
                                      <IconExternalLink size={15} />
                                      <span>打开</span>
                                    </button>
                                  </div>
                                </label>
                              </div>

                              <div className="settings-tool-edit-actions">
                                <label className="check-field">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(tool.enabled)}
                                    onChange={(e) =>
                                      updateTool(index, {enabled: e.target.checked})
                                    }
                                  />
                                  <span>启用此工具挂载</span>
                                </label>

                                <div className="settings-tool-edit-btns">
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setEditingToolIndex(null)}
                                  >
                                    <span>取消</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => setEditingToolIndex(null)}
                                  >
                                    <IconCheck size={14} />
                                    <span>完成</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* TAB 3: AI 与翻译 */}
          {activeTab === 'translation' ? (
            <div className="settings-section-container">
              {/* 引擎与目标语言配置 */}
              <div className="settings-card">
                <div className="settings-card-head">
                  <div className="settings-card-icon-pill">
                    <IconLanguages size={20} />
                  </div>
                  <div>
                    <h3 className="settings-card-title">翻译引擎与目标语言</h3>
                    <p className="settings-card-desc">
                      翻译用于在技能编辑器中提供多语言预览或生成多语言副本，绝不会在未确认的情况下覆盖原 SKILL.md。
                    </p>
                  </div>
                </div>

                {/* 引擎切换卡片组 */}
                <div className="settings-field-box">
                  <div className="settings-field-label-group">
                    <span className="settings-field-label">选择默认翻译引擎</span>
                    <span className="settings-field-hint">点击切换不同通道，支持免配轻量通道、企业级 Azure 及通用大模型</span>
                  </div>
                  <div className="settings-engine-grid">
                    {TRANSLATION_ENGINES.map((engine) => {
                      const isSelected = translationEngine === engine.value
                      return (
                        <div
                          key={engine.value}
                          className={`settings-engine-card ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => {
                            setCfg({...cfg, translationEngine: engine.value} as AppConfig)
                            setStatus('')
                          }}
                        >
                          <div className="settings-engine-radio">
                            <span
                              className={`settings-radio-dot ${isSelected ? 'is-active' : ''}`}
                            />
                          </div>
                          <div className="settings-engine-info">
                            <div className="settings-engine-title-row">
                              <span className="settings-engine-title" title={engine.label}>
                                {engine.label}
                              </span>
                              <span className={`settings-engine-badge badge-${engine.badgeType}`}>
                                {engine.badge}
                              </span>
                            </div>
                            <p className="settings-engine-desc">{engine.desc}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 目标语言下拉选择 */}
                <div
                  className={fieldClass('translationTargetLanguage', 'settings-field-box')}
                  data-settings-field="translationTargetLanguage"
                >
                  <label className="settings-field-label">目标翻译语言</label>
                  <Select
                    value={cfg.translationTargetLanguage ?? 'zh-CN'}
                    onChange={(val) => {
                      setCfg({
                        ...cfg,
                        translationTargetLanguage: val,
                      } as AppConfig)
                      setStatus('')
                    }}
                    prefixIcon={<IconLanguages size={15} />}
                    options={SKILL_LANGUAGES.map((language) => ({
                      value: language.value,
                      label: language.label,
                    }))}
                    ariaLabel="目标翻译语言"
                  />
                </div>
              </div>

              {/* 微软 Azure Key 专属配置 */}
              {usesMicrosoft ? (
                <div className="settings-card">
                  <div className="settings-card-head">
                    <div className="settings-card-icon-pill">
                      <IconLock size={20} />
                    </div>
                    <div>
                      <h3 className="settings-card-title">Azure 翻译服务凭证</h3>
                      <p className="settings-card-desc">
                        配置 Azure 认知服务的 API 密钥与数据中心区域。密钥将加密存储在本地 .env 文件中。
                      </p>
                    </div>
                  </div>

                  <div className="settings-form-row">
                    <label
                      className={fieldClass('microsoftTranslatorKey', 'settings-field-box flex-2')}
                      data-settings-field="microsoftTranslatorKey"
                    >
                      <span className="settings-field-label">Subscription Key 订阅密钥</span>
                      <div className="settings-password-wrap">
                        <div className="settings-input-with-icon flex-1">
                          <IconKey size={16} className="settings-input-prefix-icon" />
                          <input
                            type={showMicrosoftKey ? 'text' : 'password'}
                            autoComplete="off"
                            className="settings-text-input with-prefix"
                            value={cfg.microsoftTranslatorKey ?? ''}
                            onChange={(e) => {
                              setCfg({
                                ...cfg,
                                microsoftTranslatorKey: e.target.value,
                              } as AppConfig)
                              setStatus('')
                            }}
                            placeholder="输入 Azure 32 位订阅密钥"
                          />
                        </div>
                        <button
                          type="button"
                          className="settings-eye-btn"
                          title={showMicrosoftKey ? '隐藏密钥' : '显示密钥'}
                          onClick={() => setShowMicrosoftKey(!showMicrosoftKey)}
                        >
                          {showMicrosoftKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                        </button>
                      </div>
                    </label>

                    <label className="settings-field-box flex-1">
                      <span className="settings-field-label">服务区域（Region）</span>
                      <input
                        className="settings-text-input"
                        value={cfg.microsoftTranslatorRegion ?? 'eastasia'}
                        onChange={(e) => {
                          setCfg({
                            ...cfg,
                            microsoftTranslatorRegion: e.target.value,
                          } as AppConfig)
                          setStatus('')
                        }}
                        placeholder="例如 eastasia, global"
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              {/* OpenAI 兼容端点专属配置 */}
              {usesOpenAICompatible ? (
                <div className="settings-card">
                  <div className="settings-card-head">
                    <div className="settings-card-icon-pill">
                      <IconSparkles size={20} />
                    </div>
                    <div>
                      <h3 className="settings-card-title">OpenAI 兼容端点与模型参数</h3>
                      <p className="settings-card-desc">
                        接入任意兼容 OpenAI 规范的 API 接口（如 OpenAI 官方、DeepSeek、Moonshot、通义千问或本地 Ollama/vLLM）。
                      </p>
                    </div>
                  </div>

                  <div className="settings-form-row">
                    <label
                      className={fieldClass('openAIBaseURL', 'settings-field-box flex-2')}
                      data-settings-field="openAIBaseURL"
                    >
                      <span className="settings-field-label">接口服务地址（Base URL）</span>
                      <div className="settings-input-with-icon">
                        <IconLink size={16} className="settings-input-prefix-icon" />
                        <input
                          className="settings-text-input with-prefix"
                          value={cfg.openAIBaseURL ?? 'https://api.openai.com/v1'}
                          onChange={(e) => {
                            setCfg({...cfg, openAIBaseURL: e.target.value} as AppConfig)
                            setStatus('')
                            setTestResult(null)
                          }}
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>
                    </label>

                    <label
                      className={fieldClass('openAIModel', 'settings-field-box flex-1')}
                      data-settings-field="openAIModel"
                    >
                      <span className="settings-field-label">模型标识（Model ID）</span>
                      <div className="settings-input-with-icon">
                        <IconCpu size={16} className="settings-input-prefix-icon" />
                        <input
                          className="settings-text-input with-prefix"
                          value={cfg.openAIModel ?? 'gpt-5.6-terra'}
                          onChange={(e) => {
                            setCfg({...cfg, openAIModel: e.target.value} as AppConfig)
                            setStatus('')
                            setTestResult(null)
                          }}
                          placeholder="例如 deepseek-chat, gpt-4o-mini"
                        />
                      </div>
                    </label>
                  </div>

                  <div className="settings-form-row">
                    <label
                      className={fieldClass('openAIAPIKey', 'settings-field-box flex-2')}
                      data-settings-field="openAIAPIKey"
                    >
                      <span className="settings-field-label">API 访问密钥（API Key）</span>
                      <div className="settings-password-wrap">
                        <div className="settings-input-with-icon flex-1">
                          <IconKey size={16} className="settings-input-prefix-icon" />
                          <input
                            type={showOpenAIKey ? 'text' : 'password'}
                            autoComplete="off"
                            className="settings-text-input with-prefix"
                            value={cfg.openAIAPIKey ?? ''}
                            onChange={(e) => {
                              setCfg({...cfg, openAIAPIKey: e.target.value} as AppConfig)
                              setStatus('')
                              setTestResult(null)
                            }}
                            placeholder="sk-…"
                          />
                        </div>
                        <button
                          type="button"
                          className="settings-eye-btn"
                          title={showOpenAIKey ? '隐藏密钥' : '显示密钥'}
                          onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                        >
                          {showOpenAIKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                        </button>
                      </div>
                    </label>

                    <div
                      className={fieldClass('openAITemperature', 'settings-field-box flex-1')}
                      data-settings-field="openAITemperature"
                    >
                      {(() => {
                        const curTemp = Number.isFinite(cfg.openAITemperature)
                          ? Number(cfg.openAITemperature)
                          : 0.2
                        const semantic = getTemperatureSemantic(curTemp)
                        return (
                          <>
                            <div className="settings-slider-label-row">
                              <span className="settings-field-label">采样温度（Temperature）</span>
                              <div className="settings-slider-badge-wrap">
                                <span
                                  className="settings-slider-semantic-tag"
                                  style={{
                                    color: semantic.color,
                                    backgroundColor: semantic.bg,
                                  }}
                                >
                                  {semantic.label}
                                </span>
                                <span className="settings-slider-value-tag">
                                  {curTemp.toFixed(2)}
                                </span>
                              </div>
                            </div>
                            <div className="settings-slider-card">
                              <div className="settings-temperature-slider-wrap">
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  className="settings-range-slider"
                                  style={
                                    {
                                      '--slider-progress': `${Math.min(100, Math.max(0, curTemp * 100))}%`,
                                    } as React.CSSProperties
                                  }
                                  value={curTemp}
                                  onChange={(e) => {
                                    setCfg({
                                      ...cfg,
                                      openAITemperature: Number(e.target.value),
                                    } as AppConfig)
                                    setStatus('')
                                    setTestResult(null)
                                  }}
                                />
                              </div>
                              <div className="settings-slider-scale-row">
                                <span className="settings-slider-scale-mark">0.0 精确严谨</span>
                                <span className="settings-slider-scale-mark">0.5</span>
                                <span className="settings-slider-scale-mark">1.0 创意发散</span>
                              </div>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>

                  {/* 连通性测试操作行 */}
                  <div className="settings-test-connection-panel">
                    <div className="settings-test-left">
                      <button
                        type="button"
                        className={`btn btn-secondary settings-test-btn ${testingConnection ? 'is-loading' : ''}`}
                        disabled={testingConnection}
                        onClick={() => void handleTestConnection()}
                      >
                        <IconActivity size={15} />
                        <span>{testingConnection ? '正在测试连通性…' : '测试端点连接'}</span>
                      </button>
                      <span className="settings-test-hint">
                        调用当前端点翻译测试短语，验证 API Key 与网络连接是否有效
                      </span>
                    </div>

                    {testResult ? (
                      <div className={`settings-test-badge is-${testResult.type}`}>
                        {testResult.type === 'success' ? (
                          <IconCheck size={14} />
                        ) : (
                          <IconShieldAlert size={14} />
                        )}
                        <span className="settings-test-msg">{testResult.message}</span>
                        {testResult.latencyMs !== undefined ? (
                          <span className="settings-test-latency">({testResult.latencyMs}ms)</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* 安全存储提示卡片 */}
                  <div className="settings-security-notice">
                    <div className="settings-security-icon-pill">
                      <IconLock size={16} />
                    </div>
                    <div className="settings-security-content">
                      <div className="settings-security-title-row">
                        <strong>本地安全存储保障</strong>
                        <span className="settings-security-tag">仅限本地</span>
                      </div>
                      <p>
                        翻译接口凭证将单独写入本地 <code>~/.skillsmanager/.env</code> 文件，绝不随通用配置同步，也不会明文上传至任何第三方云端。
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* TAB 4: 系统与诊断 */}
          {activeTab === 'system' ? (
            <div className="settings-section-container">
              {/* 权限状态面板 */}
              <div className="settings-card">
                <div className="settings-card-head">
                  <div className="settings-card-icon-pill">
                    <IconShield size={20} />
                  </div>
                  <div>
                    <h3 className="settings-card-title">系统管理员权限</h3>
                    <p className="settings-card-desc">
                      创建与管理 Windows NTFS 符号链接（Symlink）必须具备管理员权限或开启 Windows 开发者模式。
                    </p>
                  </div>
                </div>

                {elevated === null ? (
                  <div className="elev-status elev-status--pending" role="status">
                    <span className="elev-status-dot" aria-hidden="true" />
                    <div className="elev-status-body">
                      <strong className="elev-status-title">正在检测系统权限…</strong>
                      <p className="elev-status-desc">请稍候</p>
                    </div>
                  </div>
                ) : elevated ? (
                  <div className="elev-status elev-status--ok" role="status">
                    <span className="elev-status-icon" aria-hidden="true">
                      <IconShieldCheck size={24} />
                    </span>
                    <div className="elev-status-body">
                      <strong className="elev-status-title">已以管理员身份提权运行</strong>
                      <p className="elev-status-desc">
                        完全支持创建、删除符号链接，一键源仓整理与软链恢复功能均可稳定运行。
                      </p>
                    </div>
                    <span className="elev-status-tag">完全控制</span>
                  </div>
                ) : (
                  <div className="elev-status elev-status--warn" role="status">
                    <span className="elev-status-icon" aria-hidden="true">
                      <IconShieldAlert size={24} />
                    </span>
                    <div className="elev-status-body">
                      <strong className="elev-status-title">当前处于普通权限模式</strong>
                      <p className="elev-status-desc">
                        可安全浏览、查看与编辑本地技能；若需执行源仓整理或批量建立符号链接，需提升权限。
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary elev-status-action"
                      disabled={elevating}
                      onClick={() => void requestElevation()}
                    >
                      {elevating ? '正在提权…' : '以管理员身份重启'}
                    </button>
                  </div>
                )}
              </div>

              {/* 诊断日志 */}
              <div className="settings-card">
                <div className="settings-card-head">
                  <div className="settings-card-icon-pill">
                    <IconFolderOpen size={20} />
                  </div>
                  <div>
                    <h3 className="settings-card-title">运行诊断与日志</h3>
                    <p className="settings-card-desc">
                      操作详情与系统错误会记录在本地日志文件中，用于故障分析与排查。绝不会记录 API Key 或技能敏感正文。
                    </p>
                  </div>
                </div>

                <div className="settings-log-panel-body">
                  <div className="settings-log-toggle-row">
                    <div>
                      <strong>开启详细调试日志（Debug Mode）</strong>
                      <p className="muted" style={{margin: '2px 0 0', fontSize: '13px'}}>
                        记录更详细的底层文件操作、扫描轨迹与 HTTP 交互状态。
                      </p>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={Boolean(cfg.logDebug)}
                        aria-checked={Boolean(cfg.logDebug)}
                        onChange={(e) => {
                          setCfg({...cfg, logDebug: e.target.checked} as AppConfig)
                          setStatus('')
                        }}
                      />
                      <span className="switch-ui" aria-hidden="true" />
                    </label>
                  </div>

                  <div className="settings-log-dir-box">
                    <span className="settings-field-label">日志存储目录</span>
                    <div className="settings-path-input-group">
                      <input
                        className="settings-text-input"
                        readOnly
                        value={logsDir || '%USERPROFILE%\\.skillsmanager\\logs'}
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          void copyText(
                            logsDir || '%USERPROFILE%\\.skillsmanager\\logs',
                            'logsDir',
                          )
                        }
                      >
                        {copiedKey === 'logsDir' ? (
                          <>
                            <IconCheck size={14} />
                            <span>已复制</span>
                          </>
                        ) : (
                          <>
                            <IconCopy size={14} />
                            <span>复制</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void openLogsFolder()}
                      >
                        <IconFolderOpen size={15} />
                        <span>打开日志文件夹</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 新手引导重温 */}
              <div className="settings-card">
                <div className="settings-card-head">
                  <div className="settings-card-icon-pill">
                    <IconRotateCcw size={20} />
                  </div>
                  <div>
                    <h3 className="settings-card-title">演示与新手引导</h3>
                    <p className="settings-card-desc">
                      重新运行沙盒引导漫游，演示源仓整理、按工具开关链接以及分组视图的基本用法（不修改真实磁盘文件）。
                    </p>
                  </div>
                </div>

                <div className="settings-replay-action">
                  <button
                    type="button"
                    className="btn onboarding-replay-btn"
                    disabled={!onReplayOnboarding}
                    onClick={() => onReplayOnboarding?.()}
                  >
                    <IconRotateCcw size={15} />
                    <span>重新观看新手引导</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
})

export default SettingsPage
