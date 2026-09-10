/** Matches `.skill-grid` in styles.css. */
export const SKILL_GRID_MIN_COL = 290
export const SKILL_GRID_GAP = 16
export const SKILL_GRID_FULL_RENDER = 24
export const SKILL_GRID_OVERSCAN_ROWS = 2
export const SKILL_GRID_DEFAULT_CARD_HEIGHT = 180

export function columnCount(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return 1
  }
  return Math.max(
    1,
    Math.floor((width + SKILL_GRID_GAP) / (SKILL_GRID_MIN_COL + SKILL_GRID_GAP)),
  )
}

export function rowStride(cardHeight: number): number {
  const h = Number.isFinite(cardHeight) && cardHeight > 0 ? cardHeight : SKILL_GRID_DEFAULT_CARD_HEIGHT
  return h + SKILL_GRID_GAP
}

export type VisibleIndexRange = {
  start: number
  end: number
  padTop: number
  padBottom: number
}

export type VisibleIndexRangeInput = {
  itemCount: number
  columns: number
  /** Vertical stride: card height + gap. */
  rowStride: number
  scrollTop: number
  viewportHeight: number
  /** Grid offset from the top of the scroll content. */
  gridOffsetTop: number
  overscanRows?: number
  /**
   * Extra Y coverage in grid-local pixels (e.g. marquee).
   * Measured from the top of the grid; may be negative.
   */
  coverOffsetTop?: number
  coverOffsetBottom?: number
}

export function visibleIndexRange(input: VisibleIndexRangeInput): VisibleIndexRange {
  const itemCount = Math.max(0, Math.floor(input.itemCount))
  if (itemCount === 0) {
    return {start: 0, end: 0, padTop: 0, padBottom: 0}
  }
  const columns = Math.max(1, Math.floor(input.columns) || 1)
  const stride = Math.max(1, input.rowStride)
  const rows = Math.ceil(itemCount / columns)
  const overscan = input.overscanRows ?? SKILL_GRID_OVERSCAN_ROWS

  const relScroll = input.scrollTop - input.gridOffsetTop
  let firstRow = Math.floor(relScroll / stride)
  let lastRow = Math.floor((relScroll + input.viewportHeight) / stride)

  if (Number.isFinite(input.coverOffsetTop) && Number.isFinite(input.coverOffsetBottom)) {
    firstRow = Math.min(firstRow, Math.floor((input.coverOffsetTop as number) / stride))
    lastRow = Math.max(lastRow, Math.floor((input.coverOffsetBottom as number) / stride))
  }

  firstRow -= overscan
  lastRow += overscan

  firstRow = clamp(firstRow, 0, rows - 1)
  lastRow = clamp(lastRow, 0, rows - 1)
  if (lastRow < firstRow) {
    lastRow = firstRow
  }

  const start = firstRow * columns
  const end = Math.min(itemCount, (lastRow + 1) * columns)
  const padTop = firstRow * stride
  const remainingRows = rows - lastRow - 1
  const padBottom = Math.max(0, remainingRows * stride)
  return {start, end, padTop, padBottom}
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function columnWidth(gridWidth: number, columns: number): number {
  const cols = Math.max(1, Math.floor(columns) || 1)
  if (!Number.isFinite(gridWidth) || gridWidth <= 0) {
    return 0
  }
  return Math.max(0, (gridWidth - (cols - 1) * SKILL_GRID_GAP) / cols)
}

export type HitBox = {
  left: number
  top: number
  right: number
  bottom: number
}

export type HitIndicesInBoxInput = {
  itemCount: number
  columns: number
  rowStride: number
  cardHeight: number
  gridWidth: number
  originLeft: number
  originTop: number
  box: HitBox
}

/** Same overlap rule as DOM getBoundingClientRect intersection. */
export function rectsOverlap(a: HitBox, b: HitBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * Hit-test every grid cell against `box` in viewport coordinates.
 * Independent of which cards are currently mounted.
 */
export function hitIndicesInBox(input: HitIndicesInBoxInput): number[] {
  const itemCount = Math.max(0, Math.floor(input.itemCount))
  const columns = Math.max(1, Math.floor(input.columns) || 1)
  const stride = Math.max(1, input.rowStride)
  const cardHeight = input.cardHeight
  const colW = columnWidth(input.gridWidth, columns)
  if (itemCount === 0 || colW <= 0 || !Number.isFinite(cardHeight) || cardHeight <= 0) {
    return []
  }

  const strideX = colW + SKILL_GRID_GAP
  const relLeft = input.box.left - input.originLeft
  const relRight = input.box.right - input.originLeft
  const relTop = input.box.top - input.originTop
  const relBottom = input.box.bottom - input.originTop
  const rows = Math.ceil(itemCount / columns)

  const firstCol = clamp(Math.floor(relLeft / strideX), 0, columns - 1)
  const lastCol = clamp(Math.floor((relRight - Number.EPSILON) / strideX), 0, columns - 1)
  const firstRow = clamp(Math.floor(relTop / stride), 0, rows - 1)
  const lastRow = clamp(Math.floor((relBottom - Number.EPSILON) / stride), 0, rows - 1)

  const hits: number[] = []
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const index = row * columns + col
      if (index >= itemCount) continue
      const left = input.originLeft + col * strideX
      const top = input.originTop + row * stride
      if (
        rectsOverlap(input.box, {
          left,
          top,
          right: left + colW,
          bottom: top + cardHeight,
        })
      ) {
        hits.push(index)
      }
    }
  }
  return hits
}
