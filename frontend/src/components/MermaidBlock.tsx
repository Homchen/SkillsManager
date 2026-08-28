import {useEffect, useId, useState} from 'react'

type Props = {chart: string}

let mermaidInitPromise: Promise<typeof import('mermaid').default> | null = null

function loadMermaid() {
  if (!mermaidInitPromise) {
    mermaidInitPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default
      mermaid.initialize({startOnLoad: false, securityLevel: 'strict'})
      return mermaid
    })
  }
  return mermaidInitPromise
}

export default function MermaidBlock({chart}: Props) {
  const reactId = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setError(null)
    void (async () => {
      try {
        const mermaid = await loadMermaid()
        const id = `mermaid-${reactId}`
        const {svg: rendered} = await mermaid.render(id, chart)
        if (!cancelled) setSvg(rendered)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chart, reactId])

  if (error) {
    return (
      <div className="mermaid-error">
        <p>Mermaid 渲染失败：{error}</p>
        <pre>
          <code>{chart}</code>
        </pre>
      </div>
    )
  }
  if (!svg) return <p className="muted">图表渲染中…</p>
  return <div className="mermaid-block" dangerouslySetInnerHTML={{__html: svg}} />
}
