export type FileTreeNode = {
  name: string
  /** 目录为相对路径（无尾斜杠）；文件为完整相对路径 */
  path: string
  kind: 'file' | 'dir'
  children?: FileTreeNode[]
}

type MutableNode = {
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: Map<string, MutableNode>
}

function compareNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'})
}

function freeze(node: MutableNode): FileTreeNode {
  if (node.kind === 'file') {
    return {name: node.name, path: node.path, kind: 'file'}
  }
  const children = [...(node.children?.values() ?? [])]
    .map(freeze)
    .sort(compareNodes)
  return {name: node.name, path: node.path, kind: 'dir', children}
}

/** 将扁平相对路径列表建成目录树（路径使用 `/`；空目录以尾斜杠标记）。 */
export function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: MutableNode = {name: '', path: '', kind: 'dir', children: new Map()}

  for (const raw of paths) {
    let rel = raw.replace(/\\/g, '/').replace(/^\/+/, '')
    const isDirMarker = rel.endsWith('/')
    rel = rel.replace(/\/+$/, '')
    if (!rel) continue
    const parts = rel.split('/').filter(Boolean)
    if (parts.length === 0) continue

    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const isFile = isLast && !isDirMarker
      const path = parts.slice(0, i + 1).join('/')
      if (!cur.children) cur.children = new Map()

      let next = cur.children.get(part)
      if (!next) {
        next = isFile
          ? {name: part, path, kind: 'file'}
          : {name: part, path, kind: 'dir', children: new Map()}
        cur.children.set(part, next)
      } else if (!isFile && next.kind === 'file') {
        // 同名冲突时优先保留目录语义（极少见）
        next = {name: part, path, kind: 'dir', children: new Map()}
        cur.children.set(part, next)
      }
      cur = next
    }
  }

  return [...(root.children?.values() ?? [])].map(freeze).sort(compareNodes)
}

/** 返回选中文件路径上的所有祖先目录 path。 */
export function ancestorDirPaths(filePath: string | null): string[] {
  if (!filePath) return []
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 1) return []
  const out: string[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(0, i + 1).join('/'))
  }
  return out
}

/** 文件所在目录；根文件返回空字符串。 */
export function parentDirPath(filePath: string | null): string {
  if (!filePath) return ''
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(0, idx) : ''
}
