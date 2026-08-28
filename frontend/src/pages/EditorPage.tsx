import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import CodeEditor from '../components/CodeEditor'
import {AppToast, useAppToast} from '../components/AppToast'
import FileTree, {NewFileActionIcon, NewFolderActionIcon} from '../components/FileTree'
import MarkdownPreview from '../components/MarkdownPreview'
import {buildFileTree, parentDirPath, type FileTreeNode} from '../lib/fileTree'
import {isMarkdownPath} from '../lib/languageForPath'
import {
  CreateSkillDir,
  CreateSkillFile,
  DeleteSkillEntry,
  DeleteSkillLanguage,
  GetConfig,
  GetSkillI18n,
  ListSkillFiles,
  ReadSkillFile,
  RenameSkillEntry,
  CancelSkillTranslation,
  RetagSkillDefaultLanguage,
  SetSkillDefaultLanguage,
  SetSkillOriginalLanguage,
  StartSkillTranslation,
  TranslateSkillDescription,
  WriteSkillFile,
} from '../../wailsjs/go/main/App'
import {findSkillFile, type SkillHrefTarget} from '../lib/skillRelativeHref'
import {descriptionFromFrontmatter} from '../lib/skillFrontmatter'
import {IconCopyPlus, IconPencil} from '../components/icons'
import {SKILL_LANGUAGES, languageLabel} from '../lib/languages'
import {logClientWarn} from '../lib/clientLog'
import type {SkillI18nInfo, TranslationTask} from '../types'

function skillRef(id: string, language: string) {
  return {id, language: language || ''}
}

function joinSkillPath(dir: string, name: string): string {
  const base = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  const leaf = name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return base ? `${base}/${leaf}` : leaf
}

function isValidLeafName(name: string): boolean {
  const leaf = name.trim()
  if (!leaf || leaf === '.' || leaf === '..') return false
  if (leaf.includes('/') || leaf.includes('\\')) return false
  return true
}

function pathIsWithin(path: string | null, parent: string): boolean {
  return Boolean(path && (path === parent || path.startsWith(`${parent}/`)))
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  return path === oldPrefix ? newPrefix : `${newPrefix}${path.slice(oldPrefix.length)}`
}

type Props = {
  skillId: string
  /** Open this file after the skill file list loads (consumed once). */
  initialFile?: string | null
  onInitialFileConsumed?: () => void
  onBack: () => void
  /** Open another skill (e.g. sibling link ../other/SKILL.md). */
  onOpenSkill: (skillId: string, file?: string) => void
  translationTask: TranslationTask | null
}

export type EditorPageHandle = {
  /** 若有未保存真实改动则提示；返回 true 表示可以离开 */
  tryLeave: () => Promise<boolean>
  /** Open a relative file inside the current skill (prompts if dirty). */
  openFile: (file: string) => Promise<void>
}

type ViewMode = 'preview' | 'source' | 'split'

function isSkillDefinition(path: string | null): boolean {
  return path?.replace(/\\/g, '/') === 'SKILL.md'
}


const EditorPage = forwardRef<EditorPageHandle, Props>(function EditorPage(
  {
    skillId,
    initialFile = null,
    onInitialFileConsumed,
    onBack,
    onOpenSkill,
    translationTask,
  },
  ref,
) {
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedDir, setSelectedDir] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [error, setError] = useState('')
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creatingEntry, setCreatingEntry] = useState(false)
  const [createEntryKind, setCreateEntryKind] = useState<'file' | 'dir' | null>(null)
  const [createEntryName, setCreateEntryName] = useState('')
  const [createEntryParent, setCreateEntryParent] = useState('')
  const [createEntryError, setCreateEntryError] = useState('')
  const [entryAction, setEntryAction] = useState<{
    kind: 'rename' | 'delete'
    node: FileTreeNode
  } | null>(null)
  const [renameEntryName, setRenameEntryName] = useState('')
  const [entryActionError, setEntryActionError] = useState('')
  const [mutatingEntry, setMutatingEntry] = useState(false)
  const [status, setStatus] = useState('')
  const {toast, showToast, dismissToast} = useAppToast()
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [translation, setTranslation] = useState<{language: string; text: string} | null>(null)
  const [translating, setTranslating] = useState(false)
  const [startingCopy, setStartingCopy] = useState(false)
  const [editingLanguage, setEditingLanguage] = useState('')
  const [i18n, setI18n] = useState<SkillI18nInfo | null>(null)
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const [originalLanguageMenuOpen, setOriginalLanguageMenuOpen] = useState(false)
  const [originalLanguagePromptDismissed, setOriginalLanguagePromptDismissed] =
    useState(false)
  const [retagPromptOpen, setRetagPromptOpen] = useState(false)
  const [settingLanguage, setSettingLanguage] = useState(false)
  const [originalLanguage, setOriginalLanguage] = useState(SKILL_LANGUAGES[0].value)
  const [targetLanguage, setTargetLanguage] = useState(SKILL_LANGUAGES[0].value)
  const [confirmPrompt, setConfirmPrompt] = useState<
    | {kind: 'set-default'; language: string}
    | {kind: 'delete-language'; language: string}
    | null
  >(null)
  const [leavePromptOpen, setLeavePromptOpen] = useState(false)
  const leaveResolverRef = useRef<((proceed: boolean) => void) | null>(null)
  const [translatePrompt, setTranslatePrompt] = useState<{kind: 'save'} | null>(null)
  const translatePromptResolverRef = useRef<((value: unknown) => void) | null>(null)
  const languageMenuRef = useRef<HTMLDivElement | null>(null)
  const originalLanguageMenuRef = useRef<HTMLDivElement | null>(null)
  const translationRequestRef = useRef(0)
  const completedTranslationRef = useRef('')
  const pendingInitialFileRef = useRef<string | null>(null)
  const i18nGenRef = useRef(0)
  const filesGenRef = useRef(0)
  const dirtyRef = useRef(false)
  if (initialFile) {
    pendingInitialFileRef.current = initialFile
  }

  const dirty = !loadingFile && content !== savedContent
  dirtyRef.current = dirty
  const description = useMemo(() => descriptionFromFrontmatter(content), [content])
  const isSkillMD = isSkillDefinition(selected)
  const createVersionLabel = `创建${languageLabel(targetLanguage)}版本`
  const translationBlocker = !isSkillMD
    ? '仅支持技能根目录的 SKILL.md'
    : !description
      ? '此 SKILL.md 不包含 description'
      : viewMode !== 'preview'
        ? '请切换到 Markdown 预览模式后翻译'
        : ''
  // Prefer the app-level task as the single source of truth so the editor
  // button cannot fall out of sync after remounts or skillId blips.
  const relatedTask =
    translationTask &&
    translationTask.sourceID === skillId
      ? translationTask
      : null
  const copyTranslating = Boolean(relatedTask?.active) || startingCopy
  const copyStatus = relatedTask?.message ?? ''
  const translationBusy = Boolean(translationTask?.active) || startingCopy
  const activeLanguage = editingLanguage || i18n?.defaultLanguage || ''

  const loadI18n = useCallback(
    async (preserveEditingLanguage = false) => {
      const gen = ++i18nGenRef.current
      try {
        const info = await GetSkillI18n(skillId)
        if (gen !== i18nGenRef.current) return
        setI18n(info)
        setEditingLanguage((current) =>
          preserveEditingLanguage && current ? current : info.defaultLanguage || '',
        )
      } catch (e) {
        if (gen !== i18nGenRef.current) return
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [skillId],
  )

  useEffect(() => {
    setI18n(null)
    setEditingLanguage('')
    setLanguageMenuOpen(false)
    setOriginalLanguageMenuOpen(false)
    setOriginalLanguagePromptDismissed(false)
    setRetagPromptOpen(false)
    setConfirmPrompt(null)
    void loadI18n()
  }, [loadI18n])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cfg = await GetConfig()
        if (cancelled) return
        setTargetLanguage(cfg.translationTargetLanguage ?? SKILL_LANGUAGES[0].value)
      } catch {
        // Keep the previous target language label on config load failure.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [skillId])

  useEffect(() => {
    if (!languageMenuOpen && !originalLanguageMenuOpen) return
    const onDoc = (ev: MouseEvent) => {
      if (
        languageMenuRef.current &&
        !languageMenuRef.current.contains(ev.target as Node)
      ) {
        setLanguageMenuOpen(false)
      }
      if (
        originalLanguageMenuRef.current &&
        !originalLanguageMenuRef.current.contains(ev.target as Node)
      ) {
        setOriginalLanguageMenuOpen(false)
      }
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setLanguageMenuOpen(false)
        setOriginalLanguageMenuOpen(false)
        setRetagPromptOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [languageMenuOpen, originalLanguageMenuOpen])

  const loadFiles = useCallback(async () => {
    const gen = ++filesGenRef.current
    setLoadingFiles(true)
    setError('')
    try {
      const list = (await ListSkillFiles(skillRef(skillId, activeLanguage))) ?? []
      if (gen !== filesGenRef.current) return
      setFiles(list)
      const filesOnly = list.filter((f) => !f.endsWith('/'))
      if (filesOnly.length === 0) {
        setSelected(null)
        setSelectedDir(null)
        setContent('')
        setSavedContent('')
        return
      }
      const focus = pendingInitialFileRef.current
      pendingInitialFileRef.current = null
      const focused = focus ? findSkillFile(focus, filesOnly) : undefined
      const prefer =
        focused ??
        filesOnly.find((f) => f === 'SKILL.md' || f.endsWith('/SKILL.md')) ??
        filesOnly[0]
      setSelected(prefer)
      setSelectedDir(null)
      if (focus) onInitialFileConsumed?.()
    } catch (e) {
      if (gen !== filesGenRef.current) return
      setError(e instanceof Error ? e.message : String(e))
      pendingInitialFileRef.current = null
      onInitialFileConsumed?.()
    } finally {
      if (gen === filesGenRef.current) setLoadingFiles(false)
    }
    // onInitialFileConsumed is a notify-only callback; do not reload when its identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skillId drives reload
  }, [skillId, activeLanguage])

  const refreshFiles = useCallback(async () => {
    const list = (await ListSkillFiles(skillRef(skillId, activeLanguage))) ?? []
    setFiles(list)
    return list
  }, [skillId, activeLanguage])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const createParentDir = selectedDir ?? parentDirPath(selected)

  async function openCreateEntryDialog(kind: 'file' | 'dir') {
    if (kind === 'file' && dirty) {
      const proceed = await tryLeave()
      if (!proceed) return
    }
    setCreateEntryKind(kind)
    setCreateEntryName(kind === 'file' ? 'untitled.md' : 'docs')
    setCreateEntryParent(createParentDir)
    setCreateEntryError('')
  }

  function closeCreateEntryDialog() {
    if (creatingEntry) return
    setCreateEntryKind(null)
    setCreateEntryError('')
  }

  async function submitCreateEntry() {
    if (!createEntryKind) return
    if (!isValidLeafName(createEntryName)) {
      setCreateEntryError(createEntryKind === 'file' ? '文件名非法' : '文件夹名非法')
      return
    }
    const rel = joinSkillPath(createEntryParent, createEntryName.trim())
    setCreatingEntry(true)
    setCreateEntryError('')
    setError('')
    setStatus('')
    try {
      if (createEntryKind === 'file') {
        await CreateSkillFile(skillRef(skillId, activeLanguage), rel)
        await refreshFiles()
        setSelectedDir(null)
        setSelected(rel)
        setStatus(`已创建 ${rel}`)
      } else {
        await CreateSkillDir(skillRef(skillId, activeLanguage), rel)
        await refreshFiles()
        setSelectedDir(rel)
        setStatus(`已创建文件夹 ${rel}`)
      }
      setCreateEntryKind(null)
    } catch (e) {
      setCreateEntryError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreatingEntry(false)
    }
  }

  function openEntryAction(kind: 'rename' | 'delete', node: FileTreeNode) {
    if (node.kind === 'file' && node.path.replace(/\\/g, '/') === 'SKILL.md') {
      setError('技能根目录的 SKILL.md 不可重命名或删除')
      setStatus('')
      return
    }
    setEntryAction({kind, node})
    setRenameEntryName(node.name)
    setEntryActionError('')
  }

  function closeEntryAction() {
    if (mutatingEntry) return
    setEntryAction(null)
    setEntryActionError('')
  }

  async function submitEntryAction() {
    if (!entryAction) return
    const {kind, node} = entryAction
    if (kind === 'rename' && !isValidLeafName(renameEntryName)) {
      setEntryActionError(node.kind === 'file' ? '文件名非法' : '文件夹名非法')
      return
    }

    setMutatingEntry(true)
    setEntryActionError('')
    setError('')
    setStatus('')
    try {
      if (kind === 'rename') {
        if (dirty && pathIsWithin(selected, node.path)) {
          const saved = await handleSave()
          if (!saved) {
            setEntryActionError('保存当前文件失败，未执行重命名')
            return
          }
        }
        const nextPath = joinSkillPath(parentDirPath(node.path), renameEntryName.trim())
        await RenameSkillEntry(skillRef(skillId, activeLanguage), node.path, nextPath)
        await refreshFiles()
        if (selected && pathIsWithin(selected, node.path)) {
          setSelected(replacePathPrefix(selected, node.path, nextPath))
        }
        if (selectedDir && pathIsWithin(selectedDir, node.path)) {
          setSelectedDir(replacePathPrefix(selectedDir, node.path, nextPath))
        }
        setStatus(`已重命名为 ${nextPath}`)
      } else {
        await DeleteSkillEntry(skillRef(skillId, activeLanguage), node.path)
        const list = await refreshFiles()
        if (pathIsWithin(selected, node.path)) {
          const remaining = list.filter((path) => !path.endsWith('/'))
          const next =
            remaining.find((path) => path === 'SKILL.md' || path.endsWith('/SKILL.md')) ??
            remaining[0] ??
            null
          setSelected(next)
          setSelectedDir(null)
          if (!next) {
            setContent('')
            setSavedContent('')
          }
        } else if (pathIsWithin(selectedDir, node.path)) {
          setSelectedDir(null)
        }
        setStatus(`已删除 ${node.path}`)
      }
      setEntryAction(null)
    } catch (e) {
      setEntryActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setMutatingEntry(false)
    }
  }

  useEffect(() => {
    if (!selected) {
      setContent('')
      setSavedContent('')
      return
    }
    let cancelled = false
    setLoadingFile(true)
    setError('')
    setStatus('')
    void ReadSkillFile(skillRef(skillId, activeLanguage), selected)
      .then((text) => {
        if (cancelled) return
        const next = text ?? ''
        setContent(next)
        setSavedContent(next)
        setViewMode(isMarkdownPath(selected) ? 'preview' : 'source')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setContent('')
        setSavedContent('')
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false)
      })
    return () => {
      cancelled = true
    }
  }, [skillId, activeLanguage, selected])

  useEffect(() => {
    translationRequestRef.current += 1
    setTranslation(null)
    setTranslating(false)
  }, [selected, content])

  useEffect(() => {
    setStartingCopy(false)
    dismissToast()
  }, [skillId, dismissToast])

  useEffect(() => {
    if (translationTask?.active) {
      setStartingCopy(false)
    }
  }, [translationTask?.active])

  useEffect(() => {
    if (relatedTask?.tone === 'error' && relatedTask.message) {
      setError(relatedTask.message)
    }
  }, [relatedTask?.tone, relatedTask?.message])

  useEffect(() => {
    if (
      relatedTask?.tone !== 'success' ||
      !relatedTask.targetLanguage ||
      relatedTask.sourceID !== skillId
    ) {
      return
    }
    const completionKey = `${relatedTask.sourceID}:${relatedTask.targetLanguage}:${relatedTask.message}`
    if (completedTranslationRef.current === completionKey) return
    completedTranslationRef.current = completionKey
    setStartingCopy(false)
    const nextLanguage = relatedTask.targetLanguage
    void (async () => {
      await loadI18n(true)
      if (!dirtyRef.current) {
        setEditingLanguage(nextLanguage)
      }
    })()
  }, [
    loadI18n,
    relatedTask?.message,
    relatedTask?.sourceID,
    relatedTask?.targetLanguage,
    relatedTask?.tone,
    skillId,
  ])

  const fileTree = useMemo(() => buildFileTree(files), [files])

  function finishLeavePrompt(proceed: boolean) {
    setLeavePromptOpen(false)
    const resolve = leaveResolverRef.current
    leaveResolverRef.current = null
    resolve?.(proceed)
  }

  function askTranslatePrompt<T>(prompt: {kind: 'save'}): Promise<T> {
    return new Promise<T>((resolve) => {
      translatePromptResolverRef.current = resolve as (value: unknown) => void
      setTranslatePrompt(prompt)
    })
  }

  function finishTranslatePrompt(value: unknown) {
    setTranslatePrompt(null)
    const resolve = translatePromptResolverRef.current
    translatePromptResolverRef.current = null
    resolve?.(value)
  }

  async function handleSave(): Promise<boolean> {
    if (!selected) return false
    setSaving(true)
    setError('')
    setStatus('')
    try {
      await WriteSkillFile(skillRef(skillId, activeLanguage), selected, content)
      setSavedContent(content)
      setStatus('已保存')
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  const tryLeave = useCallback(async () => {
    if (!dirty) return true
    if (leavePromptOpen) return false
    return new Promise<boolean>((resolve) => {
      leaveResolverRef.current = resolve
      setLeavePromptOpen(true)
    })
  }, [dirty, leavePromptOpen])

  async function handleSelect(file: string) {
    if (file === selected) return
    if (dirty) {
      const proceed = await tryLeave()
      if (!proceed) return
    }
    setSelected(file)
  }

  async function openFileInSkill(file: string) {
    const filesOnly = files.filter((f) => !f.endsWith('/'))
    const focused = findSkillFile(file, filesOnly)
    if (!focused) {
      setError(`未找到文件：${file}`)
      return
    }
    setError('')
    setSelectedDir(null)
    await handleSelect(focused)
  }

  useImperativeHandle(ref, () => ({tryLeave, openFile: openFileInSkill}), [
    tryLeave,
    files,
    selected,
    dirty,
  ])

  async function handleNavigateFile(path: string) {
    const known = files.some((f) => f.replace(/\\/g, '/') === path.replace(/\\/g, '/'))
    if (!known) {
      setError(`未找到文件：${path}`)
      return
    }
    setError('')
    await handleSelect(path)
  }

  function handleNavigateHref(target: SkillHrefTarget) {
    if (target.kind === 'local') {
      void handleNavigateFile(target.path)
      return
    }
    if (target.skillId === skillId) {
      void handleNavigateFile(target.path)
      return
    }
    setError('')
    onOpenSkill(target.skillId, target.path)
  }

  async function handleTranslate() {
    if (translationBlocker) {
      logClientWarn('translate description blocked', translationBlocker)
      return
    }
    const requestID = ++translationRequestRef.current
    setTranslating(true)
    setError('')
    try {
      const cfg = await GetConfig()
      const text = await TranslateSkillDescription(description)
      if (translationRequestRef.current !== requestID) return
      setTranslation({
        language: cfg.translationTargetLanguage ?? 'zh-CN',
        text,
      })
    } catch (e) {
      if (translationRequestRef.current !== requestID) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (translationRequestRef.current === requestID) {
        setTranslating(false)
      }
    }
  }

  async function handleTranslateCopy() {
    if (!i18n?.defaultLanguage || translationBusy || translatePrompt) {
      logClientWarn(
        'translate copy blocked',
        !i18n?.defaultLanguage ? 'missing original language' : translationBusy ? 'busy' : 'prompt open',
      )
      return
    }
    if (dirty) {
      const shouldSave = await askTranslatePrompt<boolean>({kind: 'save'})
      if (!shouldSave) return
      const saved = await handleSave()
      if (!saved) return
    }
    setError('')
    setStartingCopy(true)
    try {
      await StartSkillTranslation(skillId)
    } catch (e) {
      setStartingCopy(false)
      const message = e instanceof Error ? e.message : String(e)
      const softTip =
        message.includes('目标语言与默认语言相同') ||
        message.includes('已存在') ||
        message.includes('请先设置原版语言') ||
        message.includes('仅支持 OpenAI 兼容引擎')
      showToast({message, tone: softTip ? 'warn' : 'error'})
    }
  }

  async function handleSetOriginalLanguage() {
    setSettingLanguage(true)
    setError('')
    try {
      await SetSkillOriginalLanguage(skillId, originalLanguage)
      await loadI18n()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSettingLanguage(false)
    }
  }

  function openRetagPrompt() {
    if (!i18n?.defaultLanguage) return
    setOriginalLanguage(i18n.defaultLanguage)
    setOriginalLanguageMenuOpen(false)
    setLanguageMenuOpen(false)
    setRetagPromptOpen(true)
  }

  async function handleRetagDefaultLanguage() {
    if (!i18n?.defaultLanguage) return
    if (originalLanguage === i18n.defaultLanguage) {
      setRetagPromptOpen(false)
      return
    }
    const previousDefault = i18n.defaultLanguage
    setSettingLanguage(true)
    setError('')
    try {
      await RetagSkillDefaultLanguage(skillId, originalLanguage)
      if (editingLanguage === previousDefault || !editingLanguage) {
        setEditingLanguage(originalLanguage)
      }
      setRetagPromptOpen(false)
      setOriginalLanguageMenuOpen(false)
      await loadI18n(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSettingLanguage(false)
    }
  }

  async function handleSwitchLanguage(language: string) {
    if (language === editingLanguage || !i18n?.defaultLanguage) {
      setLanguageMenuOpen(false)
      return
    }
    if (dirty && !(await tryLeave())) return
    setLanguageMenuOpen(false)
    setEditingLanguage(language)
  }

  async function handleSetDefaultLanguage() {
    if (!editingLanguage || editingLanguage === i18n?.defaultLanguage) return
    if (dirty && !(await tryLeave())) return
    setConfirmPrompt({kind: 'set-default', language: editingLanguage})
  }

  async function handleDeleteLanguage(language: string) {
    if (!i18n || language === i18n.defaultLanguage) return
    if (editingLanguage === language && dirty && !(await tryLeave())) return
    setLanguageMenuOpen(false)
    setConfirmPrompt({kind: 'delete-language', language})
  }

  async function confirmLanguageAction() {
    if (!confirmPrompt) return
    const prompt = confirmPrompt
    setConfirmPrompt(null)
    setSettingLanguage(true)
    setError('')
    try {
      if (prompt.kind === 'set-default') {
        await SetSkillDefaultLanguage(skillId, prompt.language)
        await loadI18n(true)
      } else {
        await DeleteSkillLanguage(skillId, prompt.language)
        if (editingLanguage === prompt.language) {
          setEditingLanguage(i18n?.defaultLanguage || '')
        }
        await loadI18n(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSettingLanguage(false)
    }
  }

  async function handleCancelTranslateCopy() {
    try {
      await CancelSkillTranslation()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="editor-page">
      <AppToast toast={toast} onDismiss={dismissToast} />
      {i18n && !i18n.defaultLanguage && !originalLanguagePromptDismissed ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="original-language-title"
          >
            <h2 id="original-language-title">选择原版语言</h2>
            <p className="muted dialog-confirm-body">
              指定后才能切换或创建语言版本，也可稍后设置。
            </p>
            <div className="field">
              <span>原版语言</span>
              <div className="field-select" ref={originalLanguageMenuRef}>
                <button
                  type="button"
                  className="field-select-trigger"
                  disabled={settingLanguage}
                  aria-haspopup="listbox"
                  aria-expanded={originalLanguageMenuOpen}
                  onClick={() => setOriginalLanguageMenuOpen((open) => !open)}
                >
                  {languageLabel(originalLanguage)}
                </button>
                {originalLanguageMenuOpen ? (
                  <ul className="field-select-menu" role="listbox">
                    {SKILL_LANGUAGES.map((language) => (
                      <li key={language.value} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={originalLanguage === language.value}
                          className={
                            originalLanguage === language.value ? 'is-active' : undefined
                          }
                          onClick={() => {
                            setOriginalLanguage(language.value)
                            setOriginalLanguageMenuOpen(false)
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
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={settingLanguage}
                onClick={() => {
                  setOriginalLanguageMenuOpen(false)
                  setOriginalLanguagePromptDismissed(true)
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={settingLanguage}
                onClick={() => void handleSetOriginalLanguage()}
              >
                {settingLanguage ? '设置中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {retagPromptOpen && i18n?.defaultLanguage ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="retag-language-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="retag-language-title">更改原版语言</h2>
            <p className="muted dialog-confirm-body">
              仅修正语言标签，不会移动或改写 skill 内容。当前原版：
              {languageLabel(i18n.defaultLanguage)}。
            </p>
            <div className="field">
              <span>原版语言</span>
              <div className="field-select" ref={originalLanguageMenuRef}>
                <button
                  type="button"
                  className="field-select-trigger"
                  disabled={settingLanguage}
                  aria-haspopup="listbox"
                  aria-expanded={originalLanguageMenuOpen}
                  onClick={() => setOriginalLanguageMenuOpen((open) => !open)}
                >
                  {languageLabel(originalLanguage)}
                </button>
                {originalLanguageMenuOpen ? (
                  <ul className="field-select-menu" role="listbox">
                    {SKILL_LANGUAGES.map((language) => {
                      const occupied =
                        language.value !== i18n.defaultLanguage &&
                        (i18n.languages ?? []).includes(language.value)
                      return (
                        <li key={language.value} role="presentation">
                          <button
                            type="button"
                            role="option"
                            aria-selected={originalLanguage === language.value}
                            className={
                              originalLanguage === language.value ? 'is-active' : undefined
                            }
                            disabled={occupied}
                            title={occupied ? '该语言版本已存在' : undefined}
                            onClick={() => {
                              setOriginalLanguage(language.value)
                              setOriginalLanguageMenuOpen(false)
                            }}
                          >
                            {language.label}
                            {occupied ? '（已有版本）' : ''}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={settingLanguage}
                onClick={() => {
                  setOriginalLanguageMenuOpen(false)
                  setRetagPromptOpen(false)
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  settingLanguage || originalLanguage === i18n.defaultLanguage
                }
                onClick={() => void handleRetagDefaultLanguage()}
              >
                {settingLanguage ? '更改中…' : '确认更改'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmPrompt ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="language-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="language-confirm-title">
              {confirmPrompt.kind === 'set-default' ? '设为默认版本？' : '删除翻译版本？'}
            </h2>
            <p className="muted dialog-confirm-body">
              {confirmPrompt.kind === 'set-default' ? (
                <>
                  确认将「{languageLabel(confirmPrompt.language)}」设为默认版本？
                </>
              ) : (
                <>
                  确认删除「{languageLabel(confirmPrompt.language)}」翻译版本？此操作无法撤销。
                </>
              )}
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={settingLanguage}
                onClick={() => setConfirmPrompt(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={
                  confirmPrompt.kind === 'delete-language' ? 'btn btn-danger' : 'btn btn-primary'
                }
                disabled={settingLanguage}
                onClick={() => void confirmLanguageAction()}
              >
                {settingLanguage
                  ? '处理中…'
                  : confirmPrompt.kind === 'delete-language'
                    ? '删除'
                    : '设为默认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {leavePromptOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-editor-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="leave-editor-title">保存更改？</h2>
            <p className="muted dialog-confirm-body">
              {selected ? (
                <>
                  <strong>{selected}</strong>
                  {' '}
                </>
              ) : (
                '当前文件'
              )}
              有未保存的更改，是否保存后再继续？
            </p>
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
                disabled={saving || !selected}
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

      {translatePrompt?.kind === 'save' ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="translate-save-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="translate-save-title">保存后再继续？</h2>
            <p className="muted dialog-confirm-body">
              当前文件有未保存修改。需先保存，再{createVersionLabel}。
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                onClick={() => finishTranslatePrompt(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => finishTranslatePrompt(true)}
              >
                保存并继续
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createEntryKind ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="create-entry-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-entry-title">
              {createEntryKind === 'file' ? '新建文件' : '新建文件夹'}
            </h2>
            <p className="muted">
              {createEntryParent
                ? `将创建于 ${createEntryParent}/`
                : '将创建于技能根目录'}
            </p>
            <label className="field">
              <span>{createEntryKind === 'file' ? '文件名' : '文件夹名'}</span>
              <input
                value={createEntryName}
                onChange={(e) => {
                  setCreateEntryName(e.target.value)
                  setCreateEntryError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void submitCreateEntry()
                  }
                }}
                placeholder={createEntryKind === 'file' ? '例如 notes.md' : '例如 docs'}
                autoFocus
                disabled={creatingEntry}
              />
            </label>
            {createEntryError ? <div className="dialog-error">{createEntryError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={creatingEntry}
                onClick={closeCreateEntryDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creatingEntry || !createEntryName.trim()}
                onClick={() => void submitCreateEntry()}
              >
                {creatingEntry ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {entryAction ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-labelledby="entry-action-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="entry-action-title">
              {entryAction.kind === 'rename'
                ? `重命名${entryAction.node.kind === 'file' ? '文件' : '文件夹'}`
                : `删除${entryAction.node.kind === 'file' ? '文件' : '文件夹'}？`}
            </h2>
            {entryAction.kind === 'rename' ? (
              <>
                <p className="muted">当前位置：{entryAction.node.path}</p>
                <label className="field">
                  <span>{entryAction.node.kind === 'file' ? '文件名' : '文件夹名'}</span>
                  <input
                    value={renameEntryName}
                    onChange={(event) => {
                      setRenameEntryName(event.target.value)
                      setEntryActionError('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void submitEntryAction()
                      }
                    }}
                    autoFocus
                    disabled={mutatingEntry}
                  />
                </label>
                {dirty && pathIsWithin(selected, entryAction.node.path) ? (
                  <p className="muted">当前文件有未保存更改，重命名前会先保存。</p>
                ) : null}
              </>
            ) : (
              <p className="dialog-confirm-body">
                将永久删除{' '}
                <strong>{entryAction.node.path}</strong>
                {' '}
                {entryAction.node.kind === 'dir'
                  ? '及其中的所有内容，此操作无法撤销。'
                  : '，此操作无法撤销。'}
                {dirty && pathIsWithin(selected, entryAction.node.path)
                  ? ' 当前文件的未保存更改也会丢失。'
                  : ''}
              </p>
            )}
            {entryActionError ? <div className="dialog-error">{entryActionError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={mutatingEntry}
                onClick={closeEntryAction}
              >
                取消
              </button>
              <button
                type="button"
                className={
                  entryAction.kind === 'delete' ? 'btn btn-danger' : 'btn btn-primary'
                }
                disabled={
                  mutatingEntry ||
                  (entryAction.kind === 'rename' && !renameEntryName.trim())
                }
                onClick={() => void submitEntryAction()}
              >
                {mutatingEntry
                  ? entryAction.kind === 'rename'
                    ? '重命名中…'
                    : '删除中…'
                  : entryAction.kind === 'rename'
                    ? '重命名'
                    : '删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="page-toolbar">
        <button type="button" className="btn" onClick={onBack}>
          返回
        </button>
        <span className="editor-skill-id" title={skillId}>
          {skillId}
        </span>
        <div className="field-select editor-lang-select" ref={languageMenuRef}>
          <button
            type="button"
            className="field-select-trigger"
            disabled={settingLanguage || !i18n}
            aria-haspopup="listbox"
            aria-expanded={languageMenuOpen}
            aria-label={
              i18n && !i18n.defaultLanguage ? '设置原版语言' : '切换语言版本'
            }
            title={
              i18n && !i18n.defaultLanguage
                ? '尚未设置原版语言，点击进行设置'
                : undefined
            }
            onClick={() => {
              if (i18n && !i18n.defaultLanguage) {
                setOriginalLanguagePromptDismissed(false)
                return
              }
              setLanguageMenuOpen((open) => !open)
            }}
          >
            {languageLabel(activeLanguage)}
          </button>
          {languageMenuOpen ? (
            <ul className="field-select-menu" role="listbox">
              {(i18n?.languages.length ? i18n.languages : [i18n?.defaultLanguage ?? '']).map(
                (language) => (
                  <li key={language || 'unset'} role="presentation" className="editor-lang-option">
                    <button
                      type="button"
                      role="option"
                      aria-selected={language === activeLanguage}
                      className={language === activeLanguage ? 'is-active' : undefined}
                      disabled={settingLanguage || !language}
                      onClick={() => void handleSwitchLanguage(language)}
                    >
                      {languageLabel(language)}
                      {language === i18n?.defaultLanguage ? '（默认）' : ''}
                    </button>
                    {language && language !== i18n?.defaultLanguage ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={settingLanguage}
                        aria-label={`删除 ${languageLabel(language)}`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          void handleDeleteLanguage(language)
                        }}
                      >
                        删除
                      </button>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          ) : null}
        </div>
        {i18n?.defaultLanguage ? (
          <button
            type="button"
            className="btn btn-icon"
            disabled={settingLanguage || retagPromptOpen}
            title="更改原版语言"
            aria-label="更改原版语言"
            onClick={openRetagPrompt}
          >
            <IconPencil size={20} />
          </button>
        ) : null}
        {editingLanguage && editingLanguage !== i18n?.defaultLanguage ? (
          <button
            type="button"
            className="btn"
            disabled={settingLanguage}
            onClick={() => void handleSetDefaultLanguage()}
          >
            设为默认版本
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selected || saving || loadingFile || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          className="btn btn-icon"
          disabled={saving || loadingFiles || translationBusy || !i18n?.defaultLanguage}
          title={
            !i18n?.defaultLanguage
              ? '请先选择原版语言'
              : copyTranslating || startingCopy
                ? '创建中…'
                : translationBusy
                  ? '已有创建语言版本任务正在运行'
                  : createVersionLabel
          }
          aria-label={
            copyTranslating || startingCopy ? '创建中…' : createVersionLabel
          }
          onClick={() => void handleTranslateCopy()}
        >
          <IconCopyPlus size={22} />
        </button>
        {copyTranslating ? (
          <button type="button" className="btn" onClick={() => void handleCancelTranslateCopy()}>
            取消创建
          </button>
        ) : null}
        {status ? <span className="muted">{status}</span> : null}
        {copyStatus ? <span className="muted">{copyStatus}</span> : null}
        {dirty ? <span className="muted">未保存</span> : null}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="editor-layout">
        <aside className="editor-files">
          <div className="editor-files-head">
            <div className="editor-files-title">文件</div>
            <div className="editor-files-actions">
              <button
                type="button"
                disabled={loadingFiles || creatingEntry}
                title={
                  createParentDir
                    ? `在 ${createParentDir}/ 下新建文件`
                    : '在根目录新建文件'
                }
                aria-label="新建文件"
                onClick={() => void openCreateEntryDialog('file')}
              >
                <NewFileActionIcon />
              </button>
              <button
                type="button"
                disabled={loadingFiles || creatingEntry}
                title={
                  createParentDir
                    ? `在 ${createParentDir}/ 下新建文件夹`
                    : '在根目录新建文件夹'
                }
                aria-label="新建文件夹"
                onClick={() => void openCreateEntryDialog('dir')}
              >
                <NewFolderActionIcon />
              </button>
            </div>
          </div>
          {loadingFiles ? (
            <p className="muted">加载中…</p>
          ) : (
            <FileTree
              nodes={fileTree}
              selected={selected}
              selectedDir={selectedDir}
              onSelectFile={(path) => {
                setSelectedDir(null)
                void handleSelect(path)
              }}
              onSelectDir={(path) => setSelectedDir(path)}
              onRename={(node) => openEntryAction('rename', node)}
              onDelete={(node) => openEntryAction('delete', node)}
            />
          )}
        </aside>
        <div className="editor-pane">
          {selected && !loadingFile && isMarkdownPath(selected) ? (
            <div className="editor-pane-toolbar">
              <div className="view-mode-toggle" role="group" aria-label="内容显示模式">
                <button
                  type="button"
                  className={viewMode === 'preview' ? 'active' : undefined}
                  onClick={() => setViewMode('preview')}
                >
                  预览
                </button>
                <button
                  type="button"
                  className={viewMode === 'split' ? 'active' : undefined}
                  onClick={() => setViewMode('split')}
                >
                  分屏
                </button>
                <button
                  type="button"
                  className={viewMode === 'source' ? 'active' : undefined}
                  onClick={() => setViewMode('source')}
                >
                  源码
                </button>
              </div>
            </div>
          ) : null}
          {!selected ? (
            <p className="muted">请选择左侧文件</p>
          ) : loadingFile ? (
            <p className="muted">读取中…</p>
          ) : viewMode === 'split' && isMarkdownPath(selected) ? (
            <div className="editor-split-container">
              <div className="editor-split-pane">
                <CodeEditor
                  key={selected}
                  path={selected}
                  value={content}
                  onChange={(next) => {
                    setContent(next)
                    setStatus('')
                  }}
                  aria-label={`编辑 ${selected}`}
                />
              </div>
              <div className="editor-split-pane">
                <MarkdownPreview
                  content={content}
                  translatedDescription={translation}
                  descriptionTranslate={
                    isSkillMD
                      ? {
                          busy: translating,
                          disabledReason: translationBlocker || undefined,
                          onClick: () => void handleTranslate(),
                        }
                      : null
                  }
                  currentPath={selected}
                  files={files}
                  onNavigateHref={handleNavigateHref}
                  aria-label={`预览 ${selected}`}
                />
              </div>
            </div>
          ) : viewMode === 'source' || !isMarkdownPath(selected) ? (
            <CodeEditor
              key={selected}
              path={selected}
              value={content}
              onChange={(next) => {
                setContent(next)
                setStatus('')
              }}
              aria-label={`编辑 ${selected}`}
            />
          ) : (
            <MarkdownPreview
              content={content}
              translatedDescription={translation}
              descriptionTranslate={
                isSkillMD
                  ? {
                      busy: translating,
                      disabledReason: translationBlocker || undefined,
                      onClick: () => void handleTranslate(),
                    }
                  : null
              }
              currentPath={selected}
              files={files}
              onNavigateHref={handleNavigateHref}
              aria-label={`预览 ${selected}`}
            />
          )}
        </div>
      </div>
    </div>
  )
})

export default EditorPage
