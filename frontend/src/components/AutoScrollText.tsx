import {useEffect, useRef, useState} from 'react'

interface AutoScrollTextProps {
  text: string
  className?: string
  title?: string
  /** 滚动触发模式：'always' 自动单向循环滚动（悬停暂停），'hover' 悬停时单向循环滚动。默认 'always' */
  mode?: 'always' | 'hover'
  /** 滚动速度（像素/秒），默认 18，慢速舒缓易读 */
  speed?: number
  /** 重复文本之间的间隔（像素），默认 36 */
  gap?: number
}

export default function AutoScrollText({
  text,
  className = '',
  title,
  mode = 'always',
  speed = 18,
  gap = 36,
}: AutoScrollTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const itemRef = useRef<HTMLSpanElement>(null)
  const [isOverflow, setIsOverflow] = useState(false)
  const [marqueeDist, setMarqueeDist] = useState(0)

  useEffect(() => {
    const checkOverflow = () => {
      const container = containerRef.current
      const item = itemRef.current
      if (!container || !item) return

      const cWidth = container.clientWidth
      const iWidth = item.scrollWidth

      if (iWidth > cWidth + 1) {
        setIsOverflow(true)
        // 单个循环位移距离 = 文本内容宽度 + 间距
        setMarqueeDist(Math.ceil(iWidth + gap))
      } else {
        setIsOverflow(false)
        setMarqueeDist(0)
      }
    }

    checkOverflow()

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(() => {
        checkOverflow()
      })
      observer.observe(containerRef.current)
      if (itemRef.current) {
        observer.observe(itemRef.current)
      }
    }

    window.addEventListener('resize', checkOverflow)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', checkOverflow)
    }
  }, [text, gap])

  // 动画时长 = 位移距离 / 速度（秒），最小时间限制为 5.5 秒，保证从容平缓
  const duration =
    isOverflow && marqueeDist > 0
      ? Math.max(5.5, Number((marqueeDist / speed).toFixed(2)))
      : 0

  return (
    <span
      ref={containerRef}
      className={`auto-scroll-wrap ${isOverflow ? 'is-overflowing' : ''} mode-${mode} ${className}`}
      title={title || text}
    >
      <span
        className="auto-scroll-track"
        style={
          isOverflow && marqueeDist > 0
            ? ({
                '--marquee-dist': `${marqueeDist}px`,
                '--marquee-duration': `${duration}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <span ref={itemRef} className="auto-scroll-item">
          {text}
        </span>
        {isOverflow ? (
          <span
            className="auto-scroll-item auto-scroll-duplicate"
            aria-hidden="true"
            style={{paddingLeft: `${gap}px`}}
          >
            {text}
          </span>
        ) : null}
      </span>
    </span>
  )
}
