import {useCallback, useEffect, useMemo, useState} from 'react'
import {GetSkillUsageSummary} from '../../wailsjs/go/main/App'
import {AppToast, useAppToast} from '../components/AppToast'
import UsageTrendChart from '../components/UsageTrendChart'
import {
  aggregateDaily,
  buildDaySeries,
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

const EMPTY_TOAST_MESSAGE = '尚未记录到 skill 使用。读取 SKILL.md 后会自动更新统计'

export default function UsagePage({onOpenEditor, active = true}: Props) {
  const [summary, setSummary] = useState<SkillUsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState<UsageRange>(30)
  const [rankMode, setRankMode] = useState<RankMode>('range')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const {toast, showToast, dismissToast} = useAppToast()

  const load = useCallback(async () => {
    setError('')
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

  const skills = summary?.skills ?? []
  const ranked = useMemo(() => rankSkills(skills, rankMode, range), [skills, rankMode, range])

  const selected = useMemo(
    () => skills.find((s) => s.id === selectedId) ?? null,
    [skills, selectedId],
  )

  const trendPoints = useMemo(() => {
    if (selected) return buildDaySeries(selected.daily, range)
    return aggregateDaily(skills, range)
  }, [selected, skills, range])

  function onSelectSkill(item: SkillUsageItem) {
    setSelectedId((prev) => (prev === item.id ? null : item.id))
  }

  if (loading && !summary) {
    return <p className="muted">加载使用统计…</p>
  }

  return (
    <div className="usage-page">
      <AppToast toast={toast} onDismiss={dismissToast} />
      <div className="page-sticky-header">
        <div className="page-toolbar">
          <h2 className="usage-title">使用统计</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn" onClick={() => void load()}>
              刷新
            </button>
          </div>
        </div>
        <div className="usage-filters">
          <div className="usage-filter-group" role="group" aria-label="时间范围">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={String(opt.id)}
                type="button"
                className={range === opt.id ? 'chip is-active' : 'chip'}
                onClick={() => setRange(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="usage-filter-group" role="group" aria-label="排行口径">
            <button
              type="button"
              className={rankMode === 'range' ? 'chip is-active' : 'chip'}
              onClick={() => setRankMode('range')}
            >
              按范围内次数
            </button>
            <button
              type="button"
              className={rankMode === 'total' ? 'chip is-active' : 'chip'}
              onClick={() => setRankMode('total')}
            >
              按累计次数
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      <div className="usage-panels">
        <section className="usage-section usage-section-rank">
          <div className="usage-section-head">
            <h3>排行榜</h3>
            <p className="muted">
              {rankMode === 'total'
                ? '按累计使用次数排序'
                : `按${RANGE_OPTIONS.find((o) => o.id === range)?.label ?? ''}使用次数排序`}
            </p>
          </div>
          {ranked.length === 0 ? (
            <p className="muted">暂无已管理的 skill</p>
          ) : (
            <ol className="usage-rank-list">
              {ranked.map(({item, score}, index) => {
                const selectedRow = selectedId === item.id
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={selectedRow ? 'usage-rank-row is-selected' : 'usage-rank-row'}
                      onClick={() => onSelectSkill(item)}
                    >
                      <span className="usage-rank-index">{index + 1}</span>
                      <span className="usage-rank-main">
                        <span className="usage-rank-name">{item.name || item.id}</span>
                        <span className="usage-rank-id">{item.id}</span>
                      </span>
                      <span className="usage-rank-meta">
                        <span className="usage-rank-score">{score} 次</span>
                        <span className="muted">{formatLastUsed(item.lastUsedAt)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <section className="usage-section usage-section-trend">
          <div className="usage-section-head">
            <h3>{selected ? `${selected.name || selected.id} 的使用趋势` : '全体使用趋势'}</h3>
            <div className="usage-section-actions">
              {selected ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onOpenEditor(selected.id)}
                  >
                    打开编辑
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setSelectedId(null)}>
                    查看全体
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <UsageTrendChart
            points={trendPoints}
            emptyLabel={
              summary?.hasAnyRecord ? '所选范围内暂无使用记录' : '暂无趋势数据'
            }
          />
        </section>
      </div>
    </div>
  )
}
