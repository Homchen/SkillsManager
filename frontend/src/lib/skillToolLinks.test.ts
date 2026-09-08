import {describe, expect, it} from 'vitest'
import type {SkillEntry} from '../types'
import {formatEnableDelta, toolPresence, toolPresenceLabel} from './skillToolLinks'

function skillWith(...locations: SkillEntry['locations']): SkillEntry {
  return {
    id: 'archify',
    name: 'archify',
    status: 'normal',
    locations,
  }
}

describe('toolPresence', () => {
  it('prefers broken over symlink and copy', () => {
    expect(
      toolPresence(
        skillWith(
          {toolId: 'cursor', path: '/c', kind: 'real_copy'},
          {toolId: 'cursor', path: '/c', kind: 'broken_link'},
        ),
        'cursor',
      ),
    ).toBe('broken')
  })

  it('detects symlink, copy, and none', () => {
    expect(
      toolPresence(skillWith({toolId: 'agents', path: '/a', kind: 'symlink'}), 'agents'),
    ).toBe('linked')
    expect(
      toolPresence(skillWith({toolId: 'claude', path: '/x', kind: 'real_copy'}), 'claude'),
    ).toBe('copy')
    expect(toolPresence(skillWith(), 'cursor')).toBe('none')
  })
})

describe('toolPresenceLabel', () => {
  it('announces pending connect and disconnect', () => {
    expect(toolPresenceLabel('none', true)).toBe('将接入')
    expect(toolPresenceLabel('copy', true)).toBe('将接入')
    expect(toolPresenceLabel('linked', false)).toBe('将断开')
    expect(toolPresenceLabel('broken', false)).toBe('将断开')
  })

  it('keeps current-state labels when unchanged', () => {
    expect(toolPresenceLabel('linked', true)).toBe('已链接')
    expect(toolPresenceLabel('broken', true)).toBe('断链')
    expect(toolPresenceLabel('copy', false)).toBe('仅副本')
    expect(toolPresenceLabel('none', false)).toBe('未链接')
  })
})

describe('formatEnableDelta', () => {
  it('summarizes add and remove counts', () => {
    expect(formatEnableDelta(0, 0)).toBe('未更改')
    expect(formatEnableDelta(2, 0)).toBe('将接入 2 个')
    expect(formatEnableDelta(0, 1)).toBe('将断开 1 个')
    expect(formatEnableDelta(2, 1)).toBe('将接入 2 个，断开 1 个')
  })
})
