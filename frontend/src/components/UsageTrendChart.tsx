type Point = {date: string; count: number}

type Props = {
  points: Point[]
  emptyLabel?: string
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 将粗糙步长收成 1 / 2 / 5 × 10^n（次数为整数，步长至少为 1）。 */
function niceStep(rough: number): number {
  const r = Math.max(rough, 1)
  const exp = Math.floor(Math.log10(r))
  const mag = 10 ** exp
  const norm = r / mag
  const niceNorm = norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10
  return Math.max(1, niceNorm * mag)
}

/**
 * 按范围内最高日用量动态计算 Y 轴：
 * 峰值低 → 步长更小、刻度更密；峰值高 → 步长放大，仍约 5–8 档。
 */
function buildYScale(rawMax: number): {yMax: number; ticks: number[]} {
  const peak = Math.max(0, Math.ceil(rawMax))
  const padded = peak <= 0 ? 4 : Math.max(Math.ceil(peak * 2), peak + 3)

  const targetIntervals =
    peak <= 0 ? 4 : Math.min(8, Math.max(4, Math.ceil(Math.log2(padded + 1) + 2)))

  const step = niceStep(padded / targetIntervals)
  let yMax = Math.ceil(padded / step) * step
  if (yMax <= peak) yMax += step

  const ticks: number[] = []
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    ticks.push(Math.round(v))
  }
  return {yMax, ticks}
}

/** 按点数动态选取 X 轴标签索引：≤7 全显，约 30 天 5 个，更长 7 个，强制含首尾。 */
function xLabelIndexes(length: number): number[] {
  if (length <= 0) return []
  if (length === 1) return [0]
  if (length <= 7) return Array.from({length}, (_, i) => i)

  const count = length <= 35 ? 5 : 7
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
    return `${md}(周${WEEKDAYS[day]})`
  }
  if (opts.showYear) return `${y}/${m}/${d}`
  return md
}

export default function UsageTrendChart({points, emptyLabel = '暂无趋势数据'}: Props) {
  const width = 720
  const height = 320
  const padL = 36
  const padR = 20
  const padT = 16
  const padB = 20
  const tickLen = 5
  const innerW = width - padL - padR
  const innerH = height - padT - padB

  const max = Math.max(0, ...points.map((p) => p.count))
  const {yMax, ticks} = buildYScale(max)
  const hasSignal = points.some((p) => p.count > 0)

  const coords = points.map((p, i) => {
    const x =
      points.length <= 1 ? padL + innerW / 2 : padL + (i / (points.length - 1)) * innerW
    const y = padT + innerH - (p.count / yMax) * innerH
    return {x, y, ...p}
  })

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
  const area =
    coords.length === 0
      ? ''
      : `${line} L${coords[coords.length - 1].x.toFixed(1)} ${(padT + innerH).toFixed(1)} L${coords[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`

  const labelIndexes = xLabelIndexes(coords.length)
  const crossesYear = new Set(coords.map((c) => yearOf(c.date))).size > 1
  const showWeekday = coords.length > 0 && coords.length <= 7
  const axisY = padT + innerH

  return (
    <div className="usage-chart-wrap">
      <span className="usage-chart-axis-title usage-chart-axis-title-y">次数</span>
      {!hasSignal ? <p className="usage-chart-empty muted">{emptyLabel}</p> : null}
      <svg
        className="usage-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="使用趋势图，纵轴为次数，横轴为日期"
      >
        {ticks.map((tick) => {
          const y = padT + innerH - (tick / yMax) * innerH
          return (
            <g key={tick}>
              <line
                x1={padL}
                x2={padL + innerW}
                y1={y}
                y2={y}
                className="usage-chart-grid"
              />
              <text x={padL - 8} y={y + 4} textAnchor="end" className="usage-chart-axis">
                {tick}
              </text>
            </g>
          )
        })}
        {hasSignal ? (
          <>
            <path d={area} className="usage-chart-area" />
            <path d={line} className="usage-chart-line" fill="none" />
            {coords.map((c) => (
              <circle key={c.date} cx={c.x} cy={c.y} r={3} className="usage-chart-dot">
                <title>
                  {c.date}: {c.count}
                </title>
              </circle>
            ))}
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
        {labelIndexes.map((i, labelPos) => {
          const c = coords[i]
          if (!c) return null
          const prev = labelPos > 0 ? coords[labelIndexes[labelPos - 1]] : null
          const showYear =
            crossesYear && (!prev || yearOf(c.date) !== yearOf(prev.date))
          return (
            <g key={`label-${c.date}`}>
              <line
                x1={c.x}
                x2={c.x}
                y1={axisY}
                y2={axisY + tickLen}
                className="usage-chart-xtick"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={c.x}
                y={axisY + tickLen + 11}
                textAnchor="middle"
                className="usage-chart-axis"
              >
                {formatXLabel(c.date, {showWeekday, showYear})}
              </text>
            </g>
          )
        })}
      </svg>
      <span className="usage-chart-axis-title usage-chart-axis-title-x">日期</span>
    </div>
  )
}
