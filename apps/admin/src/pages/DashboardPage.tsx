import { Link } from 'react-router-dom';
import { Button } from 'antd';
import { api } from '../api/client';
import { useAsync } from '../useAsync';
import { PageHead, PaperCard, AsyncBlock } from '../components/ui';
import { chartColors, tokens } from '../theme';

/** 数字格式化：4,231 次 / 65.0% */
const nf = new Intl.NumberFormat('zh-CN');
const fmtNum = (n: number) => nf.format(Math.round(n));

type StatDef = {
  label: string;
  value: string;
  unit?: string;
  foot: string;
  dot: string;
};

/**
 * 数据看板 —— 所有数字来自 GET /api/admin/dashboard 与 /api/admin/analytics/overview。
 *
 * 口径说明：M1 的看板只提供内容统计、健康度、家庭/儿童数与近 24h 播放事件；
 * 「完播率」等指标需要 play_event 聚合，M2 阶段先展示可验证的真实值，
 * 不虚构不可得的数据（见 01-product-brief §6 的指标定义）。
 */
export function DashboardPage() {
  const dash = useAsync(() => api.dashboard(), []);
  const analytics = useAsync(() => api.analyticsOverview(), []);

  const d = dash.data;

  const stats: StatDef[] = d
    ? [
        {
          label: '近 24 小时播放',
          value: fmtNum(d.plays24h),
          unit: '次',
          foot: '来自 app.play_event 真实事件',
          dot: chartColors[0],
        },
        {
          label: '已上架故事',
          value: fmtNum(d.content.published),
          unit: '篇',
          foot: `共 ${fmtNum(d.content.total)} 篇 · 草稿 ${d.content.draft}`,
          dot: chartColors[1],
        },
        {
          label: '待审核',
          value: fmtNum(d.content.review),
          unit: '篇',
          foot: d.content.review > 0 ? '需要编辑处理' : '队列已清空',
          dot: chartColors[2],
        },
        {
          label: '家庭 / 儿童',
          value: `${d.users.families} / ${d.users.children}`,
          foot: '已注册家庭与儿童档案数',
          dot: chartColors[3],
        },
      ]
    : [];

  // 内容健康度（01-product-brief §6：published 中缺封面/无音频/无年龄档占比 ≤ 5%）
  const health = d
    ? [
        { name: '待审核', desc: '等待编辑处理', num: d.content.review, color: tokens.warn, ratio: d.content.total ? d.content.review / d.content.total : 0 },
        { name: '缺封面', desc: '列表缩略图缺失', num: d.health.missingCover, color: tokens.info, ratio: d.content.total ? d.health.missingCover / d.content.total : 0 },
        { name: '无音频', desc: '当前全部走 TTS 实时合成', num: d.health.missingAudio, color: tokens.teal, ratio: d.content.total ? d.health.missingAudio / d.content.total : 0 },
        { name: '无年龄档', desc: '未标注适龄区间', num: d.health.missingAgeBand, color: tokens.danger, ratio: d.content.total ? d.health.missingAgeBand / d.content.total : 0 },
      ]
    : [];

  return (
    <>
      <PageHead
        title="数据看板"
        sub={d ? `数据截至 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 全站 ${fmtNum(d.content.total)} 篇故事` : '加载中…'}
        actions={
          <>
            <Link to="/analytics">
              <Button>查看数据中心</Button>
            </Link>
            <Link to="/review">
              <Button type="primary">去审核{d ? ` · ${d.content.review}` : ''}</Button>
            </Link>
          </>
        }
      />

      <AsyncBlock loading={dash.loading} error={dash.error} onRetry={dash.reload}>
        <div className="stat-grid" data-testid="stat-grid">
          {stats.map((s) => (
            <div className="stat-card" key={s.label}>
              <div className="stat-label">
                <i className="stat-dot" style={{ background: s.dot }} />
                {s.label}
              </div>
              <div className="stat-value">
                {s.value}
                {s.unit ? <span className="unit">{s.unit}</span> : null}
              </div>
              <div className="stat-foot">{s.foot}</div>
            </div>
          ))}
        </div>

        <div className="grid-2">
          <PaperCard title="播放时段分布" hint="按小时聚合 play_event · 睡前时段是核心场景">
            <AsyncBlock loading={analytics.loading} error={analytics.error} onRetry={analytics.reload} skeletonRows={5}>
              <HourBars data={analytics.data?.byHour ?? []} />
            </AsyncBlock>
          </PaperCard>

          <PaperCard title="内容健康度" hint={d ? `共 ${fmtNum(d.content.total)} 篇` : undefined}>
            {health.map((h) => (
              <div className="health-row" key={h.name}>
                <div className="health-top">
                  <span className="health-name">
                    <i className="stat-dot" style={{ background: h.color }} />
                    {h.name}
                    <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{h.desc}</span>
                  </span>
                  <span className="health-num" data-testid={`health-${h.name}`}>
                    {fmtNum(h.num)}
                  </span>
                </div>
                <div className="health-bar">
                  <i style={{ width: `${Math.min(100, h.ratio * 100)}%`, background: h.color }} />
                </div>
              </div>
            ))}
            <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
              <Link to="/review">
                <Button size="small">处理待审</Button>
              </Link>
              <Link to="/stories?band=3-6">
                <Button size="small">全部故事</Button>
              </Link>
            </div>
          </PaperCard>
        </div>
      </AsyncBlock>
    </>
  );
}

/** 24 小时播放柱状图（纯 CSS，避免为一个图引入图表库）。 */
function HourBars({ data }: { data: Array<{ hour: number; plays: number }> }) {
  const byHour = new Map(data.map((x) => [x.hour, x.plays]));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, plays: byHour.get(h) ?? 0 }));
  const max = Math.max(1, ...hours.map((h) => h.plays));

  if (data.length === 0) {
    return <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>暂无播放事件（dev 库需先执行 seed-dev-admin 脚本）</div>;
  }

  return (
    <div data-testid="hour-bars">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 170 }}>
        {hours.map((h) => {
          const bedtime = h.hour >= 20 && h.hour <= 22;
          return (
            <div
              key={h.hour}
              title={`${h.hour}:00 · ${h.plays} 次`}
              style={{
                flex: 1,
                height: `${Math.max(2, (h.plays / max) * 100)}%`,
                background: bedtime ? tokens.brand : chartColors[1],
                borderRadius: 4,
                minWidth: 4,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--ink-3)' }}>
        <span>0:00</span>
        <span>6:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, background: tokens.brand, borderRadius: 2, marginRight: 6 }} />
        20:00–22:00 睡前时段
      </div>
    </div>
  );
}
