import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import {
  SKILL_GRID_DEFAULT_CARD_HEIGHT,
  SKILL_GRID_FULL_RENDER,
  SKILL_GRID_GAP,
  SKILL_GRID_OVERSCAN_ROWS,
  columnCount,
  columnWidth,
  hitIndicesInBox,
  rowStride,
  visibleIndexRange,
  type HitBox,
} from '../lib/skillGridWindow'

export type SkillGridMarqueeBox = {
  left: number
  top: number
  width: number
  height: number
}

export type SkillGridHandle = {
  hitIds: (box: HitBox) => string[]
}

type Props<T> = {
  items: T[]
  getId: (item: T) => string
  renderItem: (item: T) => ReactNode
  pinnedId?: string | null
  marqueeBox?: SkillGridMarqueeBox | null
}

function findScrollRoot(el: HTMLElement | null): HTMLElement | null {
  return (el?.closest('.app-main') as HTMLElement | null) ?? el
}

function SkillGridInner<T>(
  {items, getId, renderItem, pinnedId = null, marqueeBox = null}: Props<T>,
  ref: ForwardedRef<SkillGridHandle>,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const getIdRef = useRef(getId)
  getIdRef.current = getId
  const wrapTopRef = useRef(0)
  const cardHeightRef = useRef(0)
  const [width, setWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [gridOffsetTop, setGridOffsetTop] = useState(0)
  const [cardHeight, setCardHeight] = useState(0)

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const scrollRoot = findScrollRoot(wrap)
    const wrapRect = wrap.getBoundingClientRect()
    wrapTopRef.current = wrapRect.top
    setWidth(wrap.clientWidth)
    if (scrollRoot) {
      const rootRect = scrollRoot.getBoundingClientRect()
      setScrollTop(scrollRoot.scrollTop)
      setViewportHeight(scrollRoot.clientHeight)
      setGridOffsetTop(wrapRect.top - rootRect.top + scrollRoot.scrollTop)
    } else {
      setScrollTop(0)
      setViewportHeight(window.innerHeight)
      setGridOffsetTop(0)
    }
    const card = gridRef.current?.querySelector<HTMLElement>('.skill-card')
    if (card) {
      const h = card.getBoundingClientRect().height
      if (h > 0) {
        cardHeightRef.current = h
        setCardHeight(h)
      }
    }
  }, [])

  useLayoutEffect(() => {
    measure()
    const wrap = wrapRef.current
    if (!wrap) return
    const scrollRoot = findScrollRoot(wrap)
    const ro = new ResizeObserver(() => measure())
    ro.observe(wrap)
    if (scrollRoot && scrollRoot !== wrap) ro.observe(scrollRoot)
    const onScroll = () => measure()
    scrollRoot?.addEventListener('scroll', onScroll, {passive: true})
    window.addEventListener('resize', onScroll)
    return () => {
      ro.disconnect()
      scrollRoot?.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [measure, items.length])

  useImperativeHandle(
    ref,
    () => ({
      hitIds(box: HitBox) {
        const wrap = wrapRef.current
        const list = itemsRef.current
        if (!wrap || list.length === 0) return []
        const wrapRect = wrap.getBoundingClientRect()
        const w = wrap.clientWidth
        const card = gridRef.current?.querySelector<HTMLElement>('.skill-card')
        const measured = card?.getBoundingClientRect().height ?? 0
        const height =
          measured > 0
            ? measured
            : cardHeightRef.current > 0
              ? cardHeightRef.current
              : SKILL_GRID_DEFAULT_CARD_HEIGHT
        const indices = hitIndicesInBox({
          itemCount: list.length,
          columns: columnCount(w),
          rowStride: rowStride(height),
          cardHeight: height,
          gridWidth: w,
          originLeft: wrapRect.left,
          originTop: wrapRect.top,
          box,
        })
        const idOf = getIdRef.current
        return indices.map((i) => idOf(list[i]))
      },
    }),
    [],
  )

  const cols = columnCount(width)
  const stride = rowStride(cardHeight)
  const pinnedIndex = useMemo(() => {
    if (!pinnedId) return -1
    return items.findIndex((item) => getId(item) === pinnedId)
  }, [getId, items, pinnedId])

  const fullRender = items.length <= SKILL_GRID_FULL_RENDER
  const cover = marqueeBox
    ? {
        top: marqueeBox.top - wrapTopRef.current,
        bottom: marqueeBox.top + marqueeBox.height - wrapTopRef.current,
      }
    : null
  const range = useMemo(() => {
    if (fullRender) {
      return {start: 0, end: items.length, padTop: 0, padBottom: 0}
    }
    return visibleIndexRange({
      itemCount: items.length,
      columns: cols,
      rowStride: stride,
      scrollTop,
      viewportHeight,
      gridOffsetTop,
      overscanRows: SKILL_GRID_OVERSCAN_ROWS,
      coverOffsetTop: cover?.top,
      coverOffsetBottom: cover?.bottom,
    })
  }, [
    cols,
    cover?.bottom,
    cover?.top,
    fullRender,
    gridOffsetTop,
    items.length,
    scrollTop,
    stride,
    viewportHeight,
  ])

  const slice = fullRender ? items : items.slice(range.start, range.end)
  const pinOutside =
    !fullRender && pinnedIndex >= 0 && (pinnedIndex < range.start || pinnedIndex >= range.end)
  const pinItem = pinOutside ? items[pinnedIndex] : null
  const colW = columnWidth(width, cols)

  return (
    <div
      ref={wrapRef}
      className="skill-grid-window"
      style={
        fullRender
          ? undefined
          : {paddingTop: range.padTop, paddingBottom: range.padBottom}
      }
    >
      <div ref={gridRef} className="skill-grid">
        {slice.map((item) => renderItem(item))}
      </div>
      {pinItem && colW > 0 ? (
        <div
          className="skill-grid-pin"
          style={{
            top: Math.floor(pinnedIndex / cols) * stride,
            left: (pinnedIndex % cols) * (colW + SKILL_GRID_GAP),
            width: colW,
          }}
        >
          {renderItem(pinItem)}
        </div>
      ) : null}
    </div>
  )
}

const SkillGrid = forwardRef(SkillGridInner) as <T>(
  props: Props<T> & {ref?: Ref<SkillGridHandle>},
) => ReactElement | null

export default SkillGrid
