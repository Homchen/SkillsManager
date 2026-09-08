export type NavDirection = 'next' | 'prev' | 'first' | 'last'

export interface NavigableOption {
  disabled?: boolean
}

/**
 * 计算键盘导航时下一个高亮选项的索引，自动跳过被禁用的选项。
 */
export function getNextSelectIndex(
  currentIndex: number,
  options: NavigableOption[],
  direction: NavDirection,
): number {
  if (options.length === 0) return -1

  switch (direction) {
    case 'first': {
      return options.findIndex((opt) => !opt.disabled)
    }
    case 'last': {
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i].disabled) return i
      }
      return -1
    }
    case 'next': {
      let next = currentIndex + 1
      while (next < options.length && options[next].disabled) {
        next++
      }
      if (next < options.length) return next
      return currentIndex
    }
    case 'prev': {
      let prev = currentIndex - 1
      while (prev >= 0 && options[prev].disabled) {
        prev--
      }
      if (prev >= 0) return prev
      return currentIndex
    }
  }
}

/**
 * 根据触发器位置和视口宽度，判断下拉浮层应向左对齐还是向右对齐。
 */
export function computeSelectAlignment(
  rect: { left: number; right: number },
  windowWidth: number,
  minSpaceNeeded: number = 200,
): 'left' | 'right' {
  const spaceOnRight = windowWidth - rect.left
  if (spaceOnRight < minSpaceNeeded && rect.right >= minSpaceNeeded) {
    return 'right'
  }
  return 'left'
}
