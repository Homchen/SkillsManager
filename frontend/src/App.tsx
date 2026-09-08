import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {AppView, TranslationTask} from './types'
import SkillsPage from './pages/SkillsPage'
import EditorPage, {type EditorPageHandle} from './pages/EditorPage'
import OrganizePage from './pages/OrganizePage'
import SettingsPage, {type SettingsPageHandle} from './pages/SettingsPage'
import UsagePage from './pages/UsagePage'
import OnboardingOverlay from './components/OnboardingOverlay'
import {
  IconAlertTriangle,
  IconChartSpline,
  IconCheckCircle2,
  IconHub,
  IconLanguages,
  IconLayoutGrid,
  IconSliders,
  IconX,
} from './components/icons'
import {
  CancelSkillTranslation,
  CompleteOnboarding,
  GetConfigLoadError,
  ShouldShowOnboarding,
} from '../wailsjs/go/main/App'
import {EventsOn} from '../wailsjs/runtime/runtime'
import {logClientWarn} from './lib/clientLog'

const NAV: {id: AppView; label: string; Icon: typeof IconLayoutGrid}[] = [
  {id: 'skills', label: '技能', Icon: IconLayoutGrid},
  {id: 'usage', label: '使用统计', Icon: IconChartSpline},
  {id: 'settings', label: '设置', Icon: IconSliders},
]

function App() {
  const [view, setView] = useState<AppView>('skills')
  const [editorSkillId, setEditorSkillId] = useState<string | null>(null)
  const [editorInitialFile, setEditorInitialFile] = useState<string | null>(null)
  const [skillsReloadToken, setSkillsReloadToken] = useState(0)
  const [translationTask, setTranslationTask] = useState<TranslationTask | null>(null)
  const [configLoadError, setConfigLoadError] = useState('')
  const [tourOpen, setTourOpen] = useState(false)
  const [tourNonce, setTourNonce] = useState(0)
  const settingsRef = useRef<SettingsPageHandle>(null)
  const editorRef = useRef<EditorPageHandle>(null)
  const mainRef = useRef<HTMLElement>(null)
  const skillsScrollTop = useRef(0)

  useEffect(() => {
    const off = EventsOn('skilltranslation:progress', (...data: unknown[]) => {
      const event = (data[0] ?? {}) as {
        phase?: string
        file?: string
        current?: number
        total?: number
        chunk?: number
        chunkTotal?: number
        sourceID?: string
        targetLanguage?: string
        error?: string
      }
      const fileProgress =
        event.total && event.current
          ? `${event.current}/${event.total}${event.file ? ` ${event.file}` : ''}`
          : ''
      const chunkProgress =
        event.chunkTotal && event.chunk ? ` · 块 ${event.chunk}/${event.chunkTotal}` : ''
      const ids = {
        sourceID: event.sourceID,
        targetLanguage: event.targetLanguage,
        file: event.file,
      }
      switch (event.phase) {
        case 'copying':
          setTranslationTask({
            ...ids,
            active: true,
            tone: 'info',
            message: '正在创建翻译版本快照…',
          })
          break
        case 'translating':
          setTranslationTask({
            ...ids,
            active: true,
            tone: 'info',
            message: `正在翻译${fileProgress ? `（${fileProgress}${chunkProgress}）` : '…'}`,
          })
          break
        case 'validating':
          setTranslationTask({
            ...ids,
            active: true,
            tone: 'info',
            message: '正在校验翻译版本…',
          })
          break
        case 'publishing':
          setTranslationTask({
            ...ids,
            active: true,
            tone: 'info',
            message: '正在发布翻译版本…',
          })
          break
        case 'completed':
          setTranslationTask({
            ...ids,
            active: false,
            tone: 'success',
            message: `已创建 ${event.targetLanguage ?? '翻译版本'}`,
          })
          setSkillsReloadToken((n) => n + 1)
          break
        case 'cancelled':
          setTranslationTask({
            ...ids,
            active: false,
            tone: 'info',
            message: '翻译已取消',
          })
          break
        case 'failed':
          setTranslationTask({
            ...ids,
            active: false,
            tone: 'error',
            message: event.error || '创建语言版本失败',
          })
          break
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [])

  useEffect(() => {
    if (!translationTask || translationTask.active) return
    // Keep failures visible until the user dismisses them; other terminal
    // statuses still clear automatically.
    if (translationTask.tone === 'error') return
    const timer = window.setTimeout(() => {
      setTranslationTask(null)
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [translationTask])

  async function goTo(next: AppView) {
    if (tourOpen) return
    if (next === view) return
    if (view === 'settings') {
      const ok = (await settingsRef.current?.tryLeave()) ?? true
      if (!ok) return
    }
    if (view === 'editor') {
      const ok = (await editorRef.current?.tryLeave()) ?? true
      if (!ok) return
      // 编辑可能改了 SKILL.md frontmatter，回列表需重新扫描
      if (next === 'skills') {
        setSkillsReloadToken((n) => n + 1)
      }
    }
    if (view === 'skills' && mainRef.current) {
      skillsScrollTop.current = mainRef.current.scrollTop
    }
    setView(next)
  }

  useLayoutEffect(() => {
    const el = mainRef.current
    if (!el) return
    if (view === 'skills') {
      el.scrollTop = skillsScrollTop.current
    } else {
      el.scrollTop = 0
    }
  }, [view])

  function openEditor(skillId: string) {
    setEditorInitialFile(null)
    setEditorSkillId(skillId)
    void goTo('editor')
  }

  async function openSkill(skillId: string, file?: string) {
    const ok = (await editorRef.current?.tryLeave()) ?? true
    if (!ok) return
    setEditorInitialFile(file ?? 'SKILL.md')
    setEditorSkillId(skillId)
    if (view !== 'editor') void goTo('editor')
  }

  /** Jump to the skill editor related to the nav translation status. */
  async function openTranslationTaskEditor() {
    if (!translationTask) return
    const skillId = translationTask.sourceID
    if (!skillId) return
    const file =
      translationTask.tone === 'success'
        ? 'SKILL.md'
        : translationTask.file || 'SKILL.md'
    if (view === 'editor' && editorSkillId === skillId) {
      await editorRef.current?.openFile(file)
      return
    }
    await openSkill(skillId, file)
  }

  async function cancelTranslation() {
    try {
      await CancelSkillTranslation()
      setTranslationTask((task) => (task ? {...task, message: '正在取消翻译…'} : task))
    } catch (e) {
      setTranslationTask({
        active: false,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  function openOrganize() {
    void goTo('organize')
  }

  function goSkills(options?: {refresh?: boolean}) {
    if (options?.refresh) {
      setSkillsReloadToken((n) => n + 1)
    }
    void goTo('skills')
  }

  function openTour() {
    setTourNonce((n) => n + 1)
    setTourOpen(true)
  }

  async function replayOnboarding() {
    if (view === 'settings') {
      const ok = (await settingsRef.current?.tryLeave()) ?? true
      if (!ok) return
    }
    if (view === 'editor') {
      const ok = (await editorRef.current?.tryLeave()) ?? true
      if (!ok) return
    }
    setView('skills')
    openTour()
  }

  function finishOnboarding() {
    setTourOpen(false)
    void CompleteOnboarding().catch((e) => {
      logClientWarn('complete onboarding failed', e instanceof Error ? e.message : String(e))
    })
  }

  useEffect(() => {
    void ShouldShowOnboarding().then((show) => {
      if (show) openTour()
    })
  }, [])

  useEffect(() => {
    void GetConfigLoadError().then((msg) => {
      if (msg) setConfigLoadError(msg)
    })
  }, [])

  const navActive =
    view === 'skills' || view === 'organize' || view === 'editor'
      ? 'skills'
      : view

  const navContext =
    view === 'editor' && editorSkillId
      ? {label: '编辑', detail: editorSkillId}
      : view === 'organize'
        ? {label: '整理', detail: '一键整理'}
        : null

  const translationTone = translationTask?.tone ?? 'info'
  const tabsRef = useRef<HTMLDivElement>(null)
  const [navThumb, setNavThumb] = useState({x: 0, w: 0, ready: false})

  const measureNavThumb = useCallback(() => {
    const root = tabsRef.current
    if (!root) return
    const activeEl = root.querySelector<HTMLElement>('.app-nav-tab.is-active')
    if (!activeEl) return
    setNavThumb({
      x: activeEl.offsetLeft,
      w: activeEl.offsetWidth,
      ready: true,
    })
  }, [])

  useLayoutEffect(() => {
    measureNavThumb()
  }, [navActive, measureNavThumb])

  useEffect(() => {
    const root = tabsRef.current
    if (!root) return
    const ro = new ResizeObserver(() => measureNavThumb())
    ro.observe(root)
    root.querySelectorAll('.app-nav-tab').forEach((el) => ro.observe(el))
    window.addEventListener('resize', measureNavThumb)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measureNavThumb)
    }
  }, [measureNavThumb])

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="主导航">
        <button
          type="button"
          className="app-nav-brand"
          onClick={() => void goTo('skills')}
          title="回到技能列表"
          aria-label="SkillsManager"
        >
          <span className="app-nav-mark" aria-hidden="true">
            <IconHub size={16} />
          </span>
          <span className="app-nav-brand-name">SkillsManager</span>
        </button>

        <div className="app-nav-tabs" ref={tabsRef}>
          <span
            className={navThumb.ready ? 'app-nav-thumb is-ready' : 'app-nav-thumb'}
            style={{
              width: navThumb.w,
              transform: `translate3d(${navThumb.x}px, 0, 0)`,
            }}
            aria-hidden="true"
          />
          {NAV.map((item) => {
            const active = navActive === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                className={active ? 'app-nav-tab is-active' : 'app-nav-tab'}
                title={item.label}
                data-tour={`nav-${item.id}`}
                onClick={() => void goTo(item.id)}
              >
                <item.Icon size={15} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>

        {navContext ? (
          <div className="app-nav-context" title={navContext.detail}>
            <span className="app-nav-context-label">{navContext.label}</span>
            <span className="app-nav-context-detail">{navContext.detail}</span>
          </div>
        ) : null}

        <div className="app-nav-status">
          {configLoadError ? (
            <span className="app-nav-chip is-error" title={configLoadError}>
              <IconAlertTriangle size={14} />
              <span className="app-nav-chip-text">{configLoadError}</span>
            </span>
          ) : null}
          {translationTask ? (
            <div
              className={`app-nav-chip is-${translationTone}${translationTask.active ? ' is-busy' : ''}`}
            >
              {translationTask.active ? (
                <span className="app-nav-chip-spinner" aria-hidden="true" />
              ) : translationTone === 'error' ? (
                <IconAlertTriangle size={14} />
              ) : translationTone === 'success' ? (
                <IconCheckCircle2 size={14} />
              ) : (
                <IconLanguages size={14} />
              )}
              <button
                type="button"
                className="app-nav-chip-text app-nav-chip-link"
                title={`${translationTask.message}（点击打开编辑器）`}
                onClick={() => void openTranslationTaskEditor()}
              >
                {translationTask.message}
              </button>
              {translationTask.active ? (
                <button
                  type="button"
                  className="app-nav-chip-action"
                  onClick={() => void cancelTranslation()}
                >
                  取消
                </button>
              ) : (
                <button
                  type="button"
                  className="app-nav-chip-icon-btn"
                  onClick={() => setTranslationTask(null)}
                  aria-label="关闭提示"
                  title="关闭提示"
                >
                  <IconX size={13} />
                </button>
              )}
            </div>
          ) : null}
        </div>
      </nav>
      <main ref={mainRef} className="app-main">
        <div
          className={view === 'skills' ? undefined : 'view-inactive'}
          aria-hidden={view !== 'skills'}
        >
          <SkillsPage
            onOpenEditor={openEditor}
            onOrganize={openOrganize}
            reloadToken={skillsReloadToken}
            active={view === 'skills'}
          />
        </div>
        {view === 'organize' ? (
          <OrganizePage onBack={() => goSkills({refresh: true})} />
        ) : null}
        {view === 'editor' && editorSkillId ? (
          <EditorPage
            ref={editorRef}
            skillId={editorSkillId}
            initialFile={editorInitialFile}
            onInitialFileConsumed={() => setEditorInitialFile(null)}
            onBack={() => goSkills()}
            onOpenSkill={(id, file) => void openSkill(id, file)}
            translationTask={translationTask}
          />
        ) : null}
        {view === 'settings' ? (
          <SettingsPage ref={settingsRef} onReplayOnboarding={() => void replayOnboarding()} />
        ) : null}
        {view === 'usage' ? (
          <UsagePage onOpenEditor={openEditor} active={view === 'usage'} />
        ) : null}
      </main>
      {tourOpen ? (
        <OnboardingOverlay key={tourNonce} onFinish={finishOnboarding} />
      ) : null}
    </div>
  )
}

export default App
