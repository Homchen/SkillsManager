import {
  IconBulkToolLinks,
  IconChevron,
  IconFolderPlus,
  IconFolderSync,
  IconLayoutGrid,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '../components/icons'
import {
  DEMO_BULK_TOOLS,
  DEMO_ORGANIZE_ACTIONS,
  DEMO_ORGANIZE_REPORT,
  DEMO_ORGANIZE_SKIPPED,
  DEMO_SKILLS,
} from './demoData'
import {groupDisplayName, STATUS_LABELS} from '../types'
import {languageLabel} from '../lib/languages'
import {formatUsageLabel} from '../lib/skillUsage'

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
  const sections = executed
    ? [{type: 'skip', label: '跳过', items: DEMO_ORGANIZE_SKIPPED}]
    : [
        {
          type: 'move_to_hub',
          label: '迁入源仓',
          items: DEMO_ORGANIZE_ACTIONS.filter((a) => a.type === 'move_to_hub'),
        },
        {
          type: 'replace_with_symlink',
          label: '替换为链接',
          items: DEMO_ORGANIZE_ACTIONS.filter((a) => a.type === 'replace_with_symlink'),
        },
      ]
  const canExecute = previewFilled && !executed

  return (
    <div className="onboarding-demo onboarding-demo-organize organize-page" aria-hidden="true">
      <div className="page-toolbar">
        <button type="button" className="btn" data-tour="demo-back" tabIndex={-1}>
          返回
        </button>
        <h2 className="page-title">一键整理</h2>
        <button type="button" className="btn btn-primary" data-tour="demo-preview" tabIndex={-1}>
          生成预览
        </button>
        <button type="button" className="btn" tabIndex={-1}>
          深度扫描
        </button>
        {report || executed ? (
          <button type="button" className="btn" tabIndex={-1}>
            查看执行报告
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          data-tour="demo-execute"
          disabled={!canExecute}
          tabIndex={-1}
        >
          开始执行
        </button>
      </div>
      {!previewFilled ? (
        <div className="empty-state">点击「生成预览」查看整理计划。</div>
      ) : (
        <section className="panel">
          <div className="section-head">
            <h3>{executed ? '执行计划（执行后重新扫描）' : '执行计划'}</h3>
            {!executed ? (
              <label className="organize-select-all">
                <input type="checkbox" checked readOnly tabIndex={-1} />
                全选
                <span className="muted">
                  （{actions.length}/{actions.length}）
                </span>
              </label>
            ) : null}
          </div>
          <div className="organize-plan-search">
            <input
              type="search"
              placeholder="搜索技能 ID 或来源路径…"
              value=""
              readOnly
              tabIndex={-1}
              aria-label="搜索执行计划"
            />
          </div>
          {executed ? (
            <p className="muted">
              这是执行完成后的最新预览，不是刚才那次执行的明细。已整理好的技能会显示为「跳过」。成功/失败详见
              <button type="button" className="link-btn" tabIndex={-1}>
                执行报告
              </button>
              。
            </p>
          ) : null}
          <div className="organize-action-groups skill-groups">
            {sections.map((sec) => (
              <section className="skill-group-section" key={sec.type}>
                <button type="button" className="skill-group-header organize-action-group-header" tabIndex={-1}>
                  <span className="organize-action-group-chevron" aria-hidden="true">
                    ▾
                  </span>
                  <span className="organize-action-group-title">
                    {sec.label}
                    <span className="muted organize-action-group-count">（{sec.items.length}）</span>
                  </span>
                </button>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>选中</th>
                        <th>技能 ID</th>
                        <th>来源路径</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.items.map((action) => (
                        <tr key={action.skillId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={action.selected}
                              disabled={executed}
                              readOnly
                              tabIndex={-1}
                            />
                          </td>
                          <td>
                            <span className="mono">{action.skillId}</span>
                          </td>
                          <td className="mono muted">{action.sources.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </section>
      )}
      {report ? <DemoOrganizeReport /> : null}
    </div>
  )
}

function DemoOrganizeReport() {
  const ok = DEMO_ORGANIZE_REPORT.succeeded
  return (
    <div className="dialog-backdrop">
      <div className="dialog dialog-report" data-tour="demo-report-close">
        <div className="dialog-conflict-head">
          <h2>执行报告</h2>
          <button type="button" className="btn" tabIndex={-1}>
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
            <div className="report-block report-muted is-collapsed">
              <button type="button" className="report-block-header" tabIndex={-1}>
                <span className="report-block-chevron" aria-hidden="true">
                  ▸
                </span>
                <span className="report-block-dot" />
                跳过（0）
              </button>
            </div>
            <div className="report-block report-danger is-collapsed">
              <button type="button" className="report-block-header" tabIndex={-1}>
                <span className="report-block-chevron" aria-hidden="true">
                  ▸
                </span>
                <span className="report-block-dot" />
                失败（0）
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DemoBulk({step}: {step: 1 | 2}) {
  const selected = DEMO_BULK_TOOLS.filter((t) => t.selected)
  // Must stay below .onboarding-spot, otherwise the mask hole cannot cut into this dialog.
  return (
    <div className="onboarding-demo onboarding-demo-bulk" aria-hidden="true">
      <div className="dialog dialog-wide dialog-bulk">
        <header className="bulk-dialog-head">
          <div>
            <h2>按工具批量启用 / 禁用</h2>
            <p className="bulk-dialog-desc">
              {step === 1
                ? '选择要操作的工作目录（工具 skills 根）'
                : '确认已选目录后，选择启用或禁用'}
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
                  <label
                    key={tool.id}
                    className={tool.selected ? 'bulk-tool-item is-selected' : 'bulk-tool-item'}
                  >
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
                <div className="bulk-choice-grid" data-tour="demo-toggle">
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

function DemoSkillCard({
  skill,
}: {
  skill: (typeof DEMO_SKILLS)[number]
}) {
  return (
    <article className="skill-card">
      <div className="card-menu-wrap">
        <button type="button" className="card-menu-btn" tabIndex={-1} aria-label="更多操作">
          ⋯
        </button>
      </div>
      <div className="skill-name-row">
        <h3>{skill.name}</h3>
      </div>
      <p className="skill-id">{skill.id}</p>
      <p className="desc">{skill.description}</p>
      <div className="skill-lang-row">
        <span className="skill-lang-left">
          <span className="skill-lang-label">{languageLabel(skill.language)}</span>
        </span>
        <span className="skill-usage muted">{formatUsageLabel(skill.usage)}</span>
      </div>
      <div className="skill-meta">
        <span className={`badge status-${skill.status}`}>
          {STATUS_LABELS[skill.status] ?? skill.status}
        </span>
        {skill.tools.map((tid) => (
          <span key={tid} className="badge tool">
            {tid}
          </span>
        ))}
      </div>
    </article>
  )
}

export function DemoGrouped() {
  const groups = [
    {id: 'default', skills: DEMO_SKILLS.filter((s) => s.group === 'default')},
    {id: '工作流', skills: DEMO_SKILLS.filter((s) => s.group === '工作流')},
  ]
  return (
    <div className="onboarding-demo onboarding-demo-grouped skills-page" aria-hidden="true">
      <div className="page-sticky-header">
        <div className="page-toolbar">
          <button
            type="button"
            className="btn btn-icon layout-toggle is-active"
            tabIndex={-1}
            title="切换到平铺布局"
            aria-label="切换到平铺布局"
            aria-pressed="true"
          >
            <IconLayoutGrid size={22} />
          </button>
          <input type="search" placeholder="搜索名称或 ID…" value="" readOnly tabIndex={-1} aria-label="搜索技能" />
          <div className="toolbar-actions">
            <button type="button" className="btn btn-primary btn-icon" tabIndex={-1} title="新建" aria-label="新建">
              <IconPlus size={22} />
            </button>
            <button type="button" className="btn btn-icon" tabIndex={-1} title="新增分组" aria-label="新增分组">
              <IconFolderPlus size={22} />
            </button>
            <button type="button" className="btn btn-icon" tabIndex={-1} title="一键整理" aria-label="一键整理">
              <IconFolderSync size={22} />
            </button>
            <button type="button" className="btn btn-icon" tabIndex={-1} title="刷新" aria-label="刷新">
              <IconRefresh size={22} />
            </button>
            <button type="button" className="btn btn-icon" tabIndex={-1} title="回收站" aria-label="回收站">
              <IconTrash size={22} />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              tabIndex={-1}
              title="按工具批量启用 / 禁用"
              aria-label="按工具批量启用 / 禁用"
            >
              <IconBulkToolLinks size={22} />
            </button>
          </div>
        </div>
      </div>
      <div className="skills-list-area">
        <div className="skill-groups">
          {groups.map((sec) => (
            <section className="skill-group-section" key={sec.id}>
              <div className="skill-group-header">
                <div className="skill-group-title-row">
                  <h2>{groupDisplayName(sec.id)}</h2>
                  <button type="button" className="skill-group-collapse" tabIndex={-1} aria-label="折叠分组">
                    <IconChevron size={20} className="skill-group-collapse-chevron open" />
                  </button>
                </div>
              </div>
              <div className="skill-grid">
                {sec.skills.map((skill) => (
                  <DemoSkillCard key={skill.id} skill={skill} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
