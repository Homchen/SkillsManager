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

const container = document.getElementById('root')
const root = createRoot(container!)

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
