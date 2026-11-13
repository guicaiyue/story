/* 小故事铺 · 图表（全部手写 SVG，低饱和配色） */

const CHART_INDEX = {};

const SERIES_META = {
  plays: { label: "播放量", color: "var(--c1)", fmt: (v) => fmtNum(v) },
  listeners: { label: "听众人数", color: "var(--c2)", fmt: (v) => fmtNum(v) },
  completion: { label: "完播率", color: "var(--c4)", fmt: (v) => fmtPct(v) },
};

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1.2 ? 1.2 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/* 趋势折线（面积 + 折线 + 悬浮数值） */
function svgTrendChart(days, key) {
  const meta = SERIES_META[key] || SERIES_META.plays;
  const W = 760;
  const H = 262;
  const padL = 58;
  const padR = 14;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const values = days.map((d) => d[key]);
  const rawMax = Math.max.apply(null, values);
  const rawMin = Math.min.apply(null, values);
  const isRatio = key === "completion";
  const top = isRatio ? Math.min(1, rawMax * 1.06) : niceMax(rawMax * 1.08);
  const bottom = isRatio ? Math.max(0, rawMin * 0.94) : 0;
  const span = top - bottom || 1;
  const step = days.length > 1 ? plotW / (days.length - 1) : plotW;
  const yOf = (v) => padT + plotH - ((v - bottom) / span) * plotH;
  const xOf = (i) => padL + i * step;

  const pts = days.map((d, i) => ({ x: xOf(i), y: yOf(d[key]), v: d[key], d: d.date }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)} ${padT + plotH} L${pts[0].x.toFixed(1)} ${padT + plotH} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => bottom + span * t);
  const grid = ticks
    .map((t) => {
      const y = yOf(t).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-width="1"/>
        <text x="${padL - 10}" y="${Number(y) + 4}" text-anchor="end" font-size="11" fill="var(--ink-3)">${isRatio ? fmtPct(t, 0) : fmtNum(t)}</text>`;
    })
    .join("");

  const every = days.length > 14 ? 5 : 2;
  const xLabels = days
    .map((d, i) =>
      i % every === 0 || i === days.length - 1
        ? `<text x="${xOf(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="var(--ink-3)">${d.date.getMonth() + 1}/${d.date.getDate()}</text>`
        : ""
    )
    .join("");

  const dots = pts
    .map(
      (p, i) =>
        `<circle class="trend-dot" data-i="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${i === pts.length - 1 ? 4 : 2.6}" fill="${meta.color}" stroke="var(--surface)" stroke-width="1.6" opacity="${i === pts.length - 1 ? 1 : 0}"/>`
    )
    .join("");

  CHART_INDEX.trend = { pts, key, meta, plot: { x0: padL, step, padT, plotH } };

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${meta.label}近 ${days.length} 天走势">
    ${grid}
    <path d="${area}" fill="${meta.color}" fill-opacity="0.13"/>
    <path d="${line}" fill="none" stroke="${meta.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xLabels}
    <line class="trend-cursor" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="var(--line-strong)" stroke-width="1" opacity="0"/>
    <rect class="trend-hit" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent"/>
  </svg>`;
}

function trendTooltipHtml(day, key) {
  const meta = SERIES_META[key] || SERIES_META.plays;
  return `<strong>${fmtDate(day.date)}</strong><br>${meta.label} ${meta.fmt(day[key])}`;
}

/* 迷你走势（KPI 卡） */
function svgSparkline(values, color, fill, w, h) {
  const W = w || 108;
  const H = h || 32;
  const max = Math.max.apply(null, values);
  const min = Math.min.apply(null, values);
  const span = max - min || 1;
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => [i * step, H - 4 - ((v - min) / span) * (H - 10)]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" style="display:block">
    <path d="${area}" fill="${color}" fill-opacity="${fill ? 0.15 : 0}"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* 内容 Top：横向条形（真实 SVG） */
function svgTopBars(items, metricKey) {
  const rowH = 30;
  const gap = 8;
  const labelW = 148;
  const valueW = 74;
  const W = 700;
  const H = items.length * (rowH + gap) - gap;
  const max = Math.max.apply(null, items.map((s) => s[metricKey])) || 1;
  const bars = items
    .map((s, i) => {
      const y = i * (rowH + gap);
      const w = Math.max(4, ((s[metricKey] / max) * (W - labelW - valueW - 12)));
      const cat = CATEGORY_BY_ID[s.category];
      const title = s.title.length > 8 ? `${s.title.slice(0, 8)}…` : s.title;
      const value = metricKey === "completion" ? fmtPct(s.completion) : fmtNum(s[metricKey]);
      return `<g>
        <title>${s.title} · ${catName(s.category)} · ${value}</title>
        <text x="0" y="${y + 20}" font-size="12.5" fill="var(--ink)">${title}</text>
        <rect x="${labelW}" y="${y + 5}" width="${W - labelW - valueW - 12}" height="18" rx="6" fill="var(--surface-2)"/>
        <rect x="${labelW}" y="${y + 5}" width="${w.toFixed(1)}" height="18" rx="6" fill="${cat ? cat.palette[1] : "var(--c1)"}" fill-opacity="0.85"/>
        <text x="${W}" y="${y + 20}" text-anchor="end" font-size="12.5" fill="var(--ink-2)" style="font-variant-numeric:tabular-nums">${value}</text>
      </g>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${SERIES_META[metricKey] ? SERIES_META[metricKey].label : "内容排行"}">${bars}</svg>`;
}

/* 分类分布：环形图 */
function svgDonut(items, total, size) {
  const S = size || 220;
  const cx = S / 2;
  const cy = S / 2;
  const r = S / 2 - 12;
  const inner = r * 0.62;
  let angle = -Math.PI / 2;
  const sum = total || 1;
  const arcs = items
    .map((it) => {
      const sweep = (it.total / sum) * Math.PI * 2;
      const a0 = angle;
      const a1 = angle + sweep;
      angle = a1;
      if (sweep <= 0.0001) return "";
      const large = sweep > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const xi1 = cx + inner * Math.cos(a1);
      const yi1 = cy + inner * Math.sin(a1);
      const xi0 = cx + inner * Math.cos(a0);
      const yi0 = cy + inner * Math.sin(a0);
      const d = `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${xi1.toFixed(2)} ${yi1.toFixed(2)} A${inner} ${inner} 0 ${large} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z`;
      return `<path d="${d}" fill="${it.palette[1]}" fill-opacity="0.9"><title>${it.name} ${it.total} 篇</title></path>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="分类内容分布">
    ${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="600" fill="var(--ink)" style="font-variant-numeric:tabular-nums">${fmtNum(total)}</text>
    <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="12" fill="var(--ink-2)">篇故事</text>
  </svg>`;
}

/* 时段分布：24 小时柱状 */
function svgHourly(buckets) {
  const W = 700;
  const H = 220;
  const padL = 40;
  const padR = 8;
  const padT = 14;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max.apply(null, buckets.map((b) => b.value));
  const colW = plotW / buckets.length;
  const bars = buckets
    .map((b, i) => {
      const h = (b.value / max) * plotH;
      const x = padL + i * colW + colW * 0.16;
      const w = colW * 0.68;
      const y = padT + plotH - h;
      const peak = b.value === max && b.value > 0;
      const color = peak ? "var(--brand)" : "var(--c2)";
      const label = i % 3 === 0 ? `<text x="${(padL + i * colW + colW / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--ink-3)">${pad2(b.hour)}:00</text>` : "";
      return `<g><title>${pad2(b.hour)}:00–${pad2((b.hour + 1) % 24)}:00 · 占比 ${fmtPct(b.share)}</title>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color}" fill-opacity="${peak ? 0.95 : 0.75}"/>
        ${label}</g>`;
    })
    .join("");
  const axis = [0, 0.5, 1]
    .map((t) => {
      const y = padT + plotH - plotH * t;
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>
        <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--ink-3)">${fmtPct(max * t, 0)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="收听时段分布">${axis}${bars}</svg>`;
}

/* 空状态小插画 */
function emptyArt() {
  return `<svg class="empty-art" viewBox="0 0 120 90" aria-hidden="true">
    <rect x="18" y="14" width="84" height="62" rx="10" fill="none" stroke="var(--line-strong)" stroke-width="2" stroke-dasharray="5 5"/>
    <path d="M42 46 l12 12 l24 -26" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
