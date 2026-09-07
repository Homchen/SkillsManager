import {useCallback, useEffect, useMemo, useState} from 'react'
import {GetSkillUsageSummary} from '../../wailsjs/go/main/App'
import {AppToast, useAppToast} from '../components/AppToast'
import AutoScrollText from '../components/AutoScrollText'
import UsageTrendChart from '../components/UsageTrendChart'
import {
  IconActivity,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconTrendingUp,
  IconTrophy,
  IconX,
} from '../components/icons'
import {
  aggregateDaily,
  buildDaySeries,
  calculateUsageMetrics,
  countInRange,
  formatLastUsed,
  rankSkills,
  type RankMode,
  type UsageRange,
} from '../lib/skillUsage'
import type {SkillUsageItem, SkillUsageSummary} from '../types'

type Props = {
  onOpenEditor: (skillId: string) => void
  active?: boolean
}

const RANGE_OPTIONS: {id: UsageRange; label: string}[] = [
  {id: 7, label: '近 7 天'},
  {id: 30, label: '近 30 天'},
  {id: 90, label: '近 90 天'},
  {id: 'all', label: '全部'},
]

const RANK_MODE_OPTIONS: {id: RankMode; label: string}[] = [
  {id: 'range', label: '按范围内次数'},
  {id: 'total', label: '按累计总次数'},
]

const EMPTY_TOAST_MESSAGE = '尚未记录到 skill 使用。读取 SKILL.md 后会自动更新统计'

export default function UsagePage({onOpenEditor, active = true}: Props) {
  const [summary, setSummary] = useState<SkillUsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [range, setRange] = useState<UsageRange>(30)
  const [rankMode, setRankMode] = useState<RankMode>('range')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [smoothCurve, setSmoothCurve] = useState(true)
  const {toast, showToast, dismissToast} = useAppToast()

  const load = useCallback(async () => {
    setError('')
    setRefreshing(true)
    try {
      const raw = (await GetSkillUsageSummary()) as SkillUsageSummary
      const next = {
        skills: (raw?.skills ?? []).map((s) => ({
          ...s,
          daily: s.daily ?? {},
          count: s.count ?? 0,
        })),
        hasAnyRecord: Boolean(raw?.hasAnyRecord),
      }
      setSummary(next)
      if (!next.hasAnyRecord) {
        showToast({message: EMPTY_TOAST_MESSAGE, tone: 'info'})
      } else {
        dismissToast()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      dismissToast()
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [dismissToast, showToast])

  useEffect(() => {
    if (!active) return
    void load()
  }, [active, load])

  useEffect(() => {
    if (!active) {
      dismissToast()
    }
  }, [active, dismissToast])

  const skills = useMemo(() => summary?.skills ?? [], [summary])

  const metrics = useMemo(() => {
    return calculateUsageMetrics(skills, range)
  }, [skills, range])

  const ranked = useMemo(() => {
    return rankSkills(skills, rankMode, range)
  }, [skills, rankMode, range])

  const maxRankScore = useMemo(() => {
    return ranked.length > 0 ? Math.max(1, ranked[0].score) : 1
  }, [ranked])

  const filteredRanked = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return ranked
    return ranked.filter(
      (r) =>
        r.item.id.toLowerCase().includes(q) ||
        (r.item.name && r.item.name.toLowerCase().includes(q)),
    )
  }, [ranked, searchQuery])

  const selected = useMemo(
    () => skills.find((s) => s.id === selectedId) ?? null,
    [skills, selectedId],
  )

  const selectedScore = useMemo(() => {
    if (!selected) return 0
    return rankMode === 'total' ? selected.count ?? 0 : countInRange(selected, range)
  }, [selected, rankMode, range])

  const selectedShare = useMemo(() => {
    if (!selected || metrics.totalInRange <= 0) return '0%'
    const inRange = countInRange(selected, range)
    return `${((inRange / metrics.totalInRange) * 100).toFixed(1)}%`
  }, [selected, range, metrics.totalInRange])

  const trendPoints = useMemo(() => {
    if (selected) return buildDaySeries(selected.daily, range)
    return aggregateDaily(skills, range)
  }, [selected, skills, range])

  function onSelectSkill(item: SkillUsageItem) {
    setSelectedId((prev) => (prev === item.id ? null : item.id))
  }

  function handleTopSkillCardClick() {
    if (!metrics.topSkill) return
    if (selectedId === metrics.topSkill.item.id) {
      setSelectedId(null)
    } else {
      setSelectedId(metrics.topSkill.item.id)
    }
  }

  if (loading && !summary) {
    return (
      <div className="usage-page-loading">
        <div className="usage-spinner" />
        <p className="muted">正在加载技能使用统计…</p>
      </div>
    )
  }

  const rangeLabel = RANGE_OPTIONS.find((o) => o.id === range)?.label ?? ''

  return (
    <div className="usage-page">
      <AppToast toast={toast} onDismiss={dismissToast} />

      {/* 顶部控制栏 */}
      <header className="usage-top-bar">
        <div className="usage-top-titles">
          <div className="usage-title-row">
            <h2 className="usage-title">使用统计</h2>
            <span className="usage-badge-indicator">
              <span className="usage-status-dot" />
              Hook 实时追踪
            </span>
          </div>
          <p className="usage-subtitle muted">
            追踪 Agent 在开发过程中对技能的调用频次与生命周期热度
          </p>
        </div>

        <div className="usage-controls">
          <div className="usage-segmented" role="group" aria-label="时间范围">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={String(opt.id)}
                type="button"
                className={range === opt.id ? 'usage-segment is-active' : 'usage-segment'}
                onClick={() => setRange(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="usage-segmented" role="group" aria-label="排行口径">
            {RANK_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={rankMode === opt.id ? 'usage-segment is-active' : 'usage-segment'}
                onClick={() => setRankMode(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-refresh"
            onClick={() => void load()}
            title="刷新统计数据"
            disabled={refreshing}
          >
            <IconRefresh size={16} className={refreshing ? 'is-spinning' : ''} />
            <span>刷新</span>
          </button>
        </div>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      {/* 4 个核心指标卡片 */}
      <section className="usage-kpi-grid">
        <div className="usage-kpi-card">
          <div className="usage-kpi-head">
            <span className="usage-kpi-label">{rangeLabel}调用总量</span>
            <div className="usage-kpi-icon-wrap is-accent">
              <IconActivity size={18} />
            </div>
          </div>
          <div className="usage-kpi-value-row">
            <span className="usage-kpi-num">{metrics.totalInRange.toLocaleString()}</span>
            <span className="usage-kpi-unit">次</span>
          </div>
          <div className="usage-kpi-foot muted">
            <span>累计总用量 {metrics.totalAllTime.toLocaleString()} 次</span>
            {metrics.dailyAverage > 0 ? (
              <span>日均 {metrics.dailyAverage} 次</span>
            ) : null}
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
              {metrics.activeSkillsCount}
              <span className="usage-kpi-total"> / {metrics.totalSkillsCount}</span>
            </span>
            <span className="usage-kpi-unit">个</span>
          </div>
          <div className="usage-kpi-foot muted">
            <span>
              活跃率{' '}
              {metrics.totalSkillsCount > 0
                ? `${((metrics.activeSkillsCount / metrics.totalSkillsCount) * 100).toFixed(0)}%`
                : '0%'}
            </span>
            <span>已管理技能总库</span>
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
            <span className="usage-kpi-num">
              {metrics.peakDay ? metrics.peakDay.count.toLocaleString() : 0}
            </span>
            <span className="usage-kpi-unit">次</span>
          </div>
          <div className="usage-kpi-foot muted">
            <span>
              {metrics.peakDay ? `记录于 ${metrics.peakDay.date}` : '暂无峰值数据'}
            </span>
          </div>
        </div>

        <div
          className={`usage-kpi-card is-interactive ${
            selectedId && metrics.topSkill && selectedId === metrics.topSkill.item.id
              ? 'is-selected'
              : ''
          }`}
          onClick={handleTopSkillCardClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleTopSkillCardClick()
            }
          }}
          title={metrics.topSkill ? '点击高亮聚焦该技能' : undefined}
        >
          <div className="usage-kpi-head">
            <span className="usage-kpi-label">最常使用技能 (Top 1)</span>
            <div className="usage-kpi-icon-wrap is-amber">
              <IconTrophy size={18} />
            </div>
          </div>
          <div className="usage-kpi-value-row">
            {metrics.topSkill ? (
              <AutoScrollText
                text={metrics.topSkill.item.name || metrics.topSkill.item.id}
                className="usage-kpi-top-title"
                title={metrics.topSkill.item.name || metrics.topSkill.item.id}
              />
            ) : (
              <span className="usage-kpi-top-title">—</span>
            )}
          </div>
          <div className="usage-kpi-foot muted">
            {metrics.topSkill ? (
              <>
                <span>调用 {metrics.topSkill.score} 次</span>
                {metrics.totalInRange > 0 ? (
                  <span>
                    占 {((metrics.topSkill.score / metrics.totalInRange) * 100).toFixed(1)}%
                  </span>
                ) : null}
              </>
            ) : (
              <span>暂无调用记录</span>
            )}
          </div>
        </div>
      </section>

      {/* 主面板内容 */}
      <div className="usage-panels">
        {/* 左侧：技能排行榜 */}
        <section className="usage-section usage-section-rank">
          <div className="usage-card usage-rank-card">
            <div className="usage-rank-header">
              <div className="usage-rank-header-titles">
                <div className="usage-rank-title-badge">
                  <h3>技能排行榜</h3>
                  <span className="usage-count-tag">{ranked.length}</span>
                </div>
                <p className="muted">
                  {rankMode === 'total'
                    ? '按累计历史调用量降序'
                    : `按${rangeLabel}内调用量降序`}
                </p>
              </div>

              {/* 搜索过滤框 */}
              <div className="usage-search-box">
                <IconSearch size={14} className="usage-search-icon" />
                <input
                  type="text"
                  placeholder="搜索技能名称或 ID…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="usage-search-input"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="usage-search-clear"
                    onClick={() => setSearchQuery('')}
                    title="清空搜索"
                  >
                    <IconX size={12} />
                  </button>
                ) : null}
              </div>
            </div>

            {/* 排行列表 */}
            <div className="usage-rank-list-wrapper">
              {filteredRanked.length === 0 ? (
                <div className="usage-rank-empty muted">
                  {searchQuery ? '未找到匹配的技能' : '暂无已管理的技能'}
                </div>
              ) : (
                <ol className="usage-rank-list">
                  {filteredRanked.map(({item, score}, index) => {
                    const isSelected = selectedId === item.id
                    const rankNum = index + 1
                    const percent = (score / maxRankScore) * 100

                    return (
                      <li key={item.id}>
                        <div
                          className={`usage-rank-row ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => onSelectSkill(item)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onSelectSkill(item)
                            }
                          }}
                        >
                          {/* 相对调用量对比进度背景条 */}
                          <div
                            className="usage-rank-bar-bg"
                            style={{width: `${Math.max(2, Math.min(100, percent))}%`}}
                          />

                          {/* 排名徽章 */}
                          <div className={`usage-rank-badge rank-${Math.min(rankNum, 4)}`}>
                            {rankNum === 1 ? (
                              <IconTrophy size={14} />
                            ) : (
                              <span>{rankNum}</span>
                            )}
                          </div>

                          {/* 技能信息 */}
                          <div className="usage-rank-main">
                            <AutoScrollText
                              text={item.name || item.id}
                              className="usage-rank-name"
                              mode="hover"
                              title={item.name || item.id}
                            />
                            <span className="usage-rank-id" title={item.id}>
                              {item.id}
                            </span>
                          </div>

                          {/* 数据指标 */}
                          <div className="usage-rank-meta">
                            <div className="usage-rank-score-wrap">
                              <span className="usage-rank-score">{score}</span>
                              <span className="usage-rank-score-unit">次</span>
                            </div>
                            <span className="usage-rank-time muted">
                              {formatLastUsed(item.lastUsedAt)}
                            </span>
                          </div>

                          {/* 快捷操作：直接打开编辑 */}
                          <button
                            type="button"
                            className="usage-rank-action-btn"
                            title="打开技能编辑"
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenEditor(item.id)
                            }}
                          >
                            <IconPencil size={14} />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          </div>
        </section>

        {/* 右侧：趋势图表区 */}
        <section className="usage-section usage-section-trend">
          <div className="usage-card usage-trend-card">
            <div className="usage-trend-header">
              <div className="usage-trend-title-block">
                <div className="usage-trend-title-line">
                  <h3 className="usage-trend-title">
                    {selected ? (
                      <>
                        <AutoScrollText
                          text={selected.name || selected.id}
                          className="usage-trend-highlight"
                          title={selected.name || selected.id}
                        />
                        <span className="usage-trend-tail">的调用趋势</span>
                      </>
                    ) : (
                      '全体技能调用趋势'
                    )}
                  </h3>
                  {selected ? (
                    <span className="usage-tag-share">占区间总量 {selectedShare}</span>
                  ) : null}
                </div>
                <p
                  className="muted usage-trend-subtitle"
                  title={
                    selected
                      ? `技能 ID: ${selected.id} · ${rangeLabel}累计使用 ${selectedScore} 次`
                      : `展示 ${rangeLabel}内全体技能的日度使用活跃走势`
                  }
                >
                  {selected
                    ? `技能 ID: ${selected.id} · ${rangeLabel}累计使用 ${selectedScore} 次`
                    : `展示 ${rangeLabel}内全体技能的日度使用活跃走势`}
                </p>
              </div>

              <div className="usage-trend-actions">
                <button
                  type="button"
                  className={`btn-subtle ${smoothCurve ? 'is-active' : ''}`}
                  onClick={() => setSmoothCurve(!smoothCurve)}
                  title={smoothCurve ? '切换为折线视图' : '切换为平滑曲线视图'}
                >
                  {smoothCurve ? '平滑曲线' : '折线模式'}
                </button>

                {selected ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost usage-btn-back"
                      onClick={() => setSelectedId(null)}
                      title="清除技能选中，返回查看全体趋势"
                    >
                      查看全体
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary usage-btn-edit"
                      onClick={() => onOpenEditor(selected.id)}
                      title="在技能编辑器中打开该技能"
                    >
                      <IconPencil size={14} />
                      <span>打开编辑</span>
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {/* 增强型图表组件 */}
            <UsageTrendChart
              points={trendPoints}
              smooth={smoothCurve}
              skillName={selected ? (selected.name || selected.id) : '全体调用'}
              emptyLabel={
                summary?.hasAnyRecord ? '所选时段内暂无调用记录' : '尚未产生调用数据'
              }
            />

            {/* 图表底部微型统计栏 */}
            <div className="usage-chart-footer-stats">
              <div className="usage-stat-chip">
                <span className="muted">时段总计:</span>
                <strong>
                  {trendPoints.reduce((acc, p) => acc + p.count, 0).toLocaleString()} 次
                </strong>
              </div>
              <div className="usage-stat-chip">
                <span className="muted">覆盖天数:</span>
                <strong>{trendPoints.length} 天</strong>
              </div>
              <div className="usage-stat-chip">
                <span className="muted">最高单日:</span>
                <strong>
                  {Math.max(0, ...trendPoints.map((p) => p.count)).toLocaleString()} 次
                </strong>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
