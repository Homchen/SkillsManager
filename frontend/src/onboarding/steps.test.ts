import {describe, expect, it} from 'vitest'
import {DEMO_ORGANIZE_ACTIONS, DEMO_ORGANIZE_REPORT, DEMO_ORGANIZE_SKIPPED} from './demoData'
import {
  nextOnboardingStep,
  onboardingCalloutPrefer,
  onboardingCopy,
  onboardingDemo,
  onboardingStepProgress,
  onboardingTarget,
  type OnboardingStep,
} from './steps'

const EMPTY_DEMO = {
  organize: false,
  previewFilled: false,
  executed: false,
  report: false,
  bulk: false,
  bulkStep: 2,
  settings: false,
  settingsTab: 'general' as const,
  editor: false,
  usage: false,
  skillsList: false,
}

describe('nextOnboardingStep', () => {
  it('walks welcome through done then stops', () => {
    const seen: OnboardingStep[] = ['welcome']
    let step: OnboardingStep | null = 'welcome'
    while ((step = nextOnboardingStep(step))) {
      seen.push(step)
    }
    expect(seen).toEqual([
      'welcome',
      'settings',
      'hub',
      'tools',
      'skills',
      'organize',
      'preview',
      'execute',
      'report',
      'back',
      'bulk',
      'bulkDirs',
      'toggle',
      'create',
      'editor',
      'usage',
      'done',
    ])
    expect(nextOnboardingStep('done')).toBeNull()
    expect(onboardingStepProgress('welcome')).toEqual({current: 1, total: 17})
    expect(onboardingStepProgress('done')).toEqual({current: 17, total: 17})
  })
})

describe('onboardingTarget', () => {
  it('centers welcome and done; others have hotspots', () => {
    expect(onboardingTarget('welcome')).toBeNull()
    expect(onboardingTarget('done')).toBeNull()
    expect(onboardingTarget('settings')).toBe('nav-settings')
    expect(onboardingTarget('hub')).toBe('demo-hub')
    expect(onboardingTarget('tools')).toBe('demo-add-tool')
    expect(onboardingTarget('skills')).toBe('nav-skills')
    expect(onboardingTarget('organize')).toBe('organize')
    expect(onboardingTarget('preview')).toBe('demo-preview')
    expect(onboardingTarget('execute')).toBe('demo-execute')
    expect(onboardingTarget('report')).toBe('demo-report-close')
    expect(onboardingTarget('bulkDirs')).toBe('demo-next')
    expect(onboardingTarget('toggle')).toBe('demo-close')
    expect(onboardingTarget('create')).toBe('create')
    expect(onboardingTarget('editor')).toBe('demo-editor-save')
    expect(onboardingTarget('usage')).toBe('nav-usage')
  })
})

describe('onboardingDemo', () => {
  it('shows fake settings on hub and tools', () => {
    expect(onboardingDemo('settings').settings).toBe(false)
    expect(onboardingDemo('hub')).toEqual({
      ...EMPTY_DEMO,
      settings: true,
      settingsTab: 'general',
    })
    expect(onboardingDemo('tools')).toEqual({
      ...EMPTY_DEMO,
      settings: true,
      settingsTab: 'tools',
    })
  })

  it('shows fake organize from preview through back', () => {
    expect(onboardingDemo('organize').organize).toBe(false)
    expect(onboardingDemo('preview')).toEqual({
      ...EMPTY_DEMO,
      organize: true,
      previewFilled: false,
    })
    expect(onboardingDemo('execute')).toEqual({
      ...EMPTY_DEMO,
      organize: true,
      previewFilled: true,
    })
    expect(onboardingDemo('report')).toEqual({
      ...EMPTY_DEMO,
      organize: true,
      previewFilled: true,
      report: true,
    })
    expect(onboardingDemo('back')).toEqual({
      ...EMPTY_DEMO,
      organize: true,
      previewFilled: true,
      executed: true,
    })
  })

  it('shows bulk wizard after the toolbar step', () => {
    expect(onboardingDemo('bulk').bulk).toBe(false)
    expect(onboardingDemo('bulkDirs')).toEqual({
      ...EMPTY_DEMO,
      bulk: true,
      bulkStep: 1,
    })
    expect(onboardingDemo('toggle').bulk).toBe(true)
    expect(onboardingDemo('toggle').bulkStep).toBe(2)
    expect(onboardingDemo('create').bulk).toBe(false)
  })

  it('shows editor, usage, and skills demos on later steps', () => {
    expect(onboardingDemo('editor').editor).toBe(true)
    expect(onboardingDemo('usage').usage).toBe(true)
    expect(onboardingDemo('done').skillsList).toBe(true)
    expect(onboardingDemo('create').skillsList).toBe(false)
  })
})

describe('onboardingCalloutPrefer', () => {
  it('puts organize toolbar cards below the hotspot so they do not cover the page', () => {
    expect(onboardingCalloutPrefer('execute')[0]).toBe('below')
    expect(onboardingCalloutPrefer('back')[0]).toBe('below')
    expect(onboardingCalloutPrefer('organize')[0]).toBe('below')
    expect(onboardingCalloutPrefer('settings')[0]).toBe('below')
    expect(onboardingCalloutPrefer('create')[0]).toBe('below')
  })

  it('puts the preview card above the hero CTA so it stays on screen', () => {
    expect(onboardingCalloutPrefer('preview')[0]).toBe('above')
  })

  it('keeps report and bulk wizard cards off the dialog chrome', () => {
    expect(onboardingCalloutPrefer('report')[0]).toBe('above')
    expect(onboardingCalloutPrefer('bulkDirs')[0]).toBe('above')
    expect(onboardingCalloutPrefer('toggle')[0]).toBe('above')
  })
})

describe('onboardingCopy', () => {
  it('mentions demo does not touch disk on welcome', () => {
    expect(onboardingCopy('welcome').body).toContain('不会改你磁盘上的文件')
    expect(onboardingCopy('welcome').primary).toBe('开始')
    expect(onboardingCopy('done').primary).toBe('完成')
    expect(onboardingCopy('done').body).toContain('配置工具链接')
  })

  it('walks preview then execute then report', () => {
    expect(onboardingCopy('preview').title).toBe('扫描工作目录')
    expect(onboardingCopy('execute').body).toContain('不会真正迁移文件')
    expect(onboardingCopy('report').title).toBe('执行整理报告')
    expect(onboardingCopy('back').body).toContain('执行报告')
  })

  it('covers settings, create, editor, and usage', () => {
    expect(onboardingCopy('hub').title).toBe('技能源仓')
    expect(onboardingCopy('tools').body).toContain('添加工具')
    expect(onboardingCopy('create').title).toBe('新建技能')
    expect(onboardingCopy('editor').body).toContain('保存')
    expect(onboardingCopy('usage').body).toContain('hook')
  })

  it('uses three organize demo actions', () => {
    expect(DEMO_ORGANIZE_ACTIONS).toHaveLength(3)
    expect(DEMO_ORGANIZE_SKIPPED).toHaveLength(3)
    expect(DEMO_ORGANIZE_SKIPPED.every((a) => a.type === 'skip')).toBe(true)
    expect(DEMO_ORGANIZE_REPORT.succeeded).toHaveLength(3)
  })
})
