export type FileGlyphKind =
  | 'dir'
  | 'skill'
  | 'markdown'
  | 'code'
  | 'json'
  | 'html'
  | 'style'
  | 'data'
  | 'image'
  | 'file'

const CODE_EXT = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
])
const JSON_EXT = new Set(['.json', '.jsonc'])
const HTML_EXT = new Set(['.html', '.htm', '.svg'])
const STYLE_EXT = new Set(['.css', '.scss', '.less'])
const DATA_EXT = new Set(['.yml', '.yaml', '.toml', '.csv', '.xml'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'])
const MD_EXT = new Set(['.md', '.markdown'])

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

function extOf(path: string): string {
  const base = fileName(path)
  const i = base.lastIndexOf('.')
  if (i < 0) return ''
  return base.slice(i).toLowerCase()
}

export function fileGlyphKind(path: string, kind: 'file' | 'dir' = 'file'): FileGlyphKind {
  if (kind === 'dir') return 'dir'
  if (fileName(path).toLowerCase() === 'skill.md') return 'skill'
  const ext = extOf(path)
  if (MD_EXT.has(ext)) return 'markdown'
  if (CODE_EXT.has(ext)) return 'code'
  if (JSON_EXT.has(ext)) return 'json'
  if (HTML_EXT.has(ext)) return 'html'
  if (STYLE_EXT.has(ext)) return 'style'
  if (DATA_EXT.has(ext)) return 'data'
  if (IMAGE_EXT.has(ext)) return 'image'
  return 'file'
}
