import {useCallback, useId, useMemo, useRef, useState} from 'react'
import {buildSmoothPath} from '../lib/skillUsage'

type Point = {date: string; count: number}

type Props = {
  points: Point[]
  emptyLabel?: string
  smooth?: boolean
  showAverage?: boolean
  showPeak?: boolean
  skillName?: string
  isFullscreen?: boolean
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 将粗糙步长收成 1 / 2 / 5 × 10^n（次数为整数，步长至少为 1）。 */
function niceStep(rough: number): number {
  const r = Math.max(rough, 1)
  const exp = Math.floor(Math.log10(r))
  const mag = 10 ** exp
  const norm = r / mag
  const niceNorm = norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10
  return Math.max(1, niceNorm * mag)
}

/** 按范围内最高日用量动态计算 Y 轴刻度 */
function buildYScale(rawMax: number): {yMax: number; ticks: number[]} {
  const peak = Math.max(0, Math.ceil(rawMax))
  const padded = peak <= 0 ? 4 : Math.max(Math.ceil(peak * 1.25), peak + 2)

  const targetIntervals =
    peak <= 0 ? 4 : Math.min(6, Math.max(4, Math.ceil(Math.log2(padded + 1) + 2)))

  const step = niceStep(padded / targetIntervals)
  let yMax = Math.ceil(padded / step) * step
  if (yMax <= peak) yMax += step

  const ticks: number[] = []
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    ticks.push(Math.round(v))
  }
  return {yMax, ticks}
}

/** 按点数动态选取 X 轴标签索引：≤7 全显，约 30 天 5 个，更长 7 个，全屏大屏下适当增加显示密度，强制含首尾。 */
function xLabelIndexes(length: number, isFullscreen = false): number[] {
  if (length <= 0) return []
  if (length === 1) return [0]
  if (length <= 7) return Array.from({length}, (_, i) => i)

  let count = length <= 35 ? 5 : 7
  if (isFullscreen) {
    count = length <= 14 ? length : length <= 35 ? 9 : Math.min(15, Math.ceil(length / 6) + 1)
  }
  const indexes = new Set<number>([0, length - 1])
  for (let i = 1; i < count - 1; i++) {
    indexes.add(Math.round((i / (count - 1)) * (length - 1)))
  }
  return [...indexes].sort((a, b) => a - b)
}

function yearOf(date: string): string {
  return date.slice(0, 4)
}

function formatXLabel(
  date: string,
  opts: {showWeekday: boolean; showYear: boolean},
): string {
  const parts = date.split('-')
  if (parts.length !== 3) return date
  const [y, m, d] = parts
  const md = `${m}/${d}`

  if (opts.showWeekday) {
    const day = new Date(`${date}T00:00:00`).getDay()
    return `${md} (${WEEKDAYS[day]})`
  }
  if (opts.showYear) return `${y}/${m}/${d}`
  return md
}

function formatFullDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  const day = new Date(`${dateStr}T00:00:00`).getDay()
  return `${parts[0]}年${parts[1]}月${parts[2]}日 ${WEEKDAYS[day]}`
}

export default function UsageTrendChart({
  points,
  emptyLabel = '暂无趋势数据',
  smooth = true,
  showAverage = true,
  showPeak = true,
  skillName,
  isFullscreen = false,
}: Props) {
  const chartId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const width = isFullscreen ? 1200 : 800
  const height = isFullscreen ? 540 : 340
  const padL = isFullscreen ? 54 : 46
  const padR = isFullscreen ? 28 : 24
  const padT = isFullscreen ? 30 : 24
  const padB = isFullscreen ? 36 : 32
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const axisY = padT + innerH

  const max = Math.max(0, ...points.map((p) => p.count))
  const totalCount = useMemo(() => points.reduce((acc, p) => acc + p.count, 0), [points])
  const average = useMemo(
    () => (points.length > 0 ? Number((totalCount / points.length).toFixed(1)) : 0),
    [points, totalCount],
  )
  const {yMax, ticks} = buildYScale(max)
  const hasSignal = points.some((p) => p.count > 0)

  const coords = useMemo(() => {
    return points.map((p, i) => {
      const x =
        points.length <= 1 ? padL + innerW / 2 : padL + (i / (points.length - 1)) * innerW
      const y = padT + innerH - (p.count / yMax) * innerH
      return {x, y, ...p, index: i}
    })
  }, [points, innerW, innerH, padL, padT, yMax])

  // 最高点
  const peakCoord = useMemo(() => {
    if (!hasSignal || coords.length === 0) return null
    let best = coords[0]
    for (const c of coords) {
      if (c.count > best.count) best = c
    }
    return best.count > 0 ? best : null
  }, [coords, hasSignal])

  // 路径生成
  const {linePath, areaPath} = useMemo(() => {
    if (coords.length === 0) return {linePath: '', areaPath: ''}
    if (coords.length === 1) {
      const p = coords[0]
      return {linePath: `M${p.x} ${p.y}`, areaPath: ''}
    }

    let lPath = ''
    if (smooth && coords.length >= 3) {
      lPath = buildSmoothPath(coords)
    } else {
      lPath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
    }

    const first = coords[0]
    const last = coords[coords.length - 1]
    const aPath = `${lPath} L${last.x.toFixed(1)} ${axisY.toFixed(1)} L${first.x.toFixed(1)} ${axisY.toFixed(1)} Z`

    return {linePath: lPath, areaPath: aPath}
  }, [coords, smooth, axisY])

  // 均值 Y 坐标
  const avgY = padT + innerH - (average / yMax) * innerH

  const labelIndexes = useMemo(
    () => xLabelIndexes(coords.length, isFullscreen),
    [coords.length, isFullscreen],
  )
  const crossesYear = useMemo(() => new Set(coords.map((c) => yearOf(c.date))).size > 1, [coords])
  const showWeekday = coords.length > 0 && coords.length <= 7

  // 鼠标交互
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current || coords.length === 0) return
      const rect = svgRef.current.getBoundingClientRect()
      const clientX = e.clientX - rect.left
      const svgX = (clientX / rect.width) * width

      // 寻找距离最近的点
      let closestIdx = 0
      let minDist = Infinity
      for (let i = 0; i < coords.length; i++) {
        const d = Math.abs(coords[i].x - svgX)
        if (d < minDist) {
          minDist = d
          closestIdx = i
        }
      }
      setHoverIndex(closestIdx)
    },
    [coords, width],
  )

  const handlePointerLeave = useCallback(() => {
    setHoverIndex(null)
  }, [])

  const activeCoord = hoverIndex !== null && coords[hoverIndex] ? coords[hoverIndex] : null
  const prevCoord = hoverIndex !== null && hoverIndex > 0 ? coords[hoverIndex - 1] : null
  const diffFromPrev = activeCoord && prevCoord ? activeCoord.count - prevCoord.count : null

  return (
    <div
      className={`usage-chart-wrap ${isFullscreen ? 'is-fullscreen' : ''}`}
      onPointerLeave={handlePointerLeave}
    >
      <div className="usage-chart-header-sub">
        <span className="usage-chart-unit-tag">单位：次</span>
        {hasSignal && average > 0 && showAverage ? (
          <span className="usage-chart-badge-stat">
            时段日均 <strong>{average}</strong> 次
          </span>
        ) : null}
      </div>

      {!hasSignal ? (
        <div className="usage-chart-empty-state">
          <svg className="usage-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <p className="muted">{emptyLabel}</p>
        </div>
      ) : null}

      <div className="usage-chart-svg-container">
        <svg
          ref={svgRef}
          className="usage-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="使用趋势图"
          onPointerMove={handlePointerMove}
        >
          <defs>
            <linearGradient id={`areaGrad-${chartId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
              <stop offset="70%" stopColor="var(--accent)" stopOpacity="0.05" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.00" />
            </linearGradient>
            <filter id={`dotGlow-${chartId}`} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="var(--accent)" floodOpacity="0.45" />
            </filter>
          </defs>

          {/* 背景水平虚线网格与 Y 轴刻度 */}
          {ticks.map((tick) => {
            const y = padT + innerH - (tick / yMax) * innerH
            return (
              <g key={tick} className="usage-grid-group">
                <line
                  x1={padL}
                  x2={padL + innerW}
                  y1={y}
                  y2={y}
                  className="usage-chart-grid"
                  strokeDasharray={tick === 0 ? undefined : '4 4'}
                />
                <text x={padL - 10} y={y + 4} textAnchor="end" className="usage-chart-axis-y">
                  {tick}
                </text>
              </g>
            )
          })}

          {/* 平均参考线 */}
          {hasSignal && showAverage && average > 0 ? (
            <g className="usage-avg-line-group">
              <line
                x1={padL}
                x2={padL + innerW}
                y1={avgY}
                y2={avgY}
                className="usage-chart-avg-line"
                strokeDasharray="5 3"
              />
              <text x={padL + innerW - 4} y={avgY - 6} textAnchor="end" className="usage-chart-avg-label">
                均值 {average}
              </text>
            </g>
          ) : null}

          {hasSignal ? (
            <>
              {/* 渐变阴影填充 */}
              <path d={areaPath} fill={`url(#areaGrad-${chartId})`} className="usage-chart-area" />
              {/* 趋势曲线 */}
              <path d={linePath} fill="none" className="usage-chart-line" />

              {/* 静态最高峰标记 */}
              {showPeak && peakCoord && coords.length > 3 ? (
                <g className="usage-peak-marker" transform={`translate(${peakCoord.x}, ${peakCoord.y})`}>
                  <circle r="4" className="usage-peak-ring" />
                  <g transform="translate(0, -18)">
                    <rect x="-28" y="-12" width="56" height="18" rx="4" className="usage-peak-badge-bg" />
                    <text x="0" y="0" textAnchor="middle" className="usage-peak-badge-text">
                      峰值 {peakCoord.count}
                    </text>
                  </g>
                </g>
              ) : null}

              {/* 静态离散点（少量点时全部显示，大量点时只在激活或悬浮显示） */}
              {coords.length <= (isFullscreen ? 35 : 15)
                ? coords.map((c) => (
                    <circle
                      key={c.date}
                      cx={c.x}
                      cy={c.y}
                      r={isFullscreen ? 3.5 : 3}
                      className="usage-chart-dot"
                    />
                  ))
                : null}

              {/* 悬浮指示竖线与激活点 */}
              {activeCoord ? (
                <g className="usage-hover-guideline-group">
                  <line
                    x1={activeCoord.x}
                    x2={activeCoord.x}
                    y1={padT}
                    y2={axisY}
                    className="usage-chart-hover-line"
                    strokeDasharray="3 3"
                  />
                  {/* 外层脉冲光环 */}
                  <circle
                    cx={activeCoord.x}
                    cy={activeCoord.y}
                    r={8}
                    className="usage-chart-hover-glow"
                    filter={`url(#dotGlow-${chartId})`}
                  />
                  {/* 内层高亮实心点 */}
                  <circle
                    cx={activeCoord.x}
                    cy={activeCoord.y}
                    r={4.5}
                    className="usage-chart-hover-dot"
                  />
                </g>
              ) : null}
            </>
          ) : (
            <line
              x1={padL}
              x2={padL + innerW}
              y1={axisY}
              y2={axisY}
              className="usage-chart-line is-empty"
            />
          )}

          {/* X 轴刻度标签 */}
          {labelIndexes.map((i, labelPos) => {
            const c = coords[i]
            if (!c) return null
            const prev = labelPos > 0 ? coords[labelIndexes[labelPos - 1]] : null
            const showYear = crossesYear && (!prev || yearOf(c.date) !== yearOf(prev.date))
            return (
              <g key={`label-${c.date}`}>
                <line
                  x1={c.x}
                  x2={c.x}
                  y1={axisY}
                  y2={axisY + 4}
                  className="usage-chart-xtick"
                />
                <text
                  x={c.x}
                  y={axisY + 18}
                  textAnchor="middle"
                  className="usage-chart-axis-x"
                >
                  {formatXLabel(c.date, {showWeekday, showYear})}
                </text>
              </g>
            )
          })}
        </svg>

        {/* 交互浮层 Tooltip */}
        {activeCoord && hasSignal ? (
          <div
            className="usage-chart-tooltip"
            style={{
              left: `${(activeCoord.x / width) * 100}%`,
              top: `${(activeCoord.y / height) * 100}%`,
              transform: `translate(${activeCoord.x > width * 0.72 ? '-105%' : '14px'}, -50%)`,
            }}
          >
            <div className="usage-tooltip-date">{formatFullDate(activeCoord.date)}</div>
            <div className="usage-tooltip-body">
              <span className="usage-tooltip-label">{skillName ? skillName : '调用次数'}</span>
              <span className="usage-tooltip-value">
                <strong>{activeCoord.count}</strong> 次
              </span>
            </div>
            {totalCount > 0 ? (
              <div className="usage-tooltip-sub">
                <span>占时段总量 {((activeCoord.count / totalCount) * 100).toFixed(1)}%</span>
                {diffFromPrev !== null ? (
                  <span
                    className={
                      diffFromPrev > 0
                        ? 'usage-trend-up'
                        : diffFromPrev < 0
                          ? 'usage-trend-down'
                          : 'usage-trend-flat'
                    }
                  >
                    {diffFromPrev > 0
                      ? `+${diffFromPrev} ↑`
                      : diffFromPrev < 0
                        ? `${diffFromPrev} ↓`
                        : '持平'}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
