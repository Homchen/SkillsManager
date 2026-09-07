import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles.css'
import App from './App'

const isProd = import.meta.env.PROD

if (import.meta.env.VITE_DISABLE_NATIVE_CONTEXT_MENU === 'true') {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
  })
}

// 禁用 WebView 页面缩放（Ctrl/Cmd + 滚轮）
document.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault()
  },
  {passive: false},
)

// 禁用把文件拖进窗口时的默认导航（避免整页被替换）
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// 禁用鼠标前进/后退键
window.addEventListener('mouseup', (e) => {
  if (e.button === 3 || e.button === 4) e.preventDefault()
})
window.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) e.preventDefault()
})

function isMod(e: KeyboardEvent) {
  return e.ctrlKey || e.metaKey
}

function keyOf(e: KeyboardEvent) {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

document.addEventListener('keydown', (e) => {
  const key = keyOf(e)

  // 缩放：Ctrl/Cmd + +/-/0
  if (isMod(e) && (key === '+' || key === '=' || key === '-' || key === '_' || key === '0')) {
    e.preventDefault()
    return
  }

  // 刷新：F5 / Ctrl/Cmd + R
  if (e.key === 'F5' || (isMod(e) && key === 'r')) {
    e.preventDefault()
    return
  }

  // 打印 / 另存为网页
  if (isMod(e) && (key === 'p' || key === 's')) {
    e.preventDefault()
    return
  }

  // 前进 / 后退：Alt+←/→、Cmd+[/]
  if (
    (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) ||
    (e.metaKey && (key === '[' || key === ']'))
  ) {
    e.preventDefault()
    return
  }

  // 正式版：DevTools / 查看源码
  if (isProd) {
    if (e.key === 'F12') {
      e.preventDefault()
      return
    }
    if (isMod(e) && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) {
      e.preventDefault()
      return
    }
    if (isMod(e) && key === 'u') {
      e.preventDefault()
    }
  }
})

// 滚动条显隐管理：进入可滚动区域或滚动时短暂显现，随后平滑淡出
const scrollbarRevealTimers = new WeakMap<Element, number>()

function triggerScrollbarReveal(target: Element, duration = 1200) {
  target.classList.add('has-scrollbar-reveal')

  const existingTimer = scrollbarRevealTimers.get(target)
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer)
  }

  const timer = window.setTimeout(() => {
    target.classList.remove('has-scrollbar-reveal')
    scrollbarRevealTimers.delete(target)
  }, duration)

  scrollbarRevealTimers.set(target, timer)
}

function canElementScroll(el: HTMLElement): boolean {
  // 必须实际产生可滚动溢出（容差 1px 避免浮点数舍入误差）
  const hasOverflowY = el.scrollHeight > el.clientHeight + 1
  const hasOverflowX = el.scrollWidth > el.clientWidth + 1
  if (!hasOverflowY && !hasOverflowX) return false

  const style = window.getComputedStyle(el)
  const oy = style.overflowY
  const ox = style.overflowX
  const canY = hasOverflowY && (oy === 'auto' || oy === 'scroll')
  const canX = hasOverflowX && (ox === 'auto' || ox === 'scroll')
  return canY || canX
}

function findScrollableContainer(start: Element | null): HTMLElement | null {
  let curr: Element | null = start
  while (curr && curr !== document.body && curr !== document.documentElement) {
    if (curr instanceof HTMLElement && canElementScroll(curr)) {
      return curr
    }
    curr = curr.parentElement
  }
  if (document.documentElement && canElementScroll(document.documentElement)) {
    return document.documentElement
  }
  return null
}

let activeScrollContainer: HTMLElement | null = null

// 鼠标进入新的可滚动区域时，让滚动条出现一下以提示当前位置与范围
window.addEventListener(
  'mouseover',
  (e) => {
    const rawTarget = e.target
    if (!(rawTarget instanceof Element)) return
    const container = findScrollableContainer(rawTarget)
    if (container !== activeScrollContainer) {
      activeScrollContainer = container
      if (container) {
        triggerScrollbarReveal(container, 1200)
      }
    }
  },
  {passive: true},
)

// 鼠标移出窗口时重置当前激活容器，下次重新移入时可再次触发
window.addEventListener('mouseleave', () => {
  activeScrollContainer = null
})

// 滚动时持续激活滚动条显现
window.addEventListener(
  'scroll',
  (e) => {
    const rawTarget = e.target
    const target =
      rawTarget === document || rawTarget === document.documentElement
        ? document.documentElement
        : rawTarget instanceof Element
          ? rawTarget
          : null

    if (!target) return
    if (target instanceof HTMLElement) {
      activeScrollContainer = target
    }
    triggerScrollbarReveal(target, 1000)
  },
  {capture: true, passive: true},
)

const container = document.getElementById('root')
const root = createRoot(container!)

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
