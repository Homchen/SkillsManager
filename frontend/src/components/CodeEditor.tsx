import CodeMirror from '@uiw/react-codemirror'
import {useMemo} from 'react'
import {languageExtensionsForPath} from '../lib/languageForPath'

type Props = {
  path: string | null
  value: string
  onChange: (value: string) => void
  'aria-label'?: string
}

/** 受控源码编辑器。换文件请由父组件设置 key={path} 以清空 undo。 */
export default function CodeEditor({path, value, onChange, 'aria-label': ariaLabel}: Props) {
  // 不启用 lineWrapping：换行使行高无法预估，拖滚动条时 scrollHeight 边滚边变，滑块会离鼠标越来越远。
  const extensions = useMemo(() => languageExtensionsForPath(path), [path])

  return (
    <CodeMirror
      className="code-editor"
      value={value}
      height="100%"
      theme="light"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        tabSize: 2,
      }}
      extensions={extensions}
      onChange={onChange}
      aria-label={ariaLabel}
    />
  )
}
