import {useEffect, useState, type KeyboardEvent as ReactKeyboardEvent} from 'react'
import {ancestorDirPaths, type FileTreeNode} from '../lib/fileTree'

type Props = {
  nodes: FileTreeNode[]
  selected: string | null
  selectedDir?: string | null
  onSelectFile: (path: string) => void
  onSelectDir?: (path: string) => void
  onRename?: (node: FileTreeNode) => void
  onDelete?: (node: FileTreeNode) => void
}

type ContextMenuState = {
  node: FileTreeNode
  x: number
  y: number
}

function Chevron({open}: {open: boolean}) {
  return (
    <svg
      className={`file-tree-chevron${open ? ' open' : ''}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="M4.25 2.5L7.75 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FolderIcon({open}: {open: boolean}) {
  return (
    <svg className="file-tree-icon folder" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      {open ? (
        <path
          fill="currentColor"
          d="M1 4.5A1.5 1.5 0 0 1 2.5 3H6l1.5 1.5H13.5A1.5 1.5 0 0 1 15 6v.5H2.15L1.3 13.1A1.5 1.5 0 0 1 1 12.5v-8Zm1.25 3H14.5l-.85 5.1A1.5 1.5 0 0 1 12.18 14H3.32a1.5 1.5 0 0 1-1.48-1.25L1.25 7.5Z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M1 3.5A1.5 1.5 0 0 1 2.5 2H6l1.5 1.5H13.5A1.5 1.5 0 0 1 15 5v7.5A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9Z"
        />
      )}
    </svg>
  )
}

function FileIcon() {
  return (
    <svg className="file-tree-icon file" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.5 1.5A1.5 1.5 0 0 0 2 3v10a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 14 13V5.5L10.5 1.5h-7Zm7 .75V5a.5.5 0 0 0 .5.5h2.75L10.5 2.25Z"
      />
    </svg>
  )
}

/** 与文件树同风格的「新建文件」图标（填充） */
export function NewFileActionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.5 1.5A1.5 1.5 0 0 0 2 3v10a1.5 1.5 0 0 0 1.5 1.5H8V13H3.5a.25.25 0 0 1-.25-.25V3c0-.14.11-.25.25-.25H9.25V5c0 .83.67 1.5 1.5 1.5h2.5v1H14V5.5L10.5 1.5h-7Z"
      />
      <path
        fill="currentColor"
        d="M11.25 9.25v2h-2v1.5h2v2h1.5v-2h2v-1.5h-2v-2h-1.5Z"
      />
    </svg>
  )
}

/** 与文件树同风格的「新建文件夹」图标（填充） */
export function NewFolderActionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1 3.5A1.5 1.5 0 0 1 2.5 2H6l1.5 1.5H12A1.5 1.5 0 0 1 13.5 5v1.25H2.25V3.5c0-.14.11-.25.25-.25H6.06l.97.97H12a.25.25 0 0 1 .25.25v.53H1.75A1.5 1.5 0 0 0 1 6.5v6A1.5 1.5 0 0 0 2.5 14H8v-1.5H2.5a.25.25 0 0 1-.25-.25v-6c0-.14.11-.25.25-.25H13.5V5A.25.25 0 0 0 13.25 4.75H7.06l-.97-.97H2.5a.25.25 0 0 0-.25.25V5Z"
      />
      <path
        fill="currentColor"
        d="M11.25 9.25v2h-2v1.5h2v2h1.5v-2h2v-1.5h-2v-2h-1.5Z"
      />
    </svg>
  )
}

function collectTopDirs(nodes: FileTreeNode[]): string[] {
  return nodes.filter((n) => n.kind === 'dir').map((n) => n.path)
}

function TreeNodeRow({
  node,
  depth,
  selected,
  selectedDir,
  expanded,
  onToggle,
  onSelectFile,
  onSelectDir,
  onOpenContextMenu,
}: {
  node: FileTreeNode
  depth: number
  selected: string | null
  selectedDir: string | null
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelectFile: (path: string) => void
  onSelectDir?: (path: string) => void
  onOpenContextMenu: (node: FileTreeNode, x: number, y: number) => void
}) {
  function openContextMenu(x: number, y: number) {
    if (node.kind === 'dir') onSelectDir?.(node.path)
    else onSelectFile(node.path)
    onOpenContextMenu(node, x, y)
  }

  function handleContextKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    openContextMenu(rect.left + 24, rect.top + rect.height)
  }

  if (node.kind === 'dir') {
    const open = expanded.has(node.path)
    const active = selectedDir === node.path
    return (
      <li role="treeitem" aria-expanded={open} aria-selected={active}>
        <button
          type="button"
          className={`file-tree-row dir${active ? ' active' : ''}`}
          style={{paddingLeft: 6 + depth * 12}}
          onClick={() => {
            onToggle(node.path)
            onSelectDir?.(node.path)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            openContextMenu(event.clientX, event.clientY)
          }}
          onKeyDown={handleContextKey}
        >
          <Chevron open={open} />
          <FolderIcon open={open} />
          <span className="file-tree-label">{node.name}</span>
        </button>
        {open && node.children && node.children.length > 0 ? (
          <ul className="file-tree-children" role="group">
            {node.children.map((child) => (
              <TreeNodeRow
                key={`${child.kind}:${child.path}`}
                node={child}
                depth={depth + 1}
                selected={selected}
                selectedDir={selectedDir}
                expanded={expanded}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
                onSelectDir={onSelectDir}
                onOpenContextMenu={onOpenContextMenu}
              />
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

  const active = selected === node.path
  return (
    <li role="treeitem" aria-selected={active}>
      <button
        type="button"
        className={`file-tree-row file${active ? ' active' : ''}`}
        style={{paddingLeft: 6 + depth * 12}}
        onClick={() => onSelectFile(node.path)}
        onContextMenu={(event) => {
          event.preventDefault()
          openContextMenu(event.clientX, event.clientY)
        }}
        onKeyDown={handleContextKey}
      >
        <span className="file-tree-chevron-spacer" />
        <FileIcon />
        <span className="file-tree-label">{node.name}</span>
      </button>
    </li>
  )
}

export default function FileTree({
  nodes,
  selected,
  selectedDir = null,
  onSelectFile,
  onSelectDir,
  onRename,
  onDelete,
}: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const next = new Set(collectTopDirs(nodes))
    for (const dir of ancestorDirPaths(selected)) next.add(dir)
    if (selectedDir) next.add(selectedDir)
    return next
  })

  useEffect(() => {
    const dirs = [
      ...ancestorDirPaths(selected),
      ...(selectedDir ? [selectedDir, ...ancestorDirPaths(selectedDir)] : []),
    ]
    if (dirs.length === 0) return
    setExpanded((prev) => {
      if (dirs.every((d) => prev.has(d))) return prev
      const next = new Set(prev)
      for (const dir of dirs) next.add(dir)
      return next
    })
  }, [selected, selectedDir])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  function openContextMenu(node: FileTreeNode, x: number, y: number) {
    const menuWidth = 168
    const menuHeight = 88
    setContextMenu({
      node,
      x: Math.max(6, Math.min(x, window.innerWidth - menuWidth - 6)),
      y: Math.max(6, Math.min(y, window.innerHeight - menuHeight - 6)),
    })
  }

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (nodes.length === 0) {
    return <p className="muted">暂无文件</p>
  }

  const protectRootSkill =
    Boolean(contextMenu) &&
    contextMenu!.node.kind === 'file' &&
    contextMenu!.node.path.replace(/\\/g, '/') === 'SKILL.md'
  const protectTitle = '技能根目录的 SKILL.md 不可重命名或删除'

  return (
    <div className="file-tree-wrap">
      <ul className="file-tree" role="tree">
        {nodes.map((node) => (
          <TreeNodeRow
            key={`${node.kind}:${node.path}`}
            node={node}
            depth={0}
            selected={selected}
            selectedDir={selectedDir}
            expanded={expanded}
            onToggle={toggle}
            onSelectFile={onSelectFile}
            onSelectDir={onSelectDir}
            onOpenContextMenu={openContextMenu}
          />
        ))}
      </ul>
      {contextMenu ? (
        <div
          className="file-tree-context-menu"
          role="menu"
          aria-label={`${contextMenu.node.name} 操作`}
          style={{left: contextMenu.x, top: contextMenu.y}}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            disabled={protectRootSkill}
            title={protectRootSkill ? protectTitle : undefined}
            onClick={() => {
              if (protectRootSkill) return
              setContextMenu(null)
              onRename?.(contextMenu.node)
            }}
          >
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={protectRootSkill}
            title={protectRootSkill ? protectTitle : undefined}
            onClick={() => {
              if (protectRootSkill) return
              setContextMenu(null)
              onDelete?.(contextMenu.node)
            }}
          >
            删除
          </button>
          {protectRootSkill ? (
            <div className="file-tree-context-hint">{protectTitle}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
