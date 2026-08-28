import {describe, expect, it} from 'vitest'
import {placeCallout} from './placeCallout'

const card = {width: 280, height: 140}
const viewport = {width: 1000, height: 800}

describe('placeCallout', () => {
  it('centers when there is no hole', () => {
    expect(placeCallout(null, card, viewport)).toEqual({
      top: (800 - 140) / 2,
      left: (1000 - 280) / 2,
    })
  })

  it('prefers the right side of the hole', () => {
    const hole = {top: 80, left: 40, width: 36, height: 36}
    expect(placeCallout(hole, card, viewport)).toEqual({
      top: 80,
      left: 40 + 36 + 12,
    })
  })

  it('falls back to the left when the right side overflows', () => {
    const hole = {top: 80, left: 900, width: 80, height: 36}
    expect(placeCallout(hole, card, viewport)).toEqual({
      top: 80,
      left: 900 - 280 - 12,
    })
  })

  it('can prefer below so a left placement does not cover content beside the hole', () => {
    const hole = {top: 200, left: 500, width: 80, height: 36}
    expect(placeCallout(hole, card, viewport, 12, ['below', 'right', 'above', 'left'])).toEqual({
      top: 200 + 36 + 12,
      left: 500,
    })
  })

  it('can prefer above-end to sit in the top-right of a wide hotspot', () => {
    const hole = {top: 240, left: 80, width: 480, height: 88}
    expect(placeCallout(hole, card, viewport, 12, ['above-end', 'below-end'])).toEqual({
      top: 240 - 140 - 12,
      left: 80 + 480 - 280,
    })
  })

  it('clamps into the viewport when no side fits', () => {
    const hole = {top: 10, left: 10, width: 980, height: 780}
    const pos = placeCallout(hole, card, {width: 400, height: 300})
    expect(pos.top).toBeGreaterThanOrEqual(12)
    expect(pos.left).toBeGreaterThanOrEqual(12)
    expect(pos.top + card.height).toBeLessThanOrEqual(300 - 12)
    expect(pos.left + card.width).toBeLessThanOrEqual(400 - 12)
  })
})
