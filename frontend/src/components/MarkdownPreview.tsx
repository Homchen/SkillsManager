import {createElement, useEffect, useMemo, useState, type MouseEvent, type ReactNode} from 'react'
import Markdown, {type Components} from 'react-markdown'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'
import 'remark-github-blockquote-alert/alert.css'
import {
  isExternalHref,
  markdownComponents,
  markdownRehypePlugins,
  markdownRemarkPlugins,
} from '../lib/markdownPlugins'
import {
  findSkillFile,
  resolveSkillHref,
  type SkillHrefTarget,
} from '../lib/skillRelativeHref'
import {parseSkillFrontmatter, splitSkillMeta} from '../lib/skillFrontmatter'

export type DescriptionTranslateAction = {
  busy: boolean
  disabledReason?: string
  onClick: () => void
}

type Props = {
  content: string
  translatedDescription?: {language: string; text: string} | null
  /** Optional row-end action for SKILL.md description try-translate. */
  descriptionTranslate?: DescriptionTranslateAction | null
  'aria-label'?: string
  /** Current skill-relative file path; required for relative link navigation. */
  currentPath?: string | null
  /** Known skill file paths (forward slashes). */
  files?: string[]
  /** Navigate to a local file or sibling skill from a markdown link. */
  onNavigateHref?: (target: SkillHrefTarget) => void
}

export default function MarkdownPreview({
  content,
  translatedDescription,
  descriptionTranslate = null,
  'aria-label': ariaLabel,
  currentPath,
  files,
  onNavigateHref,
}: Props) {
  const {meta, body} = useMemo(() => parseSkillFrontmatter(content), [content])
  const {name, description, chips} = useMemo(() => splitSkillMeta(meta), [meta])
  const [descExpanded, setDescExpanded] = useState(false)
  const descLong = description.length > 160 || description.includes('\n')
  const hasMeta = Boolean(name || description || chips.length > 0 || translatedDescription)

  useEffect(() => {
    setDescExpanded(false)
  }, [content])

  const components = useMemo((): Components => {
    if (!currentPath || !onNavigateHref) return markdownComponents
    const fileList = files ?? []
    return {
      ...markdownComponents,
      a: ({href, children, ...props}) => {
        const external = isExternalHref(href)
        return createElement(
          'a',
          {
            ...props,
            href,
            ...(external ? {target: '_blank', rel: 'noopener noreferrer'} : {}),
            onClick: (e: MouseEvent<HTMLAnchorElement>) => {
              if (external) return
              if (!href || href.startsWith('#')) return
              const resolved = resolveSkillHref(currentPath, href)
              if (!resolved) {
                e.preventDefault()
                return
              }
              e.preventDefault()
              if (resolved.kind === 'local') {
                const matched = findSkillFile(resolved.path, fileList)
                onNavigateHref({kind: 'local', path: matched ?? resolved.path})
                return
              }
              onNavigateHref(resolved)
            },
          },
          children as ReactNode,
        )
      },
    }
  }, [currentPath, files, onNavigateHref])

  return (
    <div className="markdown-preview" aria-label={ariaLabel}>
      {hasMeta ? (
        <header className="md-skill-masthead">
          {name ? <p className="md-skill-name">{name}</p> : null}
          {description ? (
            <div className="md-skill-desc">
              <div className="md-skill-desc-copy">
                <p className={descLong && !descExpanded ? 'is-clamped' : undefined}>
                  {description}
                </p>
                {descLong ? (
                  <button
                    type="button"
                    className="md-skill-desc-more"
                    onClick={() => setDescExpanded((open) => !open)}
                  >
                    {descExpanded ? '收起' : '展开'}
                  </button>
                ) : null}
              </div>
              {descriptionTranslate ? (
                <div className="md-frontmatter-action">
                  <button
                    type="button"
                    className="md-frontmatter-action-link"
                    disabled={
                      descriptionTranslate.busy ||
                      Boolean(descriptionTranslate.disabledReason)
                    }
                    aria-busy={descriptionTranslate.busy}
                    title={
                      descriptionTranslate.disabledReason ||
                      (descriptionTranslate.busy
                        ? '正在翻译 description…'
                        : '按当前设置翻译 description')
                    }
                    onClick={() => descriptionTranslate.onClick()}
                  >
                    {descriptionTranslate.busy ? '翻译中…' : '翻译描述'}
                  </button>
                  {descriptionTranslate.busy ? (
                    <span
                      className="md-frontmatter-spinner"
                      role="status"
                      aria-label="正在翻译"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {translatedDescription ? (
            <aside className="md-skill-translation">
              <span className="md-skill-translation-lang">
                {translatedDescription.language}
              </span>
              <p>{translatedDescription.text}</p>
            </aside>
          ) : null}
          {chips.length > 0 ? (
            <ul className="md-skill-chips">
              {chips.map((chip) => (
                <li key={chip.key} title={`${chip.key}: ${chip.value}`}>
                  <span className="md-skill-chip-key">{chip.key}</span>
                  <span className="md-skill-chip-value">{chip.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </header>
      ) : null}
      <Markdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={components}
      >
        {body}
      </Markdown>
    </div>
  )
}
