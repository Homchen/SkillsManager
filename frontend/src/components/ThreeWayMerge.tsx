import {useEffect, useMemo, useRef, useState} from 'react'
import {changeToRows, joinLines, splitLines, type ChangeRow} from '../lib/lineDiff'
import {
  blocksToText,
  buildInitialBlocks,
  type Block,
  type ConflictBlock,
} from '../lib/mergeBlocks'
import {IconCheck, IconRotateCcw} from './icons'

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
      {/* 紧凑整合的控制与状态工具栏 */}
      <div className="three-merge-toolbar">
        <div className="three-merge-actions">
          <button
            type="button"
            className="merge-quick-btn accept-all-a"
            disabled={disabled || conflictCount === 0}
            onClick={() => acceptAll('a')}
            title="将所有冲突块均替换为侧 A（源仓版）"
          >
            <span className="side-dot side-a-dot" />
            <span>全部采纳侧 A</span>
          </button>
          <button
            type="button"
            className="merge-quick-btn accept-all-b"
            disabled={disabled || conflictCount === 0}
            onClick={() => acceptAll('b')}
            title="将所有冲突块均替换为侧 B（待迁入版）"
          >
            <span className="side-dot side-b-dot" />
            <span>全部采纳侧 B</span>
          </button>
        </div>

        <div className="three-merge-legend">
          <span className="legend-item">
            <span className="legend-swatch del" />
            <span className="legend-text">− 仅侧 A</span>
          </span>
          <span className="legend-item">
            <span className="legend-swatch ins" />
            <span className="legend-text">+ 仅侧 B</span>
          </span>
          <span className="legend-summary">{fileSummary}</span>
        </div>

        <div className="three-merge-status">
          {conflictCount === 0 ? (
            <span className="merge-status-badge is-done">
              <IconCheck size={13} />
              <span>无差异块</span>
            </span>
          ) : unresolvedCount > 0 ? (
            <span className="merge-status-badge is-pending">
              未解决 {unresolvedCount} / {conflictCount} 块
            </span>
          ) : (
            <span className="merge-status-badge is-done">
              <IconCheck size={13} />
              <span>已解决全部 {conflictCount} 块</span>
            </span>
          )}
        </div>
      </div>

      {/* 表头与内容共用同一套列轨道，避免标题栏与正文错位 */}
      <div className="three-merge-body">
        <div className="three-merge-headers">
          <div className="header-pane header-a">
            <span className="side-dot side-a-dot" />
            <span className="header-title">侧 A · 源仓目标</span>
            <span className="header-sub">Current</span>
          </div>
          <div className="header-gutter" aria-hidden="true" />
          <div className="header-pane header-result">
            <span className="header-title">最终合并结果</span>
            <span className="header-sub">可直接编辑混排</span>
          </div>
          <div className="header-gutter" aria-hidden="true" />
          <div className="header-pane header-b">
            <span className="side-dot side-b-dot" />
            <span className="header-title">侧 B · 待迁入来源</span>
            <span className="header-sub">Incoming</span>
          </div>
        </div>

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
  const aText = joinLines(block.a)
  const bText = joinLines(block.b)
  const resText = joinLines(block.result)

  const isAdoptedA = block.resolved && resText === aText
  const isAdoptedB = block.resolved && resText === bText
  const isCustom = block.resolved && !isAdoptedA && !isAdoptedB

  return (
    <div
      className={`merge-block-row conflict ${
        block.resolved ? 'resolved' : 'unresolved'
      } ${isAdoptedA ? 'adopted-a' : ''} ${isAdoptedB ? 'adopted-b' : ''} ${
        isCustom ? 'adopted-custom' : ''
      }`}
    >
      <div className="merge-cell pane-a">
        <ConflictChunkA block={block} />
      </div>

      <div className="merge-cell gutter gutter-a">
        {block.a.length > 0 ? (
          <div className="gutter-actions">
            <button
              type="button"
              className={`gutter-btn accept-a ${isAdoptedA ? 'is-active' : ''}`}
              title={isAdoptedA ? '已采纳侧 A 内容' : '采纳侧 A 内容'}
              disabled={disabled}
              onClick={onAcceptA}
            >
              {isAdoptedA ? <IconCheck size={12} /> : '≫'}
            </button>
            {block.resolved ? (
              <button
                type="button"
                className="gutter-btn reset"
                title="清除此块结果"
                disabled={disabled}
                onClick={onClear}
              >
                <IconRotateCcw size={11} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="merge-cell pane-result">
        <ConflictChunkResult
          block={block}
          isAdoptedA={isAdoptedA}
          isAdoptedB={isAdoptedB}
          isCustom={isCustom}
          disabled={disabled}
          onEdit={onEdit}
        />
      </div>

      <div className="merge-cell gutter gutter-b">
        {block.b.length > 0 ? (
          <div className="gutter-actions">
            <button
              type="button"
              className={`gutter-btn accept-b ${isAdoptedB ? 'is-active' : ''}`}
              title={isAdoptedB ? '已采纳侧 B 内容' : '采纳侧 B 内容'}
              disabled={disabled}
              onClick={onAcceptB}
            >
              {isAdoptedB ? <IconCheck size={12} /> : '≪'}
            </button>
            {block.resolved && block.a.length === 0 ? (
              <button
                type="button"
                className="gutter-btn reset"
                title="清除此块结果"
                disabled={disabled}
                onClick={onClear}
              >
                <IconRotateCcw size={11} />
              </button>
            ) : null}
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
    <div className="merge-chunk conflict-side conflict-side-a">
      {rows.map((row, i) => (
        <DiffLineA key={i} row={row} />
      ))}
    </div>
  )
}

function ConflictChunkB({block}: {block: ConflictBlock}) {
  const rows = changeToRows(block.a, block.b)
  return (
    <div className="merge-chunk conflict-side conflict-side-b">
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
  isAdoptedA,
  isAdoptedB,
  isCustom,
  disabled,
  onEdit,
}: {
  block: ConflictBlock
  isAdoptedA: boolean
  isAdoptedB: boolean
  isCustom: boolean
  disabled?: boolean
  onEdit: (text: string) => void
}) {
  const rowCount = Math.max(changeToRows(block.a, block.b).length, block.result.length, 1)
  let hint = '点击 ≫ 采纳侧 A，或 ≪ 采纳侧 B，亦可在此直接编辑'
  if (block.a.length === 0) {
    hint = '点击 ≪ 采纳侧 B 新增，亦可在此直接编辑'
  } else if (block.b.length === 0) {
    hint = '点击 ≫ 采纳侧 A 内容，亦可在此直接编辑'
  }

  return (
    <div
      className={`merge-chunk result ${block.resolved ? 'resolved' : 'unresolved'} ${
        isAdoptedA ? 'source-a' : ''
      } ${isAdoptedB ? 'source-b' : ''} ${isCustom ? 'source-custom' : ''}`}
    >
      <textarea
        className="merge-result-edit"
        rows={rowCount}
        disabled={disabled}
        value={joinLines(block.result)}
        placeholder={block.resolved ? undefined : hint}
        onChange={(e) => onEdit(e.target.value)}
        spellCheck={false}
      />
      {block.resolved ? (
        <span
          className="result-origin-badge"
          title={
            isAdoptedA
              ? '当前采用侧 A 内容'
              : isAdoptedB
                ? '当前采用侧 B 内容'
                : '自定义混排编辑'
          }
        >
          {isAdoptedA ? '已采纳 A' : isAdoptedB ? '已采纳 B' : '手工混排'}
        </span>
      ) : null}
    </div>
  )
}
