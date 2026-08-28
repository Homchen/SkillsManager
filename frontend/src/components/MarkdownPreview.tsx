import {createElement, useMemo, type MouseEvent, type ReactNode} from 'react'
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
import {parseSkillFrontmatter} from '../lib/skillFrontmatter'

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
  const {meta, body} = parseSkillFrontmatter(content)

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
      {Object.keys(meta).length > 0 ? (
        <dl className="md-frontmatter">
          {Object.entries(meta).map(([key, value]) => {
            const showTranslate =
              key === 'description' && Boolean(descriptionTranslate) && Boolean(value)
            return (
              <div key={key} className="md-frontmatter-row">
                <dt>
                  <span>{key}</span>
                  {showTranslate && descriptionTranslate ? (
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
                        翻译 description
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
                </dt>
                <dd>{value || '—'}</dd>
              </div>
            )
          })}
          {translatedDescription ? (
            <div className="md-frontmatter-row md-frontmatter-translation">
              <dt>翻译（{translatedDescription.language}）</dt>
              <dd>{translatedDescription.text}</dd>
            </div>
          ) : null}
        </dl>
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
