import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {AppView, TranslationTask} from './types'
import SkillsPage from './pages/SkillsPage'
import EditorPage, {type EditorPageHandle} from './pages/EditorPage'
import OrganizePage from './pages/OrganizePage'
import SettingsPage, {type SettingsPageHandle} from './pages/SettingsPage'
import UsagePage from './pages/UsagePage'
import {CancelSkillTranslation, GetConfigLoadError} from '../wailsjs/go/main/App'
import {EventsOn} from '../wailsjs/runtime/runtime'

const NAV: {id: AppView; label: string}[] = [
  {id: 'skills', label: '技能'},
  {id: 'usage', label: '使用统计'},
  {id: 'settings', label: '设置'},
]

function App() {
  const [view, setView] = useState<AppView>('skills')
  const [editorSkillId, setEditorSkillId] = useState<string | null>(null)
  const [editorInitialFile, setEditorInitialFile] = useState<string | null>(null)
  const [skillsReloadToken, setSkillsReloadToken] = useState(0)
  const [translationTask, setTranslationTask] = useState<TranslationTask | null>(null)
  const [configLoadError, setConfigLoadError] = useState('')
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

  useEffect(() => {
    void GetConfigLoadError().then((msg) => {
      if (msg) setConfigLoadError(msg)
    })
  }, [])

  const navActive =
    view === 'skills' || view === 'organize' || view === 'editor'
      ? 'skills'
      : view

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="主导航">
        <span className="brand">SkillsManager</span>
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={navActive === item.id ? 'active' : undefined}
            onClick={() => void goTo(item.id)}
          >
            {item.label}
          </button>
        ))}
        {configLoadError ? (
          <span className="error-banner" title={configLoadError}>
            {configLoadError}
          </span>
        ) : null}
        {translationTask ? (
          <button
            type="button"
            className={
              translationTask.tone === 'error'
                ? 'error-banner translation-task-banner translation-task-link'
                : 'muted translation-task-banner translation-task-link'
            }
            title={`${translationTask.message}（点击打开编辑器）`}
            onClick={() => void openTranslationTaskEditor()}
          >
            {translationTask.message}
          </button>
        ) : null}
        {translationTask?.active ? (
          <button type="button" onClick={() => void cancelTranslation()}>
            取消创建
          </button>
        ) : null}
        {translationTask && !translationTask.active ? (
          <button type="button" onClick={() => setTranslationTask(null)}>
            关闭提示
          </button>
        ) : null}
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
        {view === 'settings' ? <SettingsPage ref={settingsRef} /> : null}
        {view === 'usage' ? (
          <UsagePage onOpenEditor={openEditor} active={view === 'usage'} />
        ) : null}
      </main>
    </div>
  )
}

export default App
