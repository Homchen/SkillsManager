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
  RequestElevation,
  RevealInFolder,
  SaveConfig,
  SelectDirectory,
} from '../../wailsjs/go/main/App'
import type {config} from '../../wailsjs/go/models'
import {IconShieldAlert, IconShieldCheck} from '../components/icons'
import {SKILL_LANGUAGES} from '../lib/languages'
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
type TranslationSelect = 'engine' | 'targetLanguage' | null

const TRANSLATION_ENGINES = [
  {value: 'microsoft_android', label: '微软翻译（无需 Key）'},
  {value: 'microsoft', label: '微软翻译（Azure Key）'},
  {value: 'openai_compatible', label: 'AI 翻译（OpenAI 兼容）'},
]

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

const SettingsPage = forwardRef<SettingsPageHandle, Props>(function SettingsPage(
  {onReplayOnboarding},
  ref,
) {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [elevated, setElevated] = useState<boolean | null>(null)
  const [elevating, setElevating] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null)
  const [openToolMenuIndex, setOpenToolMenuIndex] = useState<number | null>(null)
  const toolMenuRef = useRef<HTMLDivElement | null>(null)
  const [openTranslationSelect, setOpenTranslationSelect] = useState<TranslationSelect>(null)
  const translationSelectRef = useRef<HTMLDivElement | null>(null)
  const [exportingToolId, setExportingToolId] = useState<string | null>(null)
  const [leavePromptOpen, setLeavePromptOpen] = useState(false)
  const leaveResolverRef = useRef<((proceed: boolean) => void) | null>(null)
  const [migratePrompt, setMigratePrompt] = useState<{from: string; to: string} | null>(null)
  const migrateResolverRef = useRef<((ok: boolean) => void) | null>(null)
  const [logsDir, setLogsDir] = useState('')
  const [highlightField, setHighlightField] = useState<SettingsFieldId | null>(null)
  const [highlightTick, setHighlightTick] = useState(0)

  useEffect(() => {
    if (openToolMenuIndex === null) return
    const onDoc = (ev: MouseEvent) => {
      if (toolMenuRef.current && !toolMenuRef.current.contains(ev.target as Node)) {
        setOpenToolMenuIndex(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [openToolMenuIndex])

  useEffect(() => {
    if (!openTranslationSelect) return
    const onDoc = (ev: MouseEvent) => {
      if (translationSelectRef.current && !translationSelectRef.current.contains(ev.target as Node)) {
        setOpenTranslationSelect(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [openTranslationSelect])

  const dirty = useMemo(() => {
    if (!cfg || !savedSnapshot) return false
    return configSnapshot(cfg) !== savedSnapshot
  }, [cfg, savedSnapshot])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [loaded, elev, dir] = await Promise.all([GetConfig(), IsElevated(), LogsDir()])
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
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!highlightField) return
    const node = document.querySelector<HTMLElement>(settingsFieldSelector(highlightField))
    if (!node) return
    node.scrollIntoView({behavior: 'smooth', block: 'center'})
    node.classList.remove('is-flashing')
    void node.offsetWidth
    node.classList.add('is-flashing')
    const focusable = node.querySelector<HTMLElement>('input, button, [tabindex]')
    focusable?.focus({preventScroll: true})
    const clear = window.setTimeout(() => setHighlightField(null), 1600)
    return () => window.clearTimeout(clear)
  }, [highlightField, highlightTick, editingToolIndex])

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
      setStatus('设置已保存')
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
      <div className="settings-page">
        <p className="muted">加载中…</p>
      </div>
    )
  }

  if (!cfg) {
    return (
      <div className="settings-page">
        {error ? <div className="error-banner">{error}</div> : null}
        <button type="button" className="btn" onClick={() => void load()}>
          重试
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
      // On success the unelevated process exits; if we return, refresh status.
      const elev = await IsElevated()
      setElevated(elev)
      setStatus(elev ? '已处于管理员模式' : '提权未完成')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setElevating(false)
    }
  }

  return (
    <div className="settings-page">
      {migratePrompt ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="migrate-hub-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="migrate-hub-title">迁移源仓？</h2>
            <p className="muted dialog-confirm-body">
              将从{' '}
              <strong>{migratePrompt.from}</strong>
              {' '}剪切到{' '}
              <strong>{migratePrompt.to}</strong>
              {' '}（含回收站），并改写工具目录中的相关符号链接。
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => finishMigratePrompt(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={() => finishMigratePrompt(true)}>
                继续
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {leavePromptOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="leave-settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="leave-settings-title">保存设置？</h2>
            <p className="muted">设置有未保存的更改，离开前是否保存？</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => finishLeavePrompt(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => finishLeavePrompt(true)}
              >
                不保存
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
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="page-sticky-header">
        <div className="page-toolbar">
          <h2 className="page-title">设置</h2>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button type="button" className="btn" onClick={() => void load()}>
            重新加载
          </button>
          {dirty ? <span className="muted">有未保存更改</span> : null}
        </div>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}
      {status ? <p className="muted status-line">{status}</p> : null}

      <section className="panel">
        <h3>权限状态</h3>
        {elevated === null ? (
          <div className="elev-status elev-status--pending" role="status">
            <span className="elev-status-dot" aria-hidden="true" />
            <div className="elev-status-body">
              <strong className="elev-status-title">正在检测权限…</strong>
              <p className="elev-status-desc">请稍候</p>
            </div>
          </div>
        ) : elevated ? (
          <div className="elev-status elev-status--ok" role="status">
            <span className="elev-status-icon" aria-hidden="true">
              <IconShieldCheck size={22} />
            </span>
            <div className="elev-status-body">
              <strong className="elev-status-title">管理员模式</strong>
              <p className="elev-status-desc">可创建与删除符号链接，整理功能可用</p>
            </div>
            <span className="elev-status-tag">已提权</span>
          </div>
        ) : (
          <div className="elev-status elev-status--warn" role="status">
            <span className="elev-status-icon" aria-hidden="true">
              <IconShieldAlert size={22} />
            </span>
            <div className="elev-status-body">
              <strong className="elev-status-title">普通权限运行中</strong>
              <p className="elev-status-desc">
                可浏览与编辑源仓；创建/删除符号链接与执行整理需要管理员权限。
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={elevating}
              onClick={() => void requestElevation()}
            >
              {elevating ? '正在提权…' : '以管理员身份重启'}
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <h3>新手引导</h3>
        <p className="muted">用演示走一遍整理、按工具开关和分组视图，不会改你磁盘上的文件。</p>
        <button
          type="button"
          className="btn onboarding-replay-btn"
          disabled={!onReplayOnboarding}
          onClick={() => onReplayOnboarding?.()}
        >
          重新观看引导
        </button>
      </section>

      <section className="panel">
        <h3>源仓</h3>
        <label
          className={fieldClass('hubPath')}
          data-settings-field="hubPath"
        >
          <span>源仓路径（hubPath）</span>
          <div className="path-row">
            <input
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
              title="打开文件夹选择"
              onClick={() => void pickHubPath()}
            >
              浏览…
            </button>
            <button
              type="button"
              className="btn"
              title="在资源管理器中打开"
              disabled={!(cfg.hubPath ?? '').trim()}
              onClick={() => void openFolder(cfg.hubPath ?? '')}
            >
              打开
            </button>
          </div>
        </label>
      </section>

      <section className="panel">
        <h3>翻译</h3>
        <p className="muted">
          翻译仅翻译技能描述且仅用于编辑器预览，不会修改 SKILL.md。
        </p>
        <div className="translation-settings" ref={translationSelectRef}>
          <div className="settings-fields-row">
            <div className="field">
              <span>翻译引擎</span>
              <div className="field-select">
                <button
                  type="button"
                  className="field-select-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={openTranslationSelect === 'engine'}
                  onClick={() =>
                    setOpenTranslationSelect((current) =>
                      current === 'engine' ? null : 'engine',
                    )
                  }
                >
                  {TRANSLATION_ENGINES.find((engine) => engine.value === translationEngine)?.label ??
                    translationEngine}
                </button>
                {openTranslationSelect === 'engine' ? (
                  <ul className="field-select-menu" role="listbox">
                    {TRANSLATION_ENGINES.map((engine) => (
                      <li key={engine.value} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={engine.value === translationEngine}
                          className={engine.value === translationEngine ? 'is-active' : undefined}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setOpenTranslationSelect(null)
                            setCfg({...cfg, translationEngine: engine.value} as AppConfig)
                            setStatus('')
                          }}
                        >
                          {engine.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className={fieldClass('translationTargetLanguage')} data-settings-field="translationTargetLanguage">
              <span>目标语言</span>
              <div className="field-select">
                <button
                  type="button"
                  className="field-select-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={openTranslationSelect === 'targetLanguage'}
                  onClick={() =>
                    setOpenTranslationSelect((current) =>
                      current === 'targetLanguage' ? null : 'targetLanguage',
                    )
                  }
                >
                  {SKILL_LANGUAGES.find(
                    (language) =>
                      language.value === (cfg.translationTargetLanguage ?? 'zh-CN'),
                  )?.label ?? (cfg.translationTargetLanguage ?? 'zh-CN')}
                </button>
                {openTranslationSelect === 'targetLanguage' ? (
                  <ul className="field-select-menu" role="listbox">
                    {SKILL_LANGUAGES.map((language) => (
                      <li key={language.value} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={
                            language.value === (cfg.translationTargetLanguage ?? 'zh-CN')
                          }
                          className={
                            language.value === (cfg.translationTargetLanguage ?? 'zh-CN')
                              ? 'is-active'
                              : undefined
                          }
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setOpenTranslationSelect(null)
                            setCfg({...cfg, translationTargetLanguage: language.value} as AppConfig)
                            setStatus('')
                          }}
                        >
                          {language.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
          {usesMicrosoft ? (
            <div className="settings-fields-row">
              <label className={fieldClass('microsoftTranslatorKey')} data-settings-field="microsoftTranslatorKey">
                <span>Subscription Key</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={cfg.microsoftTranslatorKey ?? ''}
                  onChange={(e) => {
                    setCfg({...cfg, microsoftTranslatorKey: e.target.value} as AppConfig)
                    setStatus('')
                  }}
                  placeholder="Azure Translator 密钥（保存在本地 .env）"
                />
              </label>
              <label className="field">
                <span>区域（Region）</span>
                <input
                  value={cfg.microsoftTranslatorRegion ?? 'eastasia'}
                  onChange={(e) => {
                    setCfg({...cfg, microsoftTranslatorRegion: e.target.value} as AppConfig)
                    setStatus('')
                  }}
                  placeholder="eastasia"
                />
              </label>
            </div>
          ) : null}
          {usesOpenAICompatible ? (
            <>
              <div className="settings-fields-row">
                <label className={fieldClass('openAIBaseURL')} data-settings-field="openAIBaseURL">
                  <span>接口地址（Base URL）</span>
                  <input
                    value={cfg.openAIBaseURL ?? 'https://api.openai.com/v1'}
                    onChange={(e) => {
                      setCfg({...cfg, openAIBaseURL: e.target.value} as AppConfig)
                      setStatus('')
                    }}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label className={fieldClass('openAIModel')} data-settings-field="openAIModel">
                  <span>模型名称</span>
                  <input
                    value={cfg.openAIModel ?? 'gpt-5.6-terra'}
                    onChange={(e) => {
                      setCfg({...cfg, openAIModel: e.target.value} as AppConfig)
                      setStatus('')
                    }}
                    placeholder="gpt-5.6-terra"
                  />
                </label>
              </div>
              <div className="settings-fields-row">
                <label
                  className={fieldClass('openAITemperature', 'field narrow')}
                  data-settings-field="openAITemperature"
                >
                  <span>模型温度</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    title="范围 0–1，建议 0–0.3"
                    value={
                      Number.isFinite(cfg.openAITemperature)
                        ? cfg.openAITemperature
                        : 0.2
                    }
                    onChange={(e) => {
                      setCfg({
                        ...cfg,
                        openAITemperature: Number(e.target.value),
                      } as AppConfig)
                      setStatus('')
                    }}
                  />
                </label>
                <label className={fieldClass('openAIAPIKey')} data-settings-field="openAIAPIKey">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={cfg.openAIAPIKey ?? ''}
                    onChange={(e) => {
                      setCfg({...cfg, openAIAPIKey: e.target.value} as AppConfig)
                      setStatus('')
                    }}
                    placeholder="sk-…"
                    autoComplete="off"
                  />
                </label>
                <p className="translation-api-key-warning">
                  API Key 保存在用户目录 ~/.skillsmanager/.env
                </p>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h3>工具目录</h3>
          <button type="button" className="btn" onClick={() => void addTool()}>
            添加工具
          </button>
        </div>
        {(cfg.tools ?? []).length === 0 ? (
          <p className="muted">暂无工具映射</p>
        ) : (
          <div className="tools-list">
            {(cfg.tools ?? []).map((tool, index) => {
              const editing = editingToolIndex === index
              return (
                <div key={index} className={`tool-row${editing ? ' editing' : ''}`}>
                  {editing ? (
                    <>
                      <label
                        className={fieldClass(`tool:${index}:id`)}
                        data-settings-field={`tool:${index}:id`}
                      >
                        <span>ID</span>
                        <input
                          value={tool.id}
                          onChange={(e) => updateTool(index, {id: e.target.value})}
                          placeholder="例如 cursor"
                          autoFocus
                        />
                      </label>
                      <label
                        className={fieldClass(`tool:${index}:path`, 'field grow')}
                        data-settings-field={`tool:${index}:path`}
                      >
                        <span>路径</span>
                        <div className="path-row">
                          <input
                            value={tool.path}
                            onChange={(e) => updateTool(index, {path: e.target.value})}
                            placeholder="绝对路径"
                          />
                          <button
                            type="button"
                            className="btn"
                            title="打开文件夹选择"
                            onClick={() => void pickToolPath(index)}
                          >
                            浏览…
                          </button>
                          <button
                            type="button"
                            className="btn"
                            title="在资源管理器中打开"
                            disabled={!tool.path.trim()}
                            onClick={() => void openFolder(tool.path)}
                          >
                            打开
                          </button>
                        </div>
                      </label>
                    </>
                  ) : (
                    <div className="tool-view grow">
                      <div className="tool-view-id">{tool.id || '（未命名）'}</div>
                      <div className="tool-view-path" title={tool.path}>
                        {tool.path || '（未设置路径）'}
                      </div>
                    </div>
                  )}
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={Boolean(tool.enabled)}
                      onChange={(e) => updateTool(index, {enabled: e.target.checked})}
                    />
                    启用
                  </label>
                  {!editing ? (
                    <button
                      type="button"
                      className="btn"
                      title="在资源管理器中打开"
                      disabled={!tool.path.trim()}
                      onClick={() => void openFolder(tool.path)}
                    >
                      打开
                    </button>
                  ) : null}
                  {editing ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setEditingToolIndex(null)}
                    >
                      完成
                    </button>
                  ) : null}
                  <div
                    className="card-menu-wrap tool-row-menu"
                    ref={openToolMenuIndex === index ? toolMenuRef : undefined}
                  >
                    <button
                      type="button"
                      className="btn"
                      aria-label="更多"
                      aria-expanded={openToolMenuIndex === index}
                      disabled={exportingToolId !== null}
                      onClick={() =>
                        setOpenToolMenuIndex(openToolMenuIndex === index ? null : index)
                      }
                    >
                      更多
                    </button>
                    {openToolMenuIndex === index ? (
                      <div className="card-menu">
                        {!editing ? (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenToolMenuIndex(null)
                              setEditingToolIndex(index)
                            }}
                          >
                            编辑
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={!tool.id.trim() || exportingToolId !== null}
                          onClick={() => {
                            setOpenToolMenuIndex(null)
                            void exportTool(tool.id)
                          }}
                        >
                          {exportingToolId === tool.id ? '导出中…' : '导出'}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            setOpenToolMenuIndex(null)
                            removeTool(index)
                          }}
                        >
                          删除
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h3>诊断日志</h3>
        <p className="muted">
          操作与错误会写入本地日志，便于排查难复现问题。默认 Info；打开详细日志后记录 HTTP
          状态与重试等调试信息。不会写入 API Key 或文档正文。
        </p>
        <div className="log-settings-row">
          <label className="switch-field">
            <span>详细日志（Debug）</span>
            <span className="switch">
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
            </span>
          </label>
          <div className="log-dir-inline">
            <span className="log-dir-label">日志目录</span>
            <span className="log-dir-path" title={logsDir || undefined}>
              {logsDir || '%USERPROFILE%\\.skillsmanager\\logs'}
            </span>
            <button type="button" className="btn" onClick={() => void openLogsFolder()}>
              打开
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>回收站</h3>
        <p className="muted">删除的技能可在 Skills 页「回收站」找回；超过保留天数将自动清理。</p>
        <label
          className={fieldClass('trashRetentionDays', 'field narrow')}
          data-settings-field="trashRetentionDays"
        >
          <span>保留天数（trashRetentionDays）</span>
          <input
            type="number"
            min={1}
            step={1}
            value={cfg.trashRetentionDays ?? 7}
            onChange={(e) => {
              setCfg({
                ...cfg,
                trashRetentionDays: Number(e.target.value),
              } as AppConfig)
              setStatus('')
            }}
          />
        </label>
      </section>
    </div>
  )
})

export default SettingsPage
