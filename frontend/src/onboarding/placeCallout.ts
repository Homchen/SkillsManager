export type Rect = {top: number; left: number; width: number; height: number}

export type CalloutPrefer = 'right' | 'left' | 'below' | 'above' | 'above-end' | 'below-end'

const GAP = 12

export const DEFAULT_CALLOUT_PREFER: CalloutPrefer[] = ['right', 'left', 'below', 'above']

/** Place the coach card next to a spotlight hole, or center it when there is none. */
export function placeCallout(
  hole: Rect | null,
  card: {width: number; height: number},
  viewport: {width: number; height: number},
  gap = GAP,
  prefer: CalloutPrefer[] = DEFAULT_CALLOUT_PREFER,
): {top: number; left: number} {
  const vw = viewport.width
  const vh = viewport.height
  const cw = card.width
  const ch = card.height
  const clamp = (top: number, left: number) => ({
    top: Math.min(Math.max(gap, top), Math.max(gap, vh - ch - gap)),
    left: Math.min(Math.max(gap, left), Math.max(gap, vw - cw - gap)),
  })

  if (!hole) {
    return clamp((vh - ch) / 2, (vw - cw) / 2)
  }

  const fits = (top: number, left: number) =>
    left >= gap && top >= gap && left + cw <= vw - gap && top + ch <= vh - gap

  const candidatesFor = (side: CalloutPrefer): {top: number; left: number}[] => {
    switch (side) {
      case 'right':
        return [{top: hole.top, left: hole.left + hole.width + gap}]
      case 'left':
        return [{top: hole.top, left: hole.left - cw - gap}]
      case 'below': {
        const top = hole.top + hole.height + gap
        return [
          {top, left: hole.left},
          {top, left: hole.left + hole.width - cw},
          {top, left: Math.max(gap, (vw - cw) / 2)},
        ]
      }
      case 'above': {
        const top = hole.top - ch - gap
        return [
          {top, left: hole.left},
          {top, left: hole.left + hole.width - cw},
          {top, left: Math.max(gap, (vw - cw) / 2)},
        ]
      }
      case 'above-end':
        return [{top: hole.top - ch - gap, left: hole.left + hole.width - cw}]
      case 'below-end':
        return [{top: hole.top + hole.height + gap, left: hole.left + hole.width - cw}]
    }
  }

  const order = prefer.length > 0 ? prefer : DEFAULT_CALLOUT_PREFER
  for (const side of order) {
    for (const c of candidatesFor(side)) {
      if (fits(c.top, c.left)) return c
    }
  }
  const fallback = candidatesFor(order[0] ?? 'below')[0]
  return clamp(fallback.top, fallback.left)
}
