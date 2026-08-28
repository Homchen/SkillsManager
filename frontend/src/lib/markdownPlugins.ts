import type {Components} from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import {remarkAlert} from 'remark-github-blockquote-alert'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import type {ReactElement, ReactNode} from 'react'
import {Children, createElement, isValidElement} from 'react'
import MermaidBlock from '../components/MermaidBlock'

export const markdownRemarkPlugins = [remarkGfm, remarkMath, remarkAlert]
export const markdownRehypePlugins = [rehypeKatex, rehypeHighlight]

/** Collect text from React children, recursing into element props.children. */
export function textFromChildren(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textFromChildren).join('')
  if (isValidElement(children)) {
    return textFromChildren((children.props as {children?: ReactNode}).children)
  }
  return ''
}

/** True for http(s) and protocol-relative URLs; false for # / relative / other schemes. */
export function isExternalHref(href: string | undefined): boolean {
  if (!href) return false
  return /^(https?:)?\/\//i.test(href)
}

function isMermaidCodeElement(node: ReactNode): node is ReactElement<{className?: string; children?: ReactNode}> {
  if (!isValidElement(node)) return false
  const className = (node.props as {className?: string}).className ?? ''
  return /language-mermaid/.test(className)
}

function isMermaidBlockElement(node: ReactNode): boolean {
  return isValidElement(node) && node.type === MermaidBlock
}

export const markdownComponents: Components = {
  a: ({href, children, ...props}) => {
    const external = isExternalHref(href)
    return createElement(
      'a',
      {
        ...props,
        href,
        ...(external ? {target: '_blank', rel: 'noopener noreferrer'} : {}),
      },
      children,
    )
  },
  // Detect mermaid on `pre` so rehype-highlight does not leave fences stuck in a dark code block.
  pre: ({children, ...props}) => {
    const kids = Children.toArray(children)
    if (kids.length === 1 && isMermaidBlockElement(kids[0])) {
      return kids[0]
    }
    if (kids.length === 1 && isMermaidCodeElement(kids[0])) {
      const chart = textFromChildren(kids[0].props.children).replace(/\n$/, '')
      return createElement(MermaidBlock, {chart})
    }
    return createElement('pre', props, children)
  },
  // Leave mermaid as normal <code>; only `pre` unwraps to MermaidBlock.
  code: ({className, children, ...props}) =>
    createElement('code', {className, ...props}, children),
}
