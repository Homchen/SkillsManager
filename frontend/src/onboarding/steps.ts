import type {CalloutPrefer} from './placeCallout'

export type OnboardingStep =
  | 'welcome'
  | 'organize'
  | 'preview'
  | 'execute'
  | 'report'
  | 'back'
  | 'bulk'
  | 'bulkDirs'
  | 'toggle'
  | 'close'
  | 'layout'
  | 'done'

export const ONBOARDING_STEPS: OnboardingStep[] = [
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
]

/** data-tour value on the current hotspot, or null when the card is centered. */
export type OnboardingTarget =
  | 'organize'
  | 'bulk'
  | 'layout'
  | 'demo-preview'
  | 'demo-execute'
  | 'demo-report-close'
  | 'demo-back'
  | 'demo-next'
  | 'demo-toggle'
  | 'demo-close'
  | null

export type OnboardingCopy = {
  title: string
  body: string
  primary?: string
}

export type OnboardingDemo = {
  organize: boolean
  previewFilled: boolean
  executed: boolean
  report: boolean
  bulk: boolean
  bulkStep: 1 | 2
  grouped: boolean
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step)
  if (i < 0 || i >= ONBOARDING_STEPS.length - 1) return null
  return ONBOARDING_STEPS[i + 1]
}

export function onboardingTarget(step: OnboardingStep): OnboardingTarget {
  switch (step) {
    case 'organize':
      return 'organize'
    case 'preview':
      return 'demo-preview'
    case 'execute':
      return 'demo-execute'
    case 'report':
      return 'demo-report-close'
    case 'back':
      return 'demo-back'
    case 'bulk':
      return 'bulk'
    case 'bulkDirs':
      return 'demo-next'
    case 'toggle':
      return 'demo-toggle'
    case 'close':
      return 'demo-close'
    case 'layout':
      return 'layout'
    default:
      return null
  }
}

/** Keep bulk-wizard cards off the tool list; step-2 选操作 sits in the empty top-right. */
export function onboardingCalloutPrefer(step: OnboardingStep): CalloutPrefer[] {
  if (step === 'preview' || step === 'execute' || step === 'back' || step === 'organize') {
    return ['below', 'above', 'right', 'left']
  }
  if (step === 'bulkDirs' || step === 'close' || step === 'report') {
    return ['above', 'left', 'right', 'below']
  }
  if (step === 'toggle') {
    return ['above-end', 'below-end', 'above', 'right', 'left', 'below']
  }
  return ['right', 'left', 'below', 'above']
}

export function onboardingDemo(step: OnboardingStep): OnboardingDemo {
  const organize = step === 'preview' || step === 'execute' || step === 'report' || step === 'back'
  const bulk = step === 'bulkDirs' || step === 'toggle' || step === 'close'
  return {
    organize,
    previewFilled: step === 'execute' || step === 'report' || step === 'back',
    executed: step === 'back',
    report: step === 'report',
    bulk,
    bulkStep: step === 'bulkDirs' ? 1 : 2,
    grouped: step === 'done',
  }
}

export function onboardingCopy(step: OnboardingStep): OnboardingCopy {
  switch (step) {
    case 'welcome':
      return {
        title: '欢迎使用 SkillsManager',
        body: '技能只在源仓保留一份，各工具通过链接读取。接下来用演示走一遍整理、按工具开关和分组视图，不会改你磁盘上的文件。',
        primary: '开始',
      }
    case 'organize':
      return {
        title: '一键整理',
        body: '把各工具里的副本收进源仓，并换成指向源仓的链接。点这个按钮进入整理。',
      }
    case 'preview':
      return {
        title: '生成预览',
        body: '先看计划再执行。点「生成预览」查看整理计划。',
      }
    case 'execute':
      return {
        title: '开始执行',
        body: '核对勾选项后点「开始执行」。教程不会真正迁移文件。',
      }
    case 'report':
      return {
        title: '执行报告',
        body: '成功、跳过、失败会列在这里。教程里点「关闭」继续。',
      }
    case 'back':
      return {
        title: '返回',
        body: '整理完成后回到技能列表。执行报告仍可从工具栏再次打开。',
      }
    case 'bulk':
      return {
        title: '按工具批量启用 / 禁用',
        body: '按工具挂上或撤下链接。源仓里的技能还在。',
      }
    case 'bulkDirs':
      return {
        title: '选目录',
        body: '先勾选要操作的工具工作目录，再点「下一步」。教程已勾选 cursor。',
      }
    case 'toggle':
      return {
        title: '选操作',
        body: '选「启用」或「禁用全部」。教程不会真正建链或删链。',
      }
    case 'close':
      return {
        title: '关闭',
        body: '真正执行用右下角按钮。教程里点「关闭」继续。',
      }
    case 'layout':
      return {
        title: '分组布局',
        body: '技能多了可以按分组看。分组只影响本应用，不影响各工具。',
      }
    case 'done':
      return {
        title: '可以开始用了',
        body: '想再看一次，打开设置里的「新手引导」。',
        primary: '完成',
      }
  }
}
