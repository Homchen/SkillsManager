import {describe, expect, it} from 'vitest'
import {DEMO_ORGANIZE_ACTIONS, DEMO_ORGANIZE_REPORT, DEMO_ORGANIZE_SKIPPED} from './demoData'
import {
  nextOnboardingStep,
  onboardingCalloutPrefer,
  onboardingCopy,
  onboardingDemo,
  onboardingTarget,
  type OnboardingStep,
} from './steps'

describe('nextOnboardingStep', () => {
  it('walks welcome through done then stops', () => {
    const seen: OnboardingStep[] = ['welcome']
    let step: OnboardingStep | null = 'welcome'
    while ((step = nextOnboardingStep(step))) {
      seen.push(step)
    }
    expect(seen).toEqual([
      'welcome',
      'organize',
      'preview',
      'execute',
      'report',
      'back',
      'bulk',
      'bulkDirs',
      'toggle',
      'close',
      'layout',
      'done',
    ])
    expect(nextOnboardingStep('done')).toBeNull()
  })
})

describe('onboardingTarget', () => {
  it('centers welcome and done; others have hotspots', () => {
    expect(onboardingTarget('welcome')).toBeNull()
    expect(onboardingTarget('done')).toBeNull()
    expect(onboardingTarget('organize')).toBe('organize')
    expect(onboardingTarget('preview')).toBe('demo-preview')
    expect(onboardingTarget('execute')).toBe('demo-execute')
    expect(onboardingTarget('report')).toBe('demo-report-close')
    expect(onboardingTarget('bulkDirs')).toBe('demo-next')
    expect(onboardingTarget('layout')).toBe('layout')
  })
})

describe('onboardingDemo', () => {
  it('shows fake organize from preview through back', () => {
    expect(onboardingDemo('organize').organize).toBe(false)
    expect(onboardingDemo('preview')).toEqual({
      organize: true,
      previewFilled: false,
      executed: false,
      report: false,
      bulk: false,
      bulkStep: 2,
      grouped: false,
    })
    expect(onboardingDemo('execute')).toEqual({
      organize: true,
      previewFilled: true,
      executed: false,
      report: false,
      bulk: false,
      bulkStep: 2,
      grouped: false,
    })
    expect(onboardingDemo('report')).toEqual({
      organize: true,
      previewFilled: true,
      executed: false,
      report: true,
      bulk: false,
      bulkStep: 2,
      grouped: false,
    })
    expect(onboardingDemo('back')).toEqual({
      organize: true,
      previewFilled: true,
      executed: true,
      report: false,
      bulk: false,
      bulkStep: 2,
      grouped: false,
    })
  })

  it('shows bulk wizard after the toolbar step', () => {
    expect(onboardingDemo('bulk').bulk).toBe(false)
    expect(onboardingDemo('bulkDirs')).toEqual({
      organize: false,
      previewFilled: false,
      executed: false,
      report: false,
      bulk: true,
      bulkStep: 1,
      grouped: false,
    })
    expect(onboardingDemo('toggle').bulkStep).toBe(2)
    expect(onboardingDemo('close').bulk).toBe(true)
    expect(onboardingDemo('layout').bulk).toBe(false)
  })

  it('shows grouped demo only on done', () => {
    expect(onboardingDemo('layout').grouped).toBe(false)
    expect(onboardingDemo('done').grouped).toBe(true)
  })
})

describe('onboardingCalloutPrefer', () => {
  it('puts organize toolbar cards below the hotspot so they do not cover the page', () => {
    expect(onboardingCalloutPrefer('preview')[0]).toBe('below')
    expect(onboardingCalloutPrefer('execute')[0]).toBe('below')
    expect(onboardingCalloutPrefer('back')[0]).toBe('below')
    expect(onboardingCalloutPrefer('organize')[0]).toBe('below')
  })

  it('keeps report and bulk wizard cards off the dialog chrome', () => {
    expect(onboardingCalloutPrefer('report')[0]).toBe('above')
    expect(onboardingCalloutPrefer('bulkDirs')[0]).toBe('above')
    expect(onboardingCalloutPrefer('toggle')[0]).toBe('above-end')
    expect(onboardingCalloutPrefer('close')[0]).toBe('above')
  })
})

describe('onboardingCopy', () => {
  it('mentions demo does not touch disk on welcome', () => {
    expect(onboardingCopy('welcome').body).toContain('不会改你磁盘上的文件')
    expect(onboardingCopy('welcome').primary).toBe('开始')
    expect(onboardingCopy('done').primary).toBe('完成')
  })

  it('walks preview then execute then report', () => {
    expect(onboardingCopy('preview').title).toBe('生成预览')
    expect(onboardingCopy('execute').body).toContain('不会真正迁移文件')
    expect(onboardingCopy('report').title).toBe('执行报告')
    expect(onboardingCopy('back').body).toContain('执行报告')
  })

  it('uses three organize demo actions', () => {
    expect(DEMO_ORGANIZE_ACTIONS).toHaveLength(3)
    expect(DEMO_ORGANIZE_SKIPPED).toHaveLength(3)
    expect(DEMO_ORGANIZE_SKIPPED.every((a) => a.type === 'skip')).toBe(true)
    expect(DEMO_ORGANIZE_REPORT.succeeded).toHaveLength(3)
  })
})
