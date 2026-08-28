import {javascript} from '@codemirror/lang-javascript'
import {json} from '@codemirror/lang-json'
import {markdown} from '@codemirror/lang-markdown'
import {python} from '@codemirror/lang-python'
import {yaml, yamlFrontmatter} from '@codemirror/lang-yaml'
import {HighlightStyle, StreamLanguage, syntaxHighlighting} from '@codemirror/language'
import type {Extension} from '@codemirror/state'
import {tags} from '@lezer/highlight'
import {shell} from '@codemirror/legacy-modes/mode/shell'

export function isMarkdownPath(path: string | null): boolean {
  if (!path) return false
  const lower = path.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

function extOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path
  const i = base.lastIndexOf('.')
  if (i < 0) return ''
  return base.slice(i).toLowerCase()
}

/**
 * 基于 defaultHighlightStyle，但标题不加 underline。
 * 必须用非 fallback 的 HighlightStyle：basicSetup 的默认样式走 style-mod，
 * 用 `.tok-heading` theme 覆盖无效。
 */
const markdownHighlightStyle = HighlightStyle.define([
  {tag: tags.meta, color: '#404740'},
  {tag: tags.link, textDecoration: 'underline'},
  {tag: tags.heading, fontWeight: 'bold'},
  {tag: tags.emphasis, fontStyle: 'italic'},
  {tag: tags.strong, fontWeight: 'bold'},
  {tag: tags.strikethrough, textDecoration: 'line-through'},
  {tag: tags.keyword, color: '#708'},
  {tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName], color: '#219'},
  {tag: [tags.literal, tags.inserted], color: '#164'},
  {tag: [tags.string, tags.deleted], color: '#a11'},
  {tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: '#e40'},
  {tag: tags.definition(tags.variableName), color: '#00f'},
  {tag: tags.local(tags.variableName), color: '#30a'},
  {tag: [tags.typeName, tags.namespace], color: '#085'},
  {tag: tags.className, color: '#167'},
  {tag: [tags.special(tags.variableName), tags.macroName], color: '#256'},
  {tag: tags.definition(tags.propertyName), color: '#00c'},
  {tag: tags.comment, color: '#940'},
  {tag: tags.invalid, color: '#f00'},
])

function markdownExtensions(): Extension[] {
  // yamlFrontmatter：避免 frontmatter 结尾 --- 被当成 Setext 标题底线
  return [
    yamlFrontmatter({content: markdown()}),
    syntaxHighlighting(markdownHighlightStyle),
  ]
}

export function languageExtensionsForPath(path: string | null): Extension[] {
  if (!path) return []
  switch (extOf(path)) {
    case '.md':
    case '.markdown':
      return markdownExtensions()
    case '.json':
      return [json()]
    case '.yml':
    case '.yaml':
      return [yaml()]
    case '.js':
    case '.mjs':
    case '.cjs':
      return [javascript()]
    case '.ts':
      return [javascript({typescript: true})]
    case '.tsx':
      return [javascript({typescript: true, jsx: true})]
    case '.py':
      return [python()]
    case '.sh':
    case '.bash':
    case '.zsh':
      return [StreamLanguage.define(shell)]
    default:
      return []
  }
}
