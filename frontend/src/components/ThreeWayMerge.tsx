import {useEffect, useMemo, useRef, useState} from 'react'
import {changeToRows, joinLines, splitLines, type ChangeRow} from '../lib/lineDiff'
import {
  blocksToText,
  buildInitialBlocks,
  type Block,
  type ConflictBlock,
} from '../lib/mergeBlocks'

export type MergeChangeMeta = {
  /** True only when every conflict hunk has an accepted/edited result. */
  fullyResolved: boolean
}

type Props = {
  textA: string
  textB: string
  value: string
  disabled?: boolean
  onChange: (merged: string, meta: MergeChangeMeta) => void
}

export default function ThreeWayMerge({textA, textB, value, disabled, onChange}: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => buildInitialBlocks(textA, textB, value))
  const sourceKey = useRef(`${textA}\0${textB}`)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // 仅在对比两侧变化时重建；value 清空时保留本地块状态，避免丢掉未提交的中间结果
  useEffect(() => {
    const key = `${textA}\0${textB}`
    if (sourceKey.current !== key) {
      sourceKey.current = key
      setBlocks(buildInitialBlocks(textA, textB, value))
    }
  }, [textA, textB, value])

  // 无冲突块（行级等价，如仅行尾空白/换行差）时自动形成文件决议，避免进度卡在 0/1。
  // 两侧皆空时跳过：切 skill 首帧常先挂载空文本，否则会误写成 keep_a。
  useEffect(() => {
    if (disabled) return
    if (textA === '' && textB === '') return
    if (blocks.some((b) => b.kind === 'conflict')) return
    onChangeRef.current(blocksToText(blocks), {fullyResolved: true})
  }, [blocks, disabled, textA, textB])

  const conflictBlocks = useMemo(
    () => blocks.filter((b): b is Block & {kind: 'conflict'} => b.kind === 'conflict'),
    [blocks],
  )
  const conflictCount = conflictBlocks.length
  const unresolvedCount = conflictBlocks.filter((b) => !b.resolved).length
  const fileSummary = useMemo(() => {
    let del = 0
    let ins = 0
    for (const b of conflictBlocks) {
      for (const r of changeToRows(b.a, b.b)) {
        if (r.kind === 'del') del++
        else ins++
      }
    }
    const parts: string[] = []
    if (del) parts.push(`删除 ${del} 行`)
    if (ins) parts.push(`新增 ${ins} 行`)
    return parts.length ? parts.join(' · ') : '无行级差异'
  }, [conflictBlocks])

  function commit(next: Block[]) {
    setBlocks(next)
    const unresolved = next.filter((b) => b.kind === 'conflict' && !b.resolved).length
    onChange(blocksToText(next), {fullyResolved: unresolved === 0})
  }

  function acceptSide(id: string, side: 'a' | 'b') {
    if (disabled) return
    commit(
      blocks.map((b) => {
        if (b.kind !== 'conflict' || b.id !== id) return b
        const result = side === 'a' ? [...b.a] : [...b.b]
        return {...b, result, resolved: true}
      }),
    )
  }

  function acceptAll(side: 'a' | 'b') {
    if (disabled) return
    commit(
      blocks.map((b) => {
        if (b.kind !== 'conflict') return b
        return {
          ...b,
          result: side === 'a' ? [...b.a] : [...b.b],
          resolved: true,
        }
      }),
    )
  }

  function clearConflict(id: string) {
    if (disabled) return
    commit(
      blocks.map((b) => {
        if (b.kind !== 'conflict' || b.id !== id) return b
        return {...b, result: [], resolved: false}
      }),
    )
  }

  function editConflictResult(id: string, text: string) {
    if (disabled) return
    const result = splitLines(text)
    commit(
      blocks.map((b) => {
        if (b.kind !== 'conflict' || b.id !== id) return b
        return {...b, result, resolved: result.length > 0}
      }),
    )
  }

  return (
    <div className="three-merge">
      <div className="three-merge-toolbar">
        <button
          type="button"
          className="btn"
          disabled={disabled || conflictCount === 0}
          onClick={() => acceptAll('a')}
        >
          全部接受 A
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || conflictCount === 0}
          onClick={() => acceptAll('b')}
        >
          全部接受 B
        </button>
        <span className="muted">
          {conflictCount === 0
            ? '无差异块'
            : unresolvedCount > 0
              ? `未解决 ${unresolvedCount}/${conflictCount} 块`
              : `已解决全部 ${conflictCount} 块`}
        </span>
      </div>
      <div className="three-merge-legend">
        <span className="legend-item">
          <span className="legend-swatch del" />− 删除（仅侧 A）
        </span>
        <span className="legend-item">
          <span className="legend-swatch ins" />+ 新增（仅侧 B）
        </span>
        <span className="muted legend-summary">{fileSummary}</span>
      </div>

      <div className="three-merge-headers">
        <div>侧 A</div>
        <div aria-hidden="true" />
        <div>结果</div>
        <div aria-hidden="true" />
        <div>侧 B</div>
      </div>

      {/* 按块分行：同一块五列共享行高，避免「行数×22px」与换行实际高度漂移 */}
      <div className="three-merge-body">
        {blocks.map((b) =>
          b.kind === 'equal' ? (
            <EqualBlockRow key={b.id} lines={b.lines} />
          ) : (
            <ConflictBlockRow
              key={b.id}
              block={b}
              disabled={disabled}
              onAcceptA={() => acceptSide(b.id, 'a')}
              onAcceptB={() => acceptSide(b.id, 'b')}
              onClear={() => clearConflict(b.id)}
              onEdit={(text) => editConflictResult(b.id, text)}
            />
          ),
        )}
      </div>
    </div>
  )
}

function EqualBlockRow({lines}: {lines: string[]}) {
  return (
    <div className="merge-block-row equal">
      <div className="merge-cell pane-a">
        <EqualChunk lines={lines} />
      </div>
      <div className="merge-cell gutter" aria-hidden="true" />
      <div className="merge-cell pane-result">
        <EqualChunk lines={lines} />
      </div>
      <div className="merge-cell gutter" aria-hidden="true" />
      <div className="merge-cell pane-b">
        <EqualChunk lines={lines} />
      </div>
    </div>
  )
}

function ConflictBlockRow({
  block,
  disabled,
  onAcceptA,
  onAcceptB,
  onClear,
  onEdit,
}: {
  block: ConflictBlock
  disabled?: boolean
  onAcceptA: () => void
  onAcceptB: () => void
  onClear: () => void
  onEdit: (text: string) => void
}) {
  return (
    <div className={`merge-block-row conflict ${block.resolved ? 'resolved' : 'unresolved'}`}>
      <div className="merge-cell pane-a">
        <ConflictChunkA block={block} />
      </div>
      <div className="merge-cell gutter">
        {block.a.length > 0 ? (
          <div className="gutter-actions">
            <button
              type="button"
              className="gutter-btn accept-a"
              title="接受侧 A"
              disabled={disabled}
              onClick={onAcceptA}
            >
              ≫
            </button>
            <button
              type="button"
              className="gutter-btn ignore"
              title="清空结果块"
              disabled={disabled}
              onClick={onClear}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
      <div className="merge-cell pane-result">
        <ConflictChunkResult block={block} disabled={disabled} onEdit={onEdit} />
      </div>
      <div className="merge-cell gutter">
        {block.b.length > 0 ? (
          <div className="gutter-actions">
            <button
              type="button"
              className="gutter-btn accept-b"
              title="接受侧 B"
              disabled={disabled}
              onClick={onAcceptB}
            >
              ≪
            </button>
            <button
              type="button"
              className="gutter-btn ignore"
              title="清空结果块"
              disabled={disabled}
              onClick={onClear}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
      <div className="merge-cell pane-b">
        <ConflictChunkB block={block} />
      </div>
    </div>
  )
}

function EqualChunk({lines}: {lines: string[]}) {
  return (
    <div className="merge-chunk equal">
      {lines.map((line, i) => (
        <div key={i} className="merge-line">
          <code>{line || '\u00a0'}</code>
        </div>
      ))}
    </div>
  )
}

function ConflictChunkA({block}: {block: ConflictBlock}) {
  const rows = changeToRows(block.a, block.b)
  return (
    <div className="merge-chunk conflict-side">
      {rows.map((row, i) => (
        <DiffLineA key={i} row={row} />
      ))}
    </div>
  )
}

function ConflictChunkB({block}: {block: ConflictBlock}) {
  const rows = changeToRows(block.a, block.b)
  return (
    <div className="merge-chunk conflict-side">
      {rows.map((row, i) => (
        <DiffLineB key={i} row={row} />
      ))}
    </div>
  )
}

function DiffLineA({row}: {row: ChangeRow}) {
  if (row.kind === 'ins') {
    return (
      <div className="merge-line gap-side" aria-hidden="true">
        <span className="diff-tag"> </span>
        <code>{'\u00a0'}</code>
      </div>
    )
  }
  return (
    <div className="merge-line line-del">
      <span className="diff-tag">−</span>
      <code>{row.a || '\u00a0'}</code>
    </div>
  )
}

function DiffLineB({row}: {row: ChangeRow}) {
  if (row.kind === 'del') {
    return (
      <div className="merge-line gap-side" aria-hidden="true">
        <span className="diff-tag"> </span>
        <code>{'\u00a0'}</code>
      </div>
    )
  }
  return (
    <div className="merge-line line-ins">
      <span className="diff-tag">+</span>
      <code>{row.b || '\u00a0'}</code>
    </div>
  )
}

function ConflictChunkResult({
  block,
  disabled,
  onEdit,
}: {
  block: ConflictBlock
  disabled?: boolean
  onEdit: (text: string) => void
}) {
  const rowCount = Math.max(changeToRows(block.a, block.b).length, block.result.length, 1)
  let hint = '点击 ≫ 用侧 A，≪ 用侧 B，或在此编辑混排结果'
  if (block.a.length === 0) {
    hint = '≪ 接受 B 的新增，或在此编辑'
  } else if (block.b.length === 0) {
    hint = '≫ 接受 A 的内容，或在此编辑'
  }
  return (
    <div className={`merge-chunk result ${block.resolved ? 'resolved' : 'unresolved'}`}>
      <textarea
        className="merge-result-edit"
        rows={rowCount}
        disabled={disabled}
        value={joinLines(block.result)}
        placeholder={block.resolved ? undefined : hint}
        onChange={(e) => onEdit(e.target.value)}
      />
    </div>
  )
}
