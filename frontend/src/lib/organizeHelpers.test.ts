import {describe, expect, it} from 'vitest'
import {
  conflictFileProgress,
  conflictFilesReady,
  conflictRoundNeedsApply,
  conflictSkillNeedsAttention,
  errMsg,
  filterActionSectionsByQuery,
  groupActionsByType,
  isOrganizeActionSelectable,
  matchesOrganizeActionSearch,
  normalizeCanExecute,
  organizeSelectionState,
  type ConflictSkillLike,
} from './organizeHelpers'

function conflict(partial: ConflictSkillLike): ConflictSkillLike {
  return partial
}

describe('errMsg', () => {
  it('extracts Error.message', () => {
    expect(errMsg(new Error('boom'))).toBe('boom')
  })

  it('stringifies non-Error values', () => {
    expect(errMsg('plain')).toBe('plain')
    expect(errMsg(42)).toBe('42')
  })
})

describe('normalizeCanExecute', () => {
  it('accepts {ok, reason} payload', () => {
    expect(normalizeCanExecute({ok: true, reason: ''})).toEqual({ok: true, reason: ''})
    expect(normalizeCanExecute({ok: false, reason: '未决冲突'})).toEqual({
      ok: false,
      reason: '未决冲突',
    })
  })

  it('defaults missing reason to empty string', () => {
    expect(normalizeCanExecute({ok: true})).toEqual({ok: true, reason: ''})
  })

  it('compat: bare true boolean', () => {
    expect(normalizeCanExecute(true)).toEqual({ok: true, reason: ''})
  })

  it('compat: bare false boolean with fallback reason', () => {
    expect(normalizeCanExecute(false)).toEqual({
      ok: false,
      reason: '无法确认整理门禁状态，请重新生成预览或重启应用',
    })
  })

  it('rejects null / string / object without ok', () => {
    expect(normalizeCanExecute(null).ok).toBe(false)
    expect(normalizeCanExecute('x').ok).toBe(false)
    expect(normalizeCanExecute({reason: 'only'}).ok).toBe(false)
    expect(normalizeCanExecute(undefined).reason).toContain('无法确认整理门禁状态')
  })
})

describe('conflictFileProgress', () => {
  it('counts only both_diff files', () => {
    const c = conflict({
      files: [
        {status: 'only_a'},
        {status: 'both_same'},
        {status: 'both_diff'},
        {status: 'both_diff', choice: 'keep_a'},
      ],
    })
    expect(conflictFileProgress(c)).toEqual({resolved: 1, total: 2})
  })

  it('treats keep_a / keep_b / manual+content as resolved', () => {
    const c = conflict({
      files: [
        {status: 'both_diff', choice: 'keep_a'},
        {status: 'both_diff', choice: 'keep_b'},
        {status: 'both_diff', choice: 'manual', mergedContent: 'merged'},
        {status: 'both_diff', choice: 'manual'},
        {status: 'both_diff'},
      ],
    })
    expect(conflictFileProgress(c)).toEqual({resolved: 3, total: 5})
  })

  it('handles missing files as empty', () => {
    expect(conflictFileProgress({})).toEqual({resolved: 0, total: 0})
  })
})

describe('conflictFilesReady', () => {
  it('true when user skipped', () => {
    expect(
      conflictFilesReady(
        conflict({
          userSkipped: true,
          files: [{status: 'both_diff'}],
        }),
      ),
    ).toBe(true)
  })

  it('true when no both_diff files', () => {
    expect(conflictFilesReady(conflict({files: [{status: 'both_same'}]}))).toBe(true)
  })

  it('false when unresolved both_diff remain', () => {
    expect(
      conflictFilesReady(
        conflict({
          files: [
            {status: 'both_diff', choice: 'keep_a'},
            {status: 'both_diff'},
          ],
        }),
      ),
    ).toBe(false)
  })

  it('true when all both_diff resolved', () => {
    expect(
      conflictFilesReady(
        conflict({
          files: [
            {status: 'both_diff', choice: 'keep_a'},
            {status: 'both_diff', choice: 'manual', mergedContent: 'x'},
          ],
        }),
      ),
    ).toBe(true)
  })
})

describe('conflictSkillNeedsAttention', () => {
  it('false when user skipped', () => {
    expect(conflictSkillNeedsAttention(conflict({userSkipped: true, index: 1, total: 2}))).toBe(
      false,
    )
  })

  it('true when files not ready', () => {
    expect(
      conflictSkillNeedsAttention(
        conflict({
          files: [{status: 'both_diff'}],
          index: 1,
          total: 1,
        }),
      ),
    ).toBe(true)
  })

  it('true when files ready but more rounds pending', () => {
    expect(
      conflictSkillNeedsAttention(
        conflict({
          files: [{status: 'both_diff', choice: 'keep_a'}],
          index: 1,
          total: 2,
        }),
      ),
    ).toBe(true)
  })

  it('true when pendingSources remain after file resolutions', () => {
    expect(
      conflictSkillNeedsAttention(
        conflict({
          files: [{status: 'both_diff', choice: 'keep_b'}],
          index: 1,
          total: 1,
          pendingSources: ['/tmp/extra'],
        }),
      ),
    ).toBe(true)
  })

  it('false when fully decided last round', () => {
    expect(
      conflictSkillNeedsAttention(
        conflict({
          files: [{status: 'both_diff', choice: 'keep_a'}],
          index: 1,
          total: 1,
        }),
      ),
    ).toBe(false)
  })
})

describe('conflictRoundNeedsApply', () => {
  it('false for null or skipped', () => {
    expect(conflictRoundNeedsApply(null)).toBe(false)
    expect(conflictRoundNeedsApply(conflict({userSkipped: true, index: 1, total: 2}))).toBe(false)
  })

  it('false when no further rounds', () => {
    expect(
      conflictRoundNeedsApply(
        conflict({
          files: [{status: 'both_diff', choice: 'keep_a'}],
          index: 1,
          total: 1,
        }),
      ),
    ).toBe(false)
  })

  it('true when all both_diff resolved and more rounds remain', () => {
    expect(
      conflictRoundNeedsApply(
        conflict({
          files: [
            {status: 'both_same'},
            {status: 'both_diff', choice: 'keep_a'},
            {status: 'both_diff', choice: 'manual', mergedContent: 'ok'},
          ],
          index: 1,
          total: 2,
        }),
      ),
    ).toBe(true)
  })

  it('false when a both_diff is still unresolved', () => {
    expect(
      conflictRoundNeedsApply(
        conflict({
          files: [
            {status: 'both_diff', choice: 'keep_a'},
            {status: 'both_diff'},
          ],
          index: 1,
          total: 2,
        }),
      ),
    ).toBe(false)
  })

  it('true when pendingSources remain and files are resolved', () => {
    expect(
      conflictRoundNeedsApply(
        conflict({
          files: [{status: 'both_diff', choice: 'keep_b'}],
          index: 1,
          total: 1,
          pendingSources: ['/tmp/extra'],
        }),
      ),
    ).toBe(true)
  })
})

describe('groupActionsByType', () => {
  it('groups by type and keeps original indices', () => {
    const actions = [
      {type: 'skip', skillId: 'a'},
      {type: 'move_to_hub', skillId: 'b'},
      {type: 'skip', skillId: 'c'},
      {type: 'merge_conflict', skillId: 'd'},
    ]
    const sections = groupActionsByType(actions)
    expect(sections.map((s) => s.type)).toEqual([
      'move_to_hub',
      'merge_conflict',
      'skip',
    ])
    expect(sections[0].items).toEqual([{action: actions[1], index: 1}])
    expect(sections[2].items.map((i) => i.index)).toEqual([0, 2])
  })

  it('appends unknown types after known order', () => {
    const sections = groupActionsByType([
      {type: 'custom_z'},
      {type: 'skip'},
      {type: 'custom_a'},
    ])
    expect(sections.map((s) => s.type)).toEqual(['skip', 'custom_a', 'custom_z'])
  })
})

describe('isOrganizeActionSelectable', () => {
  it('disables skip kinds', () => {
    expect(isOrganizeActionSelectable('skip')).toBe(false)
    expect(isOrganizeActionSelectable('skipped_by_user')).toBe(false)
    expect(isOrganizeActionSelectable('move_to_hub')).toBe(true)
    expect(isOrganizeActionSelectable('merge_conflict')).toBe(true)
  })
})

describe('organizeSelectionState', () => {
  it('ignores non-toggleable actions', () => {
    expect(
      organizeSelectionState([
        {type: 'skip', selected: true},
        {type: 'move_to_hub', selected: false},
        {type: 'move_to_hub', selected: true},
      ]),
    ).toEqual({
      toggleableCount: 2,
      selectedCount: 1,
      checked: false,
      indeterminate: true,
    })
  })

  it('reports all selected when every toggleable item is checked', () => {
    expect(
      organizeSelectionState([
        {type: 'skip', selected: false},
        {type: 'fix_link', selected: true},
        {type: 'merge_conflict', selected: true},
      ]),
    ).toEqual({
      toggleableCount: 2,
      selectedCount: 2,
      checked: true,
      indeterminate: false,
    })
  })
})

describe('matchesOrganizeActionSearch', () => {
  it('matches skill id and source paths', () => {
    const action = {skillId: 'demo/foo', sources: ['C:\\Users\\me\\.cursor\\skills\\demo']}
    expect(matchesOrganizeActionSearch(action, '')).toBe(true)
    expect(matchesOrganizeActionSearch(action, 'demo/foo')).toBe(true)
    expect(matchesOrganizeActionSearch(action, '.cursor')).toBe(true)
    expect(matchesOrganizeActionSearch(action, 'missing')).toBe(false)
  })
})

describe('filterActionSectionsByQuery', () => {
  it('keeps original indices and drops empty sections', () => {
    const sections = groupActionsByType([
      {type: 'skip', skillId: 'a', sources: []},
      {type: 'move_to_hub', skillId: 'b', sources: ['/tmp/b']},
      {type: 'move_to_hub', skillId: 'c', sources: ['/tmp/c']},
    ])
    const filtered = filterActionSectionsByQuery(sections, 'b')
    expect(filtered.map((s) => s.type)).toEqual(['move_to_hub'])
    expect(filtered[0].items).toEqual([{action: {type: 'move_to_hub', skillId: 'b', sources: ['/tmp/b']}, index: 1}])
  })
})
