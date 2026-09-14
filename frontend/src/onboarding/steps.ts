import type {CalloutPrefer} from './placeCallout'

export type OnboardingStep =
  | 'welcome'
  | 'settings'
  | 'hub'
  | 'tools'
  | 'skills'
  | 'organize'
  | 'preview'
  | 'execute'
  | 'report'
  | 'back'
  | 'bulk'
  | 'bulkDirs'
  | 'toggle'
  | 'create'
  | 'editor'
  | 'usage'
  | 'done'

export const ONBOARDING_STEPS: OnboardingStep[] = [
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
]

/** data-tour value on the current hotspot, or null when the card is centered. */
export type OnboardingTarget =
  | 'nav-settings'
  | 'nav-skills'
  | 'nav-usage'
  | 'demo-hub'
  | 'demo-add-tool'
  | 'organize'
  | 'bulk'
  | 'create'
  | 'layout'
  | 'demo-preview'
  | 'demo-execute'
  | 'demo-report-close'
  | 'demo-back'
  | 'demo-next'
  | 'demo-close'
  | 'demo-editor-save'
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
  settings: boolean
  settingsTab: 'general' | 'tools'
  editor: boolean
  usage: boolean
  skillsList: boolean
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step)
  if (i < 0 || i >= ONBOARDING_STEPS.length - 1) return null
  return ONBOARDING_STEPS[i + 1]
}

export function onboardingStepProgress(step: OnboardingStep): {current: number; total: number} {
  const i = ONBOARDING_STEPS.indexOf(step)
  return {
    current: i < 0 ? 1 : i + 1,
    total: ONBOARDING_STEPS.length,
  }
}

export function onboardingTarget(step: OnboardingStep): OnboardingTarget {
  switch (step) {
    case 'settings':
      return 'nav-settings'
    case 'hub':
      return 'demo-hub'
    case 'tools':
      return 'demo-add-tool'
    case 'skills':
      return 'nav-skills'
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
      return 'demo-close'
    case 'create':
      return 'create'
    case 'editor':
      return 'demo-editor-save'
    case 'usage':
      return 'nav-usage'
    default:
      return null
  }
}

export function onboardingCalloutPrefer(step: OnboardingStep): CalloutPrefer[] {
  if (
    step === 'settings' ||
    step === 'skills' ||
    step === 'usage' ||
    step === 'organize' ||
    step === 'execute' ||
    step === 'back' ||
    step === 'create'
  ) {
    return ['below', 'above', 'right', 'left']
  }
  if (step === 'preview') {
    return ['above', 'below', 'right', 'left']
  }
  if (step === 'hub' || step === 'editor') {
    return ['below', 'right', 'left', 'above']
  }
  if (step === 'tools') {
    return ['below', 'left', 'above', 'right']
  }
  if (step === 'bulkDirs' || step === 'toggle' || step === 'report') {
    return ['above', 'left', 'right', 'below']
  }
  return ['right', 'left', 'below', 'above']
}

function emptyDemo(): OnboardingDemo {
  return {
    organize: false,
    previewFilled: false,
    executed: false,
    report: false,
    bulk: false,
    bulkStep: 2,
    settings: false,
    settingsTab: 'general',
    editor: false,
    usage: false,
    skillsList: false,
  }
}

export function onboardingDemo(step: OnboardingStep): OnboardingDemo {
  const demo = emptyDemo()
  const organize = step === 'preview' || step === 'execute' || step === 'report' || step === 'back'
  const bulk = step === 'bulkDirs' || step === 'toggle'
  const settings = step === 'hub' || step === 'tools'
  return {
    ...demo,
    organize,
    previewFilled: step === 'execute' || step === 'report' || step === 'back',
    executed: step === 'back',
    report: step === 'report',
    bulk,
    bulkStep: step === 'bulkDirs' ? 1 : 2,
    settings,
    settingsTab: step === 'tools' ? 'tools' : 'general',
    editor: step === 'editor',
    usage: step === 'usage',
    skillsList: step === 'done',
  }
}

export function onboardingCopy(step: OnboardingStep): OnboardingCopy {
  switch (step) {
    case 'welcome':
      return {
        title: '欢迎使用 SkillsManager',
        body: '技能只在源仓保留一份，各工具通过链接读取。接下来用演示走一遍设置、整理、建链和日常编辑，不会改你磁盘上的文件。',
        primary: '开始',
      }
    case 'settings':
      return {
        title: '先打开设置',
        body: '首次使用先确认源仓路径，并挂上 Cursor、Claude Code 等工具目录。',
      }
    case 'hub':
      return {
        title: '技能源仓',
        body: '所有技能集中存放在这里。改路径保存时会提示迁移现有技能。',
      }
    case 'tools':
      return {
        title: '挂上工具目录',
        body: '点「添加工具」选择各 Agent 的 skills 目录并启用。整理和建链都依赖这些路径。',
      }
    case 'skills':
      return {
        title: '回到技能列表',
        body: '源仓和工具配好后，从顶栏回到技能页开始整理。',
      }
    case 'organize':
      return {
        title: '一键整理',
        body: '把各工具里的副本收进源仓，并换成指向源仓的链接。点这个按钮进入整理。',
      }
    case 'preview':
      return {
        title: '扫描工作目录',
        body: '先扫描再执行。点「扫描工作目录」只扫设置里已添加的工具目录；「深度扫描」会扫整个用户主目录。扫完都会进入预览，同名差异会进三向合并。教程里没有冲突。',
      }
    case 'execute':
      return {
        title: '执行整理',
        body: '核对 KPI 和勾选项后点「执行整理」。教程不会真正迁移文件。Windows 上真实整理可能需要管理员权限。',
      }
    case 'report':
      return {
        title: '执行整理报告',
        body: '成功、跳过、失败会列在这里。教程里点「关闭」继续。',
      }
    case 'back':
      return {
        title: '返回技能',
        body: '整理完成后回到技能列表。执行报告仍可从整理页工具栏再次打开。',
      }
    case 'bulk':
      return {
        title: '按工具批量启用 / 禁用',
        body: '按工具把源仓技能挂上或撤下。源仓里的技能还在。单张卡片菜单也可以单独配置工具链接。',
      }
    case 'bulkDirs':
      return {
        title: '选目录',
        body: '先勾选要操作的工具工作目录，再点「下一步」。教程已勾选 cursor。',
      }
    case 'toggle':
      return {
        title: '选操作',
        body: '选「启用」或「禁用全部」。真正执行用右下角按钮；教程不会建链或删链，点「关闭」继续。',
      }
    case 'create':
      return {
        title: '新建技能',
        body: '点这里创建技能，或把文件夹 / zip 拖进列表导入。',
      }
    case 'editor':
      return {
        title: '编辑与译本',
        body: '左侧是文件树，改 SKILL.md 后点「保存」。需要其他语言时，用工具栏创建译本。',
      }
    case 'usage':
      return {
        title: '使用统计',
        body: '看各技能被 Agent 调用的次数和趋势。真实数据需要先安装托管 hook。',
      }
    case 'done':
      return {
        title: '可以开始用了',
        body: '顶部分组与筛选只影响本应用。单卡菜单可配置工具链接和分组。想再看一次，打开设置里的「新手引导」。',
        primary: '完成',
      }
  }
}
