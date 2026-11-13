import { useState } from 'react';
import { Segmented, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, type AnalyticsTopItem } from '../api/client';
import { useAsync } from '../useAsync';
import { PageHead, PaperCard, AsyncBlock } from '../components/ui';
import { chartColors, tokens } from '../theme';

type Range = '7' | '14' | '30';

/**
 * 数据中心 —— 全部数据来自服务端真实聚合（M2.1 项目 2）。
 *
 * 四个端点各司其职，页面**不虚构任何数字**：
 *   * /analytics/overview   —— 24 小时时段分布（睡前时段占比）
 *   * /analytics/top        —— 播放 Top 20（按 start 事件）
 *   * /analytics/trend      —— 近 N 天播放/完播趋势（日期已补齐）
 *   * /analytics/categories —— 分类分布 + 年龄档拆分
 *
 * 图表用原生 SVG/div 绘制，不引入图表库：依赖越少，镜像越小，
 * 也避免为一个折线图多带几百 KB 的前端包。
 */
export function AnalyticsPage() {
  const [range, setRange] = useState<Range>('14');
  const days = Number(range);

  const overview = useAsync(() => api.analyticsOverview(), []);
  const top = useAsync(() => api.analyticsTop(20), []);
  const trend = useAsync(() => api.analyticsTrend(days), [days]);
  const categories = useAsync(() => api.analyticsCategories(), []);

  const byHour = overview.data?.byHour ?? [];
  const totalPlays = byHour.reduce((sum, x) => sum + x.plays, 0);
  const bedtime = byHour.filter((x) => x.hour >= 20 && x.hour <= 23).reduce((s, x) => s + x.plays, 0);
  const bedtimeRatio = totalPlays ? (bedtime / totalPlays) * 100 : 0;
  const peak = byHour.reduce<{ hour: number; plays: number } | null>((best, x) => (!best || x.plays > best.plays ? x : best), null);

  const trendItems = trend.data?.items ?? [];
  const trendPlays = trendItems.reduce((s, x) => s + x.plays, 0);
  const trendCompletes = trendItems.reduce((s, x) => s + x.completes, 0);
  const trendRate = trendPlays ? (trendCompletes / trendPlays) * 100 : 0;
  const trendMax = Math.max(1, ...trendItems.map((x) => x.plays));

  const categoryItems = categories.data?.items ?? [];
  const categoryTotal = categoryItems.reduce((s, c) => s + c.total, 0);
  const categoryMax = Math.max(1, ...categoryItems.map((c) => c.total));

  const topColumns: ColumnsType<AnalyticsTopItem> = [
    {
      title: '名次',
      key: 'rank',
      width: 70,
      render: (_v, _row, i) => (
        <span style={{ color: i < 3 ? tokens.brand : 'var(--ink-3)', fontWeight: i < 3 ? 600 : 400 }}>{i + 1}</span>
      ),
    },
    { title: 'ID', dataIndex: 'storyId', width: 80 },
    { title: '标题', dataIndex: 'title', render: (t: string | null) => t ?? '—' },
    { title: '播放', dataIndex: 'plays', width: 90, align: 'right' as const },
    {
      title: '完播率',
      dataIndex: 'completionRate',
      width: 110,
      align: 'right' as const,
      render: (r: number, row) => (
        <span data-testid={`top-rate-${row.storyId}`}>
          {r}% <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>({row.completes})</span>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title="数据中心"
        sub="全部为服务端真实聚合；睡前时段占比是 01-product-brief §6 的核心指标"
        actions={
          <Segmented
            value={range}
            onChange={(v) => setRange(v as Range)}
            options={[
              { label: '近 7 天', value: '7' },
              { label: '近 14 天', value: '14' },
              { label: '近 30 天', value: '30' },
            ]}
          />
        }
      />

      <AsyncBlock loading={overview.loading} error={overview.error} onRetry={overview.reload}>
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">
              <i className="stat-dot" style={{ background: chartColors[0] }} />
              累计播放
            </div>
            <div className="stat-value" data-testid="total-plays">
              {totalPlays.toLocaleString('zh-CN')}
              <span className="unit">次</span>
            </div>
            <div className="stat-foot">全部 play_event 的 start 事件数</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">
              <i className="stat-dot" style={{ background: tokens.brand }} />
              睡前时段占比
            </div>
            <div className="stat-value" data-testid="bedtime-ratio">
              {bedtimeRatio.toFixed(1)}
              <span className="unit">%</span>
            </div>
            <div className="stat-foot">20:00–23:00 / 全天 · 目标 ≥ 50%</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">
              <i className="stat-dot" style={{ background: chartColors[1] }} />
              近 {days} 天完播率
            </div>
            <div className="stat-value" data-testid="trend-rate">
              {trendRate.toFixed(1)}
              <span className="unit">%</span>
            </div>
            <div className="stat-foot">
              {trendCompletes.toLocaleString('zh-CN')} / {trendPlays.toLocaleString('zh-CN')} 次
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">
              <i className="stat-dot" style={{ background: chartColors[2] }} />
              播放高峰
            </div>
            <div className="stat-value">{peak ? `${peak.hour}:00` : '—'}</div>
            <div className="stat-foot">{peak ? `${peak.plays} 次播放` : '暂无数据'}</div>
          </div>
        </div>

        {/* ---------------- 播放时段分布 ---------------- */}
        <PaperCard title="播放时段分布" hint="按小时聚合（Asia/Shanghai）" style={{ marginBottom: 14 }}>
          {byHour.length === 0 ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>暂无播放事件</div>
          ) : (
            <div data-testid="analytics-hours">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 200 }}>
                {Array.from({ length: 24 }, (_, hour) => {
                  const plays = byHour.find((x) => x.hour === hour)?.plays ?? 0;
                  const isBedtime = hour >= 20 && hour <= 23;
                  return (
                    <div key={hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{plays || ''}</div>
                      <div
                        title={`${hour}:00 · ${plays} 次`}
                        style={{
                          width: '100%',
                          height: `${Math.max(2, (plays / Math.max(1, ...byHour.map((x) => x.plays))) * 150)}px`,
                          background: isBedtime ? tokens.brand : chartColors[1],
                          borderRadius: 4,
                        }}
                      />
                      <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{hour}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </PaperCard>

        {/* ---------------- 近 N 天趋势（M2.1 新增）---------------- */}
        <PaperCard title={`近 ${days} 天播放 / 完播趋势`} hint="缺失日期已补 0，折线不会被跳过" style={{ marginBottom: 14 }}>
          <AsyncBlock loading={trend.loading} error={trend.error} onRetry={trend.reload}>
            {trendItems.length === 0 ? (
              <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>暂无数据</div>
            ) : (
              <div data-testid="analytics-trend">
                {/* 双列柱：左=播放，右=完播；悬停显示当天明细。 */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 190 }}>
                  {trendItems.map((p) => (
                    <div
                      key={p.day}
                      title={`${p.day}\n播放 ${p.plays} · 完播 ${p.completes} · 完播率 ${p.completionRate}%`}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                    >
                      <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{p.plays || ''}</div>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 140, width: '100%', justifyContent: 'center' }}>
                        <div
                          style={{
                            width: '45%',
                            height: `${Math.max(2, (p.plays / trendMax) * 140)}px`,
                            background: tokens.brand,
                            borderRadius: 3,
                          }}
                        />
                        <div
                          style={{
                            width: '45%',
                            height: `${Math.max(2, (p.completes / trendMax) * 140)}px`,
                            background: chartColors[1],
                            borderRadius: 3,
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                        {p.day.slice(5)}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)' }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: tokens.brand, borderRadius: 2, marginRight: 4 }} />
                  播放
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: chartColors[1], borderRadius: 2, margin: '0 4px 0 14px' }} />
                  完播
                </div>
              </div>
            )}
          </AsyncBlock>
        </PaperCard>

        <div className="grid-2">
          {/* ---------------- 播放 Top 20（M2.1 新增）---------------- */}
          <PaperCard title="播放 Top 20" hint="按 start 事件排序">
            <AsyncBlock loading={top.loading} error={top.error} onRetry={top.reload}>
              {top.data?.items.length === 0 ? (
                <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>暂无播放记录</div>
              ) : (
                <Table<AnalyticsTopItem>
                  rowKey="storyId"
                  size="small"
                  columns={topColumns}
                  dataSource={top.data?.items ?? []}
                  pagination={false}
                  scroll={{ y: 420 }}
                  data-testid="analytics-top"
                />
              )}
            </AsyncBlock>
          </PaperCard>

          {/* ---------------- 分类分布（M2.1 新增）---------------- */}
          <PaperCard title="分类分布" hint={`已发布内容 · 共 ${categoryTotal} 篇`}>
            <AsyncBlock loading={categories.loading} error={categories.error} onRetry={categories.reload}>
              {categoryItems.length === 0 ? (
                <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>暂无数据</div>
              ) : (
                <div data-testid="analytics-categories">
                  {categoryItems.map((c) => (
                    <div key={c.categoryId ?? 'none'} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                        <span>{c.name}</span>
                        <span style={{ color: 'var(--ink-3)' }}>
                          {c.total} 篇
                          <span style={{ marginLeft: 8 }}>
                            {(c.bands['9+'] ?? 0) > 0 ? <Tag color="red" style={{ marginInlineEnd: 0 }}>9+ {c.bands['9+']}</Tag> : null}
                          </span>
                        </span>
                      </div>
                      {/* 堆叠条：按年龄档拆分，9+ 用警示色，避免儿童内容与 9+ 混看。 */}
                      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--surface-3, #F1EADD)' }}>
                        <div style={{ width: `${((c.bands['3-6'] ?? 0) / categoryMax) * 100}%`, background: chartColors[0] }} />
                        <div style={{ width: `${((c.bands['6-9'] ?? 0) / categoryMax) * 100}%`, background: chartColors[1] }} />
                        <div style={{ width: `${((c.bands['9+'] ?? 0) / categoryMax) * 100}%`, background: tokens.danger }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-3)' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: chartColors[0], borderRadius: 2, marginRight: 4 }} />
                    3-6
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: chartColors[1], borderRadius: 2, margin: '0 4px 0 14px' }} />
                    6-9
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: tokens.danger, borderRadius: 2, margin: '0 4px 0 14px' }} />
                    9+
                  </div>
                </div>
              )}
            </AsyncBlock>
          </PaperCard>
        </div>
      </AsyncBlock>
    </>
  );
}
