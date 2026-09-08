import type {ReactNode} from 'react'
import {Select} from '../components/Select'
import UsageTrendChart from '../components/UsageTrendChart'
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconBulkToolLinks,
  IconCheck,
  IconChevron,
  IconCopy,
  IconCopyPlus,
  IconFolderOpen,
  IconFolderPlus,
  IconFolderSync,
  IconLanguages,
  IconLayoutList,
  IconLink,
  IconMoreVertical,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSave,
  IconSearch,
  IconShield,
  IconSliders,
  IconSparkles,
  IconTrash,
  IconTrophy,
  IconTrendingUp,
  IconWrench,
} from '../components/icons'
import {NewFileActionIcon, NewFolderActionIcon} from '../components/FileTree'
import {getSkillAvatarTheme} from '../lib/skillAvatar'
import {languageLabel} from '../lib/languages'
import {formatLastUsed, formatUsageLabel} from '../lib/skillUsage'
import {getToolBadge} from '../lib/toolBadge'
import {groupDisplayName} from '../types'
import {
  DEMO_BULK_TOOLS,
  DEMO_HUB_PATH,
  DEMO_ORGANIZE_ACTIONS,
  DEMO_ORGANIZE_REPORT,
  DEMO_ORGANIZE_SKIPPED,
  DEMO_SETTINGS_TOOLS,
  DEMO_SKILLS,
  DEMO_USAGE_POINTS,
  type DemoSkill,
} from './demoData'

const DEMO_SETTINGS_TABS = [
  {id: 'general' as const, label: '常规与源仓', subtitle: '核心源仓路径、数据安全与全局策略', icon: IconSliders},
  {id: 'tools' as const, label: '工具生态', subtitle: '配置与监控各 Agent 客户端的技能目录', icon: IconWrench},
  {id: 'translation' as const, label: 'AI 与翻译', subtitle: '翻译引擎选择、大模型接口与凭据安全', icon: IconLanguages},
  {id: 'system' as const, label: '系统与诊断', subtitle: '管理员权限管理、调试日志与重温引导', icon: IconShield},
]

const ORGANIZE_ACTION_UI: Record<
  string,
  {label: string; toneClass: string; icon: typeof IconFolderPlus}
> = {
  move_to_hub: {label: '待迁入源仓', toneClass: 'type-move_to_hub', icon: IconFolderPlus},
  replace_with_symlink: {label: '待替换软链', toneClass: 'type-replace_with_symlink', icon: IconLink},
  skip: {label: '保持跳过', toneClass: 'type-skip', icon: IconCheck},
}

export function DemoOrganize({
  previewFilled,
  executed,
  report,
}: {
  previewFilled: boolean
  executed: boolean
  report: boolean
}) {
  const actions = executed ? DEMO_ORGANIZE_SKIPPED : DEMO_ORGANIZE_ACTIONS
  const moveCount = actions.filter((a) => a.type === 'move_to_hub').length
  const linkCount = actions.filter((a) => a.type === 'replace_with_symlink').length
  const skipCount = actions.filter((a) => a.type === 'skip').length
  const sections = executed
    ? [{type: 'skip', items: DEMO_ORGANIZE_SKIPPED}]
    : [
        {type: 'move_to_hub', items: DEMO_ORGANIZE_ACTIONS.filter((a) => a.type === 'move_to_hub')},
        {
          type: 'replace_with_symlink',
          items: DEMO_ORGANIZE_ACTIONS.filter((a) => a.type === 'replace_with_symlink'),
        },
      ]
  const canExecute = previewFilled && !executed
  const status = !previewFilled
    ? {cls: 'is-idle', text: '未扫描'}
    : executed
      ? {cls: 'is-success', text: '就绪（全部已规范）'}
      : {cls: 'is-ready', text: `就绪（已选 ${actions.length}/${actions.length} 项）`}

  return (
    <div className="onboarding-demo onboarding-demo-organize organize-page" aria-hidden="true">
      <header className="organize-header">
        <div className="organize-header-left">
          <button type="button" className="organize-back-btn" data-tour="demo-back" tabIndex={-1}>
            <IconArrowLeft size={16} />
            <span>返回技能</span>
          </button>
          <div className="organize-header-divider" />
          <div className="organize-header-icon">
            <IconFolderSync size={20} />
          </div>
          <div className="organize-header-titles">
            <div className="organize-title-row">
              <h2 className="organize-title">一键整理</h2>
              <span className={`organize-status-pill ${status.cls}`}>
                <span className="organize-status-dot" />
                {status.text}
              </span>
            </div>
            <p className="organize-subtitle">
              将各 AI 工具中的技能统一归集至中心源仓，并自动建立透明符号链接
            </p>
          </div>
        </div>
        {report || executed || previewFilled ? (
          <div className="organize-header-right">
          {report || executed ? (
            <button type="button" className="btn" tabIndex={-1}>
              <IconActivity size={15} />
              <span>执行报告</span>
            </button>
          ) : null}
          {previewFilled ? (
            <button type="button" className="btn" tabIndex={-1}>
              <IconSearch size={15} />
              <span>深度扫描</span>
            </button>
          ) : null}
          {previewFilled ? (
            <button type="button" className="btn" tabIndex={-1}>
              <IconRefresh size={15} />
              <span>扫描工作目录</span>
            </button>
          ) : null}
          {previewFilled ? (
            <button
              type="button"
              className="btn btn-primary btn-execute"
              data-tour="demo-execute"
              disabled={!canExecute}
              tabIndex={-1}
            >
              <IconCheck size={16} />
              <span>开始执行整理</span>
            </button>
          ) : null}
          </div>
        ) : null}
      </header>

      <section className="organize-pipeline" aria-label="整理执行进度">
        <div className={`organize-pipeline-step ${previewFilled ? 'is-completed' : 'is-current'}`}>
          <div className="organize-step-badge">{previewFilled ? '✓' : '1'}</div>
          <div className="organize-step-text">
            <span className="organize-step-title">1. 扫描与发现</span>
            <span className="organize-step-desc">
              {previewFilled ? `已发现 ${actions.length} 项动作，0 处冲突` : '扫描工作目录或全盘查找散落技能'}
            </span>
          </div>
        </div>
        <div className="organize-pipeline-separator" aria-hidden="true">
          <IconChevron size={14} />
        </div>
        <div className={`organize-pipeline-step ${previewFilled ? 'is-completed' : ''}`}>
          <div className="organize-step-badge">{previewFilled ? '✓' : '2'}</div>
          <div className="organize-step-text">
            <span className="organize-step-title">2. 审查与冲突决议</span>
            <span className="organize-step-desc">
              {previewFilled ? '无内容冲突，可直接执行' : '核对迁入清单与三向合并'}
            </span>
          </div>
        </div>
        <div className="organize-pipeline-separator" aria-hidden="true">
          <IconChevron size={14} />
        </div>
        <div
          className={`organize-pipeline-step ${
            executed || report ? 'is-completed' : canExecute ? 'is-current' : ''
          }`}
        >
          <div className="organize-step-badge">{executed || report ? '✓' : '3'}</div>
          <div className="organize-step-text">
            <span className="organize-step-title">3. 归集迁移与建链</span>
            <span className="organize-step-desc">
              {executed || report ? '整理已完成，符号链接生效中' : canExecute ? '方案就绪，点击开始执行' : '等待前置步骤完成'}
            </span>
          </div>
        </div>
      </section>

      {!previewFilled ? (
        <section className="organize-hero">
          <div className="organize-hero-badge">
            <IconSparkles size={14} />
            <span>智能化多工具协同整理</span>
          </div>
          <h3 className="organize-hero-title">将散落的 Skills 统一归集至唯一源仓</h3>
          <p className="organize-hero-desc">
            当您同时使用 Cursor、Claude、VS Code、Windsurf 等多个开发工具时，技能文件往往分散多处且容易版本脱节。一键整理能安全将所有技能集中管理，并透明建立系统级符号链接。
          </p>
          <div className="organize-hero-pillars">
            <div className="organize-hero-pillar">
              <div className="organize-pillar-head">
                <div className="organize-pillar-icon tone-hub">
                  <IconFolderPlus size={18} />
                </div>
                <span>单一真实源仓</span>
              </div>
              <p className="organize-pillar-text">将各处孤立副本统一搬迁到规范源仓目录。</p>
            </div>
            <div className="organize-hero-pillar">
              <div className="organize-pillar-head">
                <div className="organize-pillar-icon tone-symlink">
                  <IconLink size={18} />
                </div>
                <span>无感符号链接</span>
              </div>
              <p className="organize-pillar-text">在原工具侧原地创建符号链接，开箱即用。</p>
            </div>
            <div className="organize-hero-pillar">
              <div className="organize-pillar-head">
                <div className="organize-pillar-icon tone-merge">
                  <IconAlertTriangle size={18} />
                </div>
                <span>行级三向合并</span>
              </div>
              <p className="organize-pillar-text">同名差异提供三向合并，不会被静默覆盖。</p>
            </div>
          </div>
          <div className="organize-hero-actions">
            <div className="organize-hero-actions-row">
              <button
                type="button"
                className="btn btn-primary btn-hero-primary"
                data-tour="demo-preview"
                tabIndex={-1}
              >
                <IconFolderSync size={16} />
                <span>扫描工作目录</span>
              </button>
              <button type="button" className="btn" tabIndex={-1}>
                <IconSearch size={16} />
                <span>深度扫描</span>
              </button>
            </div>
            <p className="organize-hero-scan-hint">
              两个按钮都会重新扫描对应范围，完成后进入预览。工作目录是设置里已添加的工具目录；深度扫描覆盖整个用户主目录。
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="organize-kpis" aria-label="整理动作统计">
            <DemoKpi title="待迁入源仓" count={moveCount} tone="tone-move" icon={<IconFolderPlus size={16} />} desc={moveCount ? '将散落副本搬入源仓' : '散落副本已全部归集'} />
            <DemoKpi title="待替换软链" count={linkCount} tone="tone-link" icon={<IconLink size={16} />} desc={linkCount ? '在工具目录创建链接' : '符号链接均已就绪'} />
            <DemoKpi title="内容冲突" count={0} tone="tone-conflict" icon={<IconAlertTriangle size={16} />} desc="无同名版本冲突" />
            <DemoKpi title="修复断链" count={0} tone="tone-fix" icon={<IconWrench size={16} />} desc="无失效或损坏链接" />
            <DemoKpi title="保持跳过" count={skipCount} tone="tone-skip" icon={<IconCheck size={16} />} desc={skipCount ? '已规范或手动跳过' : '无跳过项目'} />
          </section>
          <section className="organize-filter-deck">
            <div className="organize-filter-row">
              <div className="organize-segmented-tabs" role="tablist">
                <button type="button" className="organize-filter-tab is-active" tabIndex={-1}>
                  <span>全部动作</span>
                  <span className="organize-tab-count">{actions.length}</span>
                </button>
                <button type="button" className="organize-filter-tab" tabIndex={-1}>
                  <span>待迁入源仓</span>
                  <span className="organize-tab-count">{moveCount}</span>
                </button>
                <button type="button" className="organize-filter-tab" tabIndex={-1}>
                  <span>待替换软链</span>
                  <span className="organize-tab-count">{linkCount}</span>
                </button>
              </div>
              <div className="organize-search-box">
                <IconSearch size={15} />
                <input
                  type="search"
                  className="organize-search-input"
                  placeholder="搜索技能 ID、来源路径…"
                  value=""
                  readOnly
                  tabIndex={-1}
                  aria-label="搜索执行计划"
                />
              </div>
            </div>
          </section>
          <section className="organize-actions-deck">
            {sections.map((sec) => {
              const config = ORGANIZE_ACTION_UI[sec.type]
              const ActionIcon = config.icon
              return (
                <div className="organize-group-block" key={sec.type}>
                  <div className="organize-group-header-row">
                    <div className="organize-group-title-wrap">
                      <span className="organize-group-chevron-icon is-open" aria-hidden="true">
                        <IconChevron size={14} />
                      </span>
                      <div className="organize-group-badge">
                        <div className={`organize-group-type-icon ${config.toneClass}`}>
                          <ActionIcon size={14} />
                        </div>
                        <span className="organize-group-label">{config.label}</span>
                        <span className="organize-group-count-pill">{sec.items.length}</span>
                      </div>
                    </div>
                  </div>
                  <div className="organize-table-wrap">
                    <table className="organize-table">
                      <thead>
                        <tr>
                          <th style={{width: 48, textAlign: 'center'}}>选中</th>
                          <th style={{minWidth: 200}}>技能名称 / ID</th>
                          <th style={{width: 140}}>动作类型</th>
                          <th>来源路径与对应工具</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sec.items.map((action) => {
                          const badge = getToolBadge(action.toolId)
                          return (
                            <tr key={action.skillId}>
                              <td style={{textAlign: 'center'}}>
                                <input
                                  type="checkbox"
                                  className="organize-checkbox"
                                  checked={action.selected}
                                  disabled={executed}
                                  readOnly
                                  tabIndex={-1}
                                />
                              </td>
                              <td>
                                <div className="organize-skill-cell">
                                  <span className="organize-skill-id-chip">{action.skillId}</span>
                                </div>
                              </td>
                              <td>
                                <span className={`organize-action-pill ${config.toneClass}`}>
                                  <ActionIcon size={13} />
                                  <span>{config.label}</span>
                                </span>
                              </td>
                              <td>
                                <div className="organize-sources-cell">
                                  <div className="organize-source-item">
                                    <span
                                      className="organize-tool-badge"
                                      style={{
                                        background: badge.gradient,
                                        boxShadow: `0 1px 4px ${badge.shadowColor}`,
                                      }}
                                    >
                                      {badge.displayName}
                                    </span>
                                    <span className="mono muted">{action.sources[0]}</span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </section>
        </>
      )}
      {report ? <DemoOrganizeReport /> : null}
    </div>
  )
}

function DemoKpi({
  title,
  count,
  tone,
  icon,
  desc,
}: {
  title: string
  count: number
  tone: string
  icon: ReactNode
  desc: string
}) {
  return (
    <div className={`organize-kpi-card ${count === 0 ? 'is-zero' : `is-highlight ${tone}`}`}>
      <div className="organize-kpi-card-head">
        <span className="organize-kpi-title">{title}</span>
        <div className={`organize-kpi-icon-wrap ${tone}`}>{icon}</div>
      </div>
      <div className="organize-kpi-value-row">
        <span className="organize-kpi-number">{count}</span>
        <span className="organize-kpi-unit">项</span>
      </div>
      <span className="organize-kpi-desc">{desc}</span>
    </div>
  )
}

function DemoOrganizeReport() {
  const ok = DEMO_ORGANIZE_REPORT.succeeded
  return (
    <div className="dialog-backdrop">
      <div className="dialog dialog-report">
        <div className="dialog-conflict-head">
          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <IconActivity size={18} style={{color: 'var(--accent)'}} />
            <h2>执行整理报告</h2>
          </div>
          <button type="button" className="btn" data-tour="demo-report-close" tabIndex={-1}>
            关闭
          </button>
        </div>
        <div className="report-dialog-body">
          <div className="report-panel">
            <div className="report-stats">
              <div className="report-stat-card stat-ok">
                <span className="stat-label">成功</span>
                <span className="stat-value">{ok.length}</span>
              </div>
              <div className="report-stat-card stat-muted">
                <span className="stat-label">跳过</span>
                <span className="stat-value">0</span>
              </div>
              <div className="report-stat-card stat-danger">
                <span className="stat-label">失败</span>
                <span className="stat-value">0</span>
              </div>
            </div>
            <div className="report-block report-ok">
              <button type="button" className="report-block-header" tabIndex={-1}>
                <span className="report-block-chevron" aria-hidden="true">
                  ▾
                </span>
                <span className="report-block-dot" />
                成功（{ok.length}）
              </button>
              <ul className="report-list">
                {ok.map((item) => (
                  <li key={item.skillId} className="report-item">
                    <span className="mono report-skill-id">{item.skillId}</span>
                    <span className="report-item-msg">{item.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DemoBulk({step}: {step: 1 | 2}) {
  const selected = DEMO_BULK_TOOLS.filter((t) => t.selected)
  return (
    <div className="onboarding-demo onboarding-demo-bulk" aria-hidden="true">
      <div className="dialog dialog-wide dialog-bulk">
        <header className="bulk-dialog-head">
          <div>
            <h2>按工具批量启用 / 禁用</h2>
            <p className="bulk-dialog-desc">
              {step === 1 ? '选择要操作的工作目录（工具 skills 根）' : '确认已选目录后，选择启用或禁用'}
            </p>
          </div>
          <div className="bulk-steps" aria-label="步骤">
            <span className={step === 1 ? 'bulk-step active' : 'bulk-step done'}>1 选目录</span>
            <span className="bulk-step-sep" aria-hidden="true" />
            <span className={step === 2 ? 'bulk-step active' : 'bulk-step'}>2 选操作</span>
          </div>
        </header>
        <div className="bulk-dialog-body">
          {step === 1 ? (
            <>
              <div className="bulk-tool-toolbar">
                <span className="muted">
                  已选 {selected.length} / {DEMO_BULK_TOOLS.length}
                </span>
                <button type="button" className="btn btn-ghost" tabIndex={-1}>
                  全选
                </button>
              </div>
              <div className="bulk-tool-list">
                {DEMO_BULK_TOOLS.map((tool) => (
                  <label key={tool.id} className={tool.selected ? 'bulk-tool-item is-selected' : 'bulk-tool-item'}>
                    <input type="checkbox" checked={tool.selected} readOnly tabIndex={-1} />
                    <span className="bulk-tool-label">
                      <span className="bulk-tool-name">{tool.id}</span>
                      <span className="bulk-tool-meta">
                        链接 {tool.links} · 副本 {tool.copies} · {tool.snapshot}
                      </span>
                      <span className="bulk-tool-path" title={tool.path}>
                        {tool.path}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <section className="bulk-section">
                <div className="bulk-section-head">
                  <p className="bulk-section-title">已选工作目录</p>
                  <span className="bulk-count-badge">{selected.length}</span>
                </div>
                <ul className="bulk-selected-summary">
                  {selected.map((tool) => (
                    <li key={tool.id} className="bulk-selected-item">
                      <div className="bulk-selected-top">
                        <strong>{tool.id}</strong>
                        <span className="bulk-tool-meta">
                          链接 {tool.links} · 副本 {tool.copies} · {tool.snapshot}
                        </span>
                      </div>
                      <div className="bulk-tool-path" title={tool.path}>
                        {tool.path}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="bulk-section">
                <p className="bulk-section-title">操作</p>
                <div className="bulk-choice-grid">
                  <label className="bulk-choice is-active">
                    <input type="radio" name="onboarding-bulk-action" defaultChecked tabIndex={-1} />
                    <span className="bulk-choice-title">启用</span>
                    <span className="bulk-choice-desc">建立或恢复符号链接</span>
                  </label>
                  <label className="bulk-choice">
                    <input type="radio" name="onboarding-bulk-action" tabIndex={-1} />
                    <span className="bulk-choice-title">禁用全部</span>
                    <span className="bulk-choice-desc">移除符号链接与断链</span>
                  </label>
                </div>
              </section>
              <section className="bulk-section bulk-mode-panel">
                <p className="bulk-section-title">启用方式</p>
                <div className="bulk-choice-grid bulk-choice-grid-sm">
                  <label className="bulk-choice is-active">
                    <input type="radio" name="onboarding-bulk-mode" defaultChecked tabIndex={-1} />
                    <span className="bulk-choice-title">全部开启</span>
                    <span className="bulk-choice-desc">源仓可链技能全部建链</span>
                  </label>
                  <label className="bulk-choice">
                    <input type="radio" name="onboarding-bulk-mode" tabIndex={-1} />
                    <span className="bulk-choice-title">恢复上次</span>
                    <span className="bulk-choice-desc">当前无可用快照</span>
                  </label>
                </div>
                <p className="muted bulk-hint">已选目录均无禁用快照，「恢复上次」不可用。</p>
              </section>
            </>
          )}
        </div>
        <div className="dialog-actions">
          {step === 1 ? (
            <>
              <button type="button" className="btn" tabIndex={-1}>
                取消
              </button>
              <button type="button" className="btn btn-primary" data-tour="demo-next" tabIndex={-1}>
                下一步
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" tabIndex={-1}>
                上一步
              </button>
              <button type="button" className="btn" data-tour="demo-close" tabIndex={-1}>
                关闭
              </button>
              <button type="button" className="btn btn-primary" disabled tabIndex={-1}>
                执行启用
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function DemoSettings({tab}: {tab: 'general' | 'tools'}) {
  const current = DEMO_SETTINGS_TABS.find((t) => t.id === tab) ?? DEMO_SETTINGS_TABS[0]
  const TabIcon = current.icon
  return (
    <div className="onboarding-demo onboarding-demo-settings settings-page" aria-hidden="true">
      <header className="settings-global-header">
        <div className="settings-header-intro">
          <div className="settings-header-icon-pill">
            <TabIcon size={18} />
          </div>
          <div className="settings-header-titles">
            <h2 className="settings-main-title">{current.label}</h2>
            <p className="settings-subtitle">{current.subtitle}</p>
          </div>
        </div>
        <div className="settings-header-actions">
          <span className="settings-synced-pill">
            <span className="settings-synced-icon-wrap" aria-hidden="true">
              <IconCheck size={13} />
            </span>
            <span>配置已同步</span>
          </span>
          <button type="button" className="btn btn-primary settings-save-btn" disabled tabIndex={-1}>
            <IconSave size={15} />
            <span>保存设置</span>
          </button>
        </div>
      </header>
      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="设置分类">
          <nav className="settings-nav-group">
            {DEMO_SETTINGS_TABS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${item.id === tab ? 'is-active' : ''}`}
                  tabIndex={-1}
                >
                  <span className="settings-nav-indicator" aria-hidden="true" />
                  <span className="settings-nav-icon">
                    <Icon size={18} />
                  </span>
                  <span className="settings-nav-label">{item.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>
        <main className="settings-content">
          {tab === 'general' ? (
            <div className="settings-section-container">
              <div className="settings-card featured" data-tour="demo-hub">
                <div className="settings-card-head">
                  <div className="settings-card-icon-pill">
                    <IconFolderOpen size={20} />
                  </div>
                  <div>
                    <h3 className="settings-card-title">技能源仓（Hub）</h3>
                    <p className="settings-card-desc">
                      SkillsManager 集中存放所有 Skill 的核心仓库。各 Agent 工具将通过符号链接直接挂载此目录。
                    </p>
                  </div>
                </div>
                <div className="settings-field-box">
                  <label className="settings-field-label">源仓存储绝对路径</label>
                  <div className="settings-path-input-group">
                    <input className="settings-text-input" value={DEMO_HUB_PATH} readOnly tabIndex={-1} />
                    <button type="button" className="btn" tabIndex={-1}>
                      <IconCopy size={15} />
                      <span>复制</span>
                    </button>
                    <button type="button" className="btn" tabIndex={-1}>
                      <IconFolderOpen size={15} />
                      <span>浏览…</span>
                    </button>
                  </div>
                  <div className="settings-field-hint">
                    默认推荐路径为 <code>%USERPROFILE%\.skillsmanager\skills</code>。
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="settings-section-container">
              <div className="settings-card">
                <div className="settings-card-head with-action">
                  <div className="settings-card-head-left">
                    <div className="settings-card-icon-pill">
                      <IconWrench size={20} />
                    </div>
                    <div>
                      <h3 className="settings-card-title">已挂载的 Agent 工具</h3>
                      <p className="settings-card-desc">
                        配置 Cursor、Claude、Windsurf 等开发工具的技能存储目录。
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary settings-add-tool-btn"
                    data-tour="demo-add-tool"
                    tabIndex={-1}
                  >
                    <IconPlus size={16} />
                    <span>添加工具</span>
                  </button>
                </div>
                <div className="settings-tools-grid">
                  {DEMO_SETTINGS_TOOLS.map((tool) => {
                    const badge = getToolBadge(tool.id)
                    return (
                      <div key={tool.id} className="settings-tool-card">
                        <div className="settings-tool-view-mode">
                          <div className="settings-tool-header">
                            <div className="settings-tool-identity">
                              <span
                                className="settings-tool-avatar"
                                style={{
                                  background: badge.gradient,
                                  color: '#ffffff',
                                  boxShadow: `0 2px 8px ${badge.shadowColor}`,
                                }}
                              >
                                {badge.letter}
                              </span>
                              <div className="settings-tool-meta">
                                <div className="settings-tool-name-row">
                                  <strong className="settings-tool-name">{tool.id}</strong>
                                  <span className="settings-tool-badge enabled">
                                    <span className="settings-badge-dot" aria-hidden="true" />
                                    <span>已启用挂载</span>
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="settings-tool-quick-switch">
                              <label className="settings-switch-label">
                                <span className="switch">
                                  <input type="checkbox" role="switch" checked readOnly tabIndex={-1} />
                                  <span className="switch-ui" aria-hidden="true" />
                                </span>
                              </label>
                            </div>
                          </div>
                          <div className="settings-tool-path-bar">
                            <div className="settings-tool-path-content" title={tool.path}>
                              <IconFolderOpen size={14} className="settings-path-icon" />
                              <span className="settings-tool-path-text">{tool.path}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export function DemoEditor() {
  return (
    <div className="onboarding-demo onboarding-demo-editor editor-page" aria-hidden="true">
      <div className="page-toolbar">
        <button type="button" className="btn" tabIndex={-1}>
          返回
        </button>
        <span className="editor-skill-id" title="code-review">
          code-review
        </span>
        <div className="editor-lang-select">
          <Select
            size="sm"
            value="zh-CN"
            onChange={() => undefined}
            options={[{value: 'zh-CN', label: '简体中文（默认）'}]}
            ariaLabel="切换语言版本"
          />
        </div>
        <button type="button" className="btn btn-icon" tabIndex={-1} title="更改原版语言">
          <IconPencil size={20} />
        </button>
        <button type="button" className="btn btn-primary" data-tour="demo-editor-save" tabIndex={-1}>
          保存
        </button>
        <button type="button" className="btn btn-icon" tabIndex={-1} title="创建简体中文版本">
          <IconCopyPlus size={22} />
        </button>
      </div>
      <div className="editor-layout">
        <aside className="editor-files">
          <div className="editor-files-head">
            <div className="editor-files-title">文件</div>
            <div className="editor-files-actions">
              <button type="button" tabIndex={-1} aria-label="新建文件">
                <NewFileActionIcon />
              </button>
              <button type="button" tabIndex={-1} aria-label="新建文件夹">
                <NewFolderActionIcon />
              </button>
            </div>
          </div>
          <div className="file-tree-wrap">
            <ul className="file-tree" role="tree">
              <li>
                <div className="file-tree-row file active">
                  <span className="file-tree-chevron-spacer" />
                  <span className="file-tree-label">SKILL.md</span>
                </div>
              </li>
            </ul>
          </div>
        </aside>
        <div className="editor-pane">
          <div className="editor-pane-toolbar">
            <div className="view-mode-toggle" role="group" aria-label="内容显示模式">
              <button type="button" className="active" tabIndex={-1}>
                预览
              </button>
              <button type="button" tabIndex={-1}>
                分屏
              </button>
              <button type="button" tabIndex={-1}>
                源码
              </button>
            </div>
          </div>
          <div className="markdown-preview">
            <h1>代码审查</h1>
            <p>按仓库规范做代码审查，在提交前指出风险与改进点。</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DemoUsage() {
  const total = DEMO_SKILLS.reduce((sum, s) => sum + s.usage, 0)
  const ranked = [...DEMO_SKILLS].sort((a, b) => b.usage - a.usage)
  const maxScore = ranked[0]?.usage || 1
  return (
    <div className="onboarding-demo onboarding-demo-usage usage-page" aria-hidden="true">
      <header className="usage-top-bar">
        <div className="usage-top-titles">
          <div className="usage-title-row">
            <h2 className="usage-title">使用统计</h2>
            <span className="usage-badge-indicator">
              <span className="usage-status-dot" />
              Hook 实时追踪
            </span>
          </div>
          <p className="usage-subtitle muted">追踪 Agent 在开发过程中对技能的调用频次与生命周期热度</p>
        </div>
        <div className="usage-controls">
          <div className="usage-segmented" role="group">
            <button type="button" className="usage-segment" tabIndex={-1}>
              近 7 天
            </button>
            <button type="button" className="usage-segment is-active" tabIndex={-1}>
              近 30 天
            </button>
            <button type="button" className="usage-segment" tabIndex={-1}>
              近 90 天
            </button>
            <button type="button" className="usage-segment" tabIndex={-1}>
              全部
            </button>
          </div>
          <button type="button" className="btn btn-refresh" tabIndex={-1}>
            <IconRefresh size={16} />
            <span>刷新</span>
          </button>
        </div>
      </header>
      <section className="usage-kpi-grid">
        <div className="usage-kpi-card">
          <div className="usage-kpi-head">
            <span className="usage-kpi-label">近 30 天调用总量</span>
            <div className="usage-kpi-icon-wrap is-accent">
              <IconActivity size={18} />
            </div>
          </div>
          <div className="usage-kpi-value-row">
            <span className="usage-kpi-num">{total}</span>
            <span className="usage-kpi-unit">次</span>
          </div>
        </div>
        <div className="usage-kpi-card">
          <div className="usage-kpi-head">
            <span className="usage-kpi-label">活跃技能覆盖</span>
            <div className="usage-kpi-icon-wrap is-purple">
              <IconSparkles size={18} />
            </div>
          </div>
          <div className="usage-kpi-value-row">
            <span className="usage-kpi-num">
              {DEMO_SKILLS.length}
              <span className="usage-kpi-total"> / {DEMO_SKILLS.length}</span>
            </span>
            <span className="usage-kpi-unit">个</span>
          </div>
        </div>
        <div className="usage-kpi-card">
          <div className="usage-kpi-head">
            <span className="usage-kpi-label">单日最高峰值</span>
            <div className="usage-kpi-icon-wrap is-emerald">
              <IconTrendingUp size={18} />
            </div>
          </div>
          <div className="usage-kpi-value-row">
            <span className="usage-kpi-num">18</span>
            <span className="usage-kpi-unit">次</span>
          </div>
        </div>
        <div className="usage-kpi-card">
          <div className="usage-kpi-head">
            <span className="usage-kpi-label">最常使用技能 (Top 1)</span>
            <div className="usage-kpi-icon-wrap is-amber">
              <IconTrophy size={18} />
            </div>
          </div>
          <div className="usage-kpi-value-row">
            <span className="usage-kpi-top-title">{ranked[0]?.name}</span>
          </div>
        </div>
      </section>
      <div className="usage-panels">
        <section className="usage-section usage-section-rank">
          <div className="usage-card usage-rank-card">
            <div className="usage-rank-header">
              <div className="usage-rank-header-titles">
                <div className="usage-rank-title-badge">
                  <h3>技能排行榜</h3>
                  <span className="usage-count-tag">{ranked.length}</span>
                </div>
              </div>
            </div>
            <div className="usage-rank-list-wrapper">
              <ol className="usage-rank-list">
                {ranked.map((skill, index) => (
                  <li key={skill.id}>
                    <div className={`usage-rank-row ${index === 0 ? 'is-selected' : ''}`}>
                      <div
                        className="usage-rank-bar-bg"
                        style={{width: `${Math.max(8, (skill.usage / maxScore) * 100)}%`}}
                      />
                      <div className={`usage-rank-badge rank-${Math.min(index + 1, 4)}`}>
                        {index === 0 ? <IconTrophy size={14} /> : <span>{index + 1}</span>}
                      </div>
                      <div className="usage-rank-main">
                        <span className="usage-rank-name">{skill.name}</span>
                        <span className="usage-rank-id">{skill.id}</span>
                      </div>
                      <div className="usage-rank-meta">
                        <div className="usage-rank-score-wrap">
                          <span className="usage-rank-score">{skill.usage}</span>
                          <span className="usage-rank-score-unit">次</span>
                        </div>
                        <span className="usage-rank-time muted">{formatLastUsed(skill.lastUsedAt)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
        <section className="usage-section usage-section-trend">
          <div className="usage-card usage-trend-card">
            <div className="usage-trend-header">
              <div className="usage-trend-title-block">
                <h3 className="usage-trend-title">全体技能调用趋势</h3>
              </div>
            </div>
            <UsageTrendChart points={DEMO_USAGE_POINTS} emptyLabel="暂无趋势" smooth />
          </div>
        </section>
      </div>
    </div>
  )
}

function DemoSkillCard({skill}: {skill: DemoSkill}) {
  const avatarTheme = getSkillAvatarTheme(skill.name || skill.id)
  const hasDifferentId = skill.id.toLowerCase() !== skill.name.toLowerCase()
  return (
    <article className="skill-card">
      <div className="card-top-row">
        <div
          className="skill-avatar"
          style={{
            background: avatarTheme.bg,
            borderColor: avatarTheme.border,
            color: avatarTheme.text,
          }}
          aria-hidden="true"
        >
          <span>{avatarTheme.char}</span>
          <span className="avatar-status-dot status-normal" />
        </div>
        <div className="skill-header-info">
          <div className="skill-title-line">
            <h3 title={skill.name}>{skill.name}</h3>
            <button type="button" className="skill-id-copy-btn" tabIndex={-1} aria-label={`复制技能 ID: ${skill.id}`}>
              <IconCopy size={13} />
            </button>
          </div>
          {hasDifferentId ? (
            <p className="skill-id-sub" title={skill.id}>
              @{skill.id}
            </p>
          ) : null}
        </div>
        <div className="card-menu-wrap">
          <button type="button" className="card-menu-btn" tabIndex={-1} aria-label="更多操作">
            <IconMoreVertical size={16} />
          </button>
        </div>
      </div>
      <p className="desc" title={skill.description}>
        {skill.description}
      </p>
      <div className="skill-lang-row">
        <div className="skill-lang-left">
          <span className="skill-lang-label">{languageLabel(skill.language)}</span>
          {skill.translationCount > 0 ? (
            <span className="skill-translation-count">+{skill.translationCount} 译本</span>
          ) : null}
        </div>
        <span className="skill-usage muted">{formatUsageLabel(skill.usage, skill.lastUsedAt)}</span>
      </div>
      <div className="skill-meta">
        <div className="skill-tools-list">
          {skill.tools.map((tid) => (
            <span key={tid} className="badge tool" title={`已链接到 ${tid}`}>
              <span className="tool-dot" />
              {tid}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}

export function DemoSkills() {
  return (
    <div className="onboarding-demo onboarding-demo-skills skills-page" aria-hidden="true">
      <div className="page-sticky-header">
        <div className="page-toolbar">
          <div className="search-input-wrapper">
            <IconSearch size={16} className="search-icon" />
            <input type="search" placeholder="搜索技能名称或 ID… (按 / 聚焦)" value="" readOnly tabIndex={-1} aria-label="搜索技能" />
            <kbd className="search-kbd">/</kbd>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-primary btn-create-skill" tabIndex={-1}>
              <IconPlus size={16} />
              <span>新建技能</span>
            </button>
            <button type="button" className="btn btn-secondary btn-organize" tabIndex={-1}>
              <IconFolderSync size={16} />
              <span>一键整理</span>
            </button>
            <div className="toolbar-icon-group" role="group">
              <button type="button" className="btn btn-icon layout-toggle" tabIndex={-1}>
                <IconLayoutList size={18} />
              </button>
              <button type="button" className="btn btn-icon" tabIndex={-1}>
                <IconBulkToolLinks size={18} />
              </button>
              <button type="button" className="btn btn-icon" tabIndex={-1}>
                <IconTrash size={18} />
              </button>
              <button type="button" className="btn btn-icon" tabIndex={-1}>
                <IconRefresh size={18} />
              </button>
            </div>
          </div>
        </div>
        <div className="category-pills-bar">
          <div className="category-pills-scroll" role="tablist">
            <button type="button" className="category-pill is-active" tabIndex={-1}>
              <span className="pill-name">全部技能</span>
              <span className="pill-count">{DEMO_SKILLS.length}</span>
            </button>
            <button type="button" className="category-pill" tabIndex={-1}>
              <span className="pill-name">{groupDisplayName('default')}</span>
              <span className="pill-count">{DEMO_SKILLS.filter((s) => s.group === 'default').length}</span>
            </button>
            <button type="button" className="category-pill" tabIndex={-1}>
              <span className="pill-name">工作流</span>
              <span className="pill-count">{DEMO_SKILLS.filter((s) => s.group === '工作流').length}</span>
            </button>
          </div>
          <button type="button" className="category-pill-add" tabIndex={-1}>
            <IconPlus size={13} />
            <span>新增分组</span>
          </button>
          <div className="category-filters-right">
            <div className="tool-filter-wrap">
              <Select
                size="sm"
                variant="filter"
                value="all"
                onChange={() => undefined}
                prefixIcon={<IconWrench size={13} />}
                options={[
                  {value: 'all', label: '全部工具'},
                  {value: 'cursor', label: '已链接：cursor'},
                ]}
                ariaLabel="按已接入工具过滤"
                align="right"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="skills-list-area">
        <div className="skill-grid">
          {DEMO_SKILLS.map((skill) => (
            <DemoSkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      </div>
    </div>
  )
}
