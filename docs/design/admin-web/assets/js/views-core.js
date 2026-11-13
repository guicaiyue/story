/* 小故事铺 · 核心视图：数据看板 / 故事列表 / 故事编辑 / 审核队列 */

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function badge(status) {
  const m = STATUS_META[status] || STATUS_META.draft;
  return `<span class="badge ${m.cls}">${m.label}</span>`;
}
function audioCell(story) {
  return story.audio
    ? `<span class="badge badge-pub">已生成</span>`
    : `<span class="badge badge-plain">待生成 TTS</span>`;
}
/* 有上传封面时展示上传图（完整画幅，不裁切），否则用分类插画占位 */
function coverHtml(story, opts) {
  const o = opts || {};
  const cls = o.className || "cover";
  if (story && story.coverUrl) {
    const alt = o.alt || `《${story.title}》封面`;
    return `<img class="${cls}" src="${esc(story.coverUrl)}" alt="${esc(alt)}" style="object-fit:contain;background:var(--surface-2)" />`;
  }
  return coverSvgByStory(story, { className: cls });
}
function pageHead(title, sub, actions) {
  return `<div class="page-head">
    <div>
      <h1>${title}</h1>
      ${sub ? `<div class="sub">${sub}</div>` : ""}
    </div>
    ${actions ? `<div class="head-actions">${actions}</div>` : ""}
  </div>`;
}
function pagerHtml(page, totalPages, totalItems, pageId) {
  const nums = [];
  const win = 2;
  for (let i = 1; i <= totalPages; i += 1) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= win) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const btns = nums
    .map((n) =>
      n === "…"
        ? `<span class="page-gap">…</span>`
        : `<button type="button" class="page-btn" data-act="page" data-page="${n}" ${n === page ? 'aria-current="true"' : ""} aria-label="第 ${n} 页">${n}</button>`
    )
    .join("");
  return `<div class="pager" data-pager="${pageId}">
    <span class="text-2">共 <strong class="tnum">${fmtNum(totalItems)}</strong> 条 · 第 <span class="tnum">${page}</span> / <span class="tnum">${totalPages}</span> 页</span>
    <div class="pages">
      <button type="button" class="page-btn" data-act="page" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="上一页">上一页</button>
      ${btns}
      <button type="button" class="page-btn" data-act="page" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""} aria-label="下一页">下一页</button>
    </div>
  </div>`;
}
function emptyState(title, desc, action) {
  return `<div class="empty">${emptyArt()}<h3>${title}</h3><p>${desc}</p>${action || ""}</div>`;
}

/* ---------- 趋势图悬浮 ---------- */
function bindTrendHover(wrap, days, key) {
  const tip = wrap.querySelector(".chart-tip");
  const svg = wrap.querySelector("svg");
  const hit = svg.querySelector(".trend-hit");
  const cursor = svg.querySelector(".trend-cursor");
  const dots = svg.querySelectorAll(".trend-dot");
  const idx = CHART_INDEX.trend;
  if (!idx || !hit || !tip) return;
  const show = (i) => {
    const p = idx.pts[i];
    if (!p) return;
    tip.hidden = false;
    tip.innerHTML = trendTooltipHtml(p.d, key);
    tip.style.left = `${(p.x / 760) * 100}%`;
    tip.style.top = `${(p.y / 262) * 100}%`;
    cursor.setAttribute("x1", p.x);
    cursor.setAttribute("x2", p.x);
    cursor.setAttribute("opacity", "1");
    dots.forEach((d, di) => d.setAttribute("opacity", di === i ? "1" : "0"));
  };
  hit.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 760;
    const i = Math.max(0, Math.min(idx.pts.length - 1, Math.round((x - idx.plot.x0) / idx.plot.step)));
    show(i);
  });
  hit.addEventListener("mouseleave", () => {
    tip.hidden = true;
    cursor.setAttribute("opacity", "0");
    dots.forEach((d, di) => d.setAttribute("opacity", di === idx.pts.length - 1 ? "1" : "0"));
  });
}

/* ================= 数据看板 ================= */
const VIEWS = {};

VIEWS.dashboard = {
  label: "数据看板",
  crumbs: ["工作台", "数据看板"],
  render() {
    const h = healthSummary(S.stories);
    const days = S.trend.slice(-14);
    const last = S.trend[S.trend.length - 1];
    const prev = S.trend[S.trend.length - 2];
    const dPlays = (last.plays - prev.plays) / prev.plays;
    const dListeners = (last.listeners - prev.listeners) / prev.listeners;
    const dCompletion = last.completion - prev.completion;
    const delta = (v, suffix) =>
      `<span class="delta ${v > 0 ? "up" : v < 0 ? "down" : "flat"}">${v > 0 ? "▲" : v < 0 ? "▼" : "—"} ${Math.abs(v * 100).toFixed(1)}${suffix}</span>`;
    const top = S.stories
      .filter((s) => s.status === "published")
      .slice(0, 240)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 6);
    const queuePreview = S.stories.filter((s) => s.status === "pending").slice(0, 4);
    const noCover = S.stories.filter((s) => !s.hasCover).slice(0, 4);

    return `<div class="page">
      ${pageHead(
        "数据看板",
        `数据截至 ${fmtClock(new Date())} · 全站 <strong class="tnum">${fmtNum(h.total)}</strong> 篇故事 · ${CATEGORIES.length} 个分类`,
        `<button type="button" class="btn btn-secondary" data-act="go" data-route="analytics">查看数据中心</button>
         <button type="button" class="btn btn-primary" data-act="go" data-route="review">去审核 · ${h.pending}</button>`
      )}
      <div class="stack-4">
        <div class="grid-kpi">
          <div class="kpi">
            <div class="kpi-label"><span class="nav-dot" style="background:var(--c1)"></span>今日播放</div>
            <div class="kpi-value">${fmtNum(last.plays)}<span class="unit">次</span></div>
            <div class="kpi-foot">${delta(dPlays, "%")} 较昨日 ${svgSparkline(S.trend.slice(-14).map((d) => d.plays), "var(--c1)", true, 86, 26)}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label"><span class="nav-dot" style="background:var(--c2)"></span>听众人数</div>
            <div class="kpi-value">${fmtNum(last.listeners)}<span class="unit">人</span></div>
            <div class="kpi-foot">${delta(dListeners, "%")} 较昨日</div>
          </div>
          <div class="kpi">
            <div class="kpi-label"><span class="nav-dot" style="background:var(--c4)"></span>完播率</div>
            <div class="kpi-value">${fmtPct(last.completion)}</div>
            <div class="kpi-foot">${delta(dCompletion, " 个百分点")} 较昨日</div>
          </div>
          <div class="kpi">
            <div class="kpi-label"><span class="nav-dot" style="background:var(--c6)"></span>新增家庭</div>
            <div class="kpi-value">${fmtNum(S.metrics.newFamilies)}<span class="unit">个</span></div>
            <div class="kpi-foot"><span class="delta up">▲ 12.4%</span> 较昨日 · 近 7 日累计 ${fmtNum(S.metrics.newFamilies * 7 - 214)} 个</div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-head">
              <h2>播放趋势</h2>
              <span class="hint">近 14 天 · 单日播放量</span>
              <div class="head-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-act="go" data-route="analytics">近 30 天</button>
              </div>
            </div>
            <div class="card-body tight">
              <div class="chart-wrap chart-trend">
                ${svgTrendChart(days, "plays")}
                <div class="chart-tip" hidden></div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h2>内容健康度</h2>
              <span class="hint">共 ${fmtNum(h.total)} 篇</span>
            </div>
            <div class="card-body">
              <div class="health-row">
                <div class="hl"><span class="badge badge-pending">待审核</span><span class="text-2">等待编辑处理</span></div>
                <div class="hv">${fmtNum(h.pending)}</div>
                <div class="bar"><i style="width:${((h.pending / h.total) * 100).toFixed(1)}%;background:var(--warn)"></i></div>
              </div>
              <div class="health-row">
                <div class="hl"><span class="badge badge-offline">缺封面</span><span class="text-2">列表缩略图缺失</span></div>
                <div class="hv">${fmtNum(h.missingCover)}</div>
                <div class="bar"><i style="width:${((h.missingCover / h.total) * 100).toFixed(1)}%;background:var(--info)"></i></div>
              </div>
              <div class="health-row">
                <div class="hl"><span class="badge badge-draft">无音频</span><span class="text-2">当前全部走 TTS 实时合成</span></div>
                <div class="hv">${fmtNum(h.noAudio)}</div>
                <div class="bar"><i style="width:${((h.noAudio / h.total) * 100).toFixed(1)}%;background:var(--c3)"></i></div>
              </div>
              <div class="od-row" style="margin-top:var(--sp-4)">
                <button type="button" class="btn btn-secondary btn-sm" data-act="go" data-route="review">处理待审</button>
                <button type="button" class="btn btn-secondary btn-sm" data-act="filter-no-cover">筛选缺封面</button>
                <button type="button" class="btn btn-ghost btn-sm" data-act="go" data-route="stories">全部故事</button>
              </div>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-head">
              <h2>待办</h2>
              <span class="hint">按紧急程度排序</span>
              <div class="head-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="go" data-route="review">全部</button></div>
            </div>
            <div class="card-body tight">
              <div class="stack-4">
                <div class="notice notice-warn"><span class="badge badge-pending">待审</span><div><strong>${fmtNum(h.pending)} 篇故事等待审核</strong>，最早一篇已等待 6 天，建议今天处理。</div></div>
                <div class="notice notice-info"><span class="badge badge-offline">封面</span><div><strong>${fmtNum(h.missingCover)} 篇缺封面</strong>，缺封面的故事无法提交审核。</div></div>
                ${queuePreview
                  .slice(0, 2)
                  .map(
                    (s) => `<div class="od-row">
                      ${coverSvgByStory(s, { className: "cover" })}
                      <div class="od-fill">
                        <div class="od-truncate" style="font-size:14px;font-weight:500">${esc(s.title)}</div>
                        <div class="text-3" style="font-size:12px">${catName(s.category)} · ${s.age} 岁 · 提交于 ${relDate(s.submittedAt, S.today)}</div>
                      </div>
                      <button type="button" class="btn btn-secondary btn-sm" data-act="open-review" data-id="${s.id}">审核</button>
                    </div>`
                  )
                  .join("")}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h2>今日热门故事</h2>
              <span class="hint">按播放量</span>
            </div>
            <div class="card-body tight">
              <div class="top-list">
                ${top
                  .map(
                    (s, i) => `<div class="top-item">
                      <span class="rank ${i < 3 ? "hot" : ""}">${i + 1}</span>
                      <div class="od-fill">
                        <div class="od-truncate" style="font-size:14px">${esc(s.title)}</div>
                        <div class="text-3" style="font-size:12px">${catName(s.category)}</div>
                      </div>
                      <span class="tnum text-2" style="text-align:right">${fmtNum(s.plays)}</span>
                      <span class="tnum text-3" style="width:48px;text-align:right">${fmtPct(s.completion, 0)}</span>
                    </div>`
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>缺封面故事（待补图）</h2><span class="hint">先补齐高播放量的</span></div>
          <div class="card-body tight">
            <div class="od-grid" style="--od-cols:4;--od-gap:12px">
              ${noCover
                .map(
                  (s) => `<div class="od-row">
                    <div class="cover empty" aria-hidden="true">缺图</div>
                    <div class="od-fill">
                      <div class="od-truncate" style="font-size:13px">${esc(s.title)}</div>
                      <div class="text-3" style="font-size:12px">${catName(s.category)}</div>
                    </div>
                    <button type="button" class="link-btn" data-act="edit-story" data-id="${s.id}">去编辑</button>
                  </div>`
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>
    </div>`;
  },
  mount(root) {
    const wrap = root.querySelector(".chart-trend");
    if (wrap) bindTrendHover(wrap, S.trend.slice(-14), "plays");
  },
};

/* ================= 故事列表 ================= */
function matchStory(s, q) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    s.title.toLowerCase().includes(needle) ||
    s.id.toLowerCase().includes(needle) ||
    s.author.toLowerCase().includes(needle) ||
    s.tags.some((t) => t.toLowerCase().includes(needle))
  );
}
function filteredStories() {
  const q = S.list.q;
  let list = S.stories.filter(
    (s) =>
      (S.list.category === "all" || s.category === S.list.category) &&
      (S.list.age === "all" || s.age === S.list.age) &&
      (S.list.status === "all" || s.status === S.list.status) &&
      (S.list.cover === "all" || (S.list.cover === "missing" ? !s.hasCover : s.hasCover)) &&
      matchStory(s, q)
  );
  const sorters = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    plays: (a, b) => b.plays - a.plays,
    words: (a, b) => b.words - a.words,
    completion: (a, b) => b.completion - a.completion,
  };
  list = list.sort(sorters[S.list.sort] || sorters.updated);
  return list;
}

VIEWS.stories = {
  label: "故事列表",
  crumbs: ["内容管理", "故事列表"],
  render() {
    const all = filteredStories();
    const pageSize = S.list.pageSize;
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    const page = Math.min(S.list.page, totalPages);
    S.list.page = page;
    const rows = all.slice((page - 1) * pageSize, page * pageSize);
    const selected = S.list.selected;
    const catOpts = CATEGORIES.map(
      (c) => `<option value="${c.id}" ${S.list.category === c.id ? "selected" : ""}>${c.name}</option>`
    ).join("");
    const ageOpts = AGE_BANDS.map(
      (a) => `<option value="${a.id}" ${S.list.age === a.id ? "selected" : ""}>${a.name}</option>`
    ).join("");
    const statusOpts = Object.keys(STATUS_META)
      .map((k) => `<option value="${k}" ${S.list.status === k ? "selected" : ""}>${STATUS_META[k].label}</option>`)
      .join("");

    return `<div class="page">
      ${pageHead(
        "故事列表",
        `共 <strong class="tnum">${fmtNum(S.stories.length)}</strong> 篇 · 当前筛选 <strong class="tnum">${fmtNum(all.length)}</strong> 篇 · 缺封面 ${fmtNum(S.stories.filter((s) => !s.hasCover).length)} 篇`,
        `<button type="button" class="btn btn-secondary" data-act="filter-no-cover">只看缺封面</button>
         <button type="button" class="btn btn-primary" data-act="new-story">新建故事</button>`
      )}
      <div class="card">
        <div class="filters">
          <label class="filter-item"><span>分类</span>
            <select class="select" data-filter="category"><option value="all">全部分类</option>${catOpts}</select>
          </label>
          <label class="filter-item"><span>年龄档</span>
            <select class="select" data-filter="age"><option value="all">全部年龄</option>${ageOpts}</select>
          </label>
          <label class="filter-item"><span>状态</span>
            <select class="select" data-filter="status"><option value="all">全部状态</option>${statusOpts}</select>
          </label>
          <label class="filter-item"><span>排序</span>
            <select class="select" data-filter="sort">
              <option value="updated" ${S.list.sort === "updated" ? "selected" : ""}>最近更新</option>
              <option value="plays" ${S.list.sort === "plays" ? "selected" : ""}>播放量</option>
              <option value="completion" ${S.list.sort === "completion" ? "selected" : ""}>完播率</option>
              <option value="words" ${S.list.sort === "words" ? "selected" : ""}>篇幅</option>
            </select>
          </label>
          <div class="filter-search">
            <label class="visually-hidden" for="story-search">搜索故事标题、编号、作者或标签</label>
            <input id="story-search" class="input" type="search" placeholder="搜索标题 / 编号 / 作者 / 标签" value="${esc(S.list.q)}" autocomplete="off" data-act="search-input" />
            <div data-suggest hidden></div>
          </div>
          <div class="filter-foot">
            ${
              S.list.cover === "missing"
                ? `<button type="button" class="chip is-active" data-act="filter-no-cover" aria-pressed="true">仅看缺封面 ✕</button>`
                : ""
            }
            <button type="button" class="link-btn" data-act="reset-filters">重置筛选</button>
          </div>
        </div>

        ${
          selected.size
            ? `<div class="bulk-bar">
                <strong>已选 ${selected.size} 篇</strong>
                <div class="grow"></div>
                <button type="button" class="btn btn-sm btn-secondary" data-act="bulk-status" data-status="published">批量上架</button>
                <button type="button" class="btn btn-sm btn-secondary" data-act="bulk-status" data-status="offline">批量下架</button>
                <button type="button" class="btn btn-sm btn-secondary" data-act="bulk-tag">批量打标签</button>
                <button type="button" class="btn btn-sm btn-ghost" data-act="clear-selection">取消选择</button>
              </div>`
            : ""
        }

        <div class="table-scroll">
          <table class="data">
            <thead>
              <tr>
                <th class="col-check"><input type="checkbox" data-act="check-all" aria-label="选择本页全部故事" ${rows.length && rows.every((s) => selected.has(s.id)) ? "checked" : ""} /></th>
                <th>故事</th>
                <th>分类</th>
                <th>年龄档</th>
                <th>状态</th>
                <th>音频</th>
                <th class="col-num">播放量</th>
                <th class="col-num">完播率</th>
                <th>更新时间</th>
                <th class="col-act">操作</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows
                      .map(
                        (s) => `<tr data-row="${s.id}" ${selected.has(s.id) ? 'aria-selected="true"' : ""}>
                  <td class="col-check"><input type="checkbox" data-act="check-row" data-id="${s.id}" aria-label="选择《${esc(s.title)}》" ${selected.has(s.id) ? "checked" : ""} /></td>
                  <td>
                    <div class="cell-story">
                      ${s.hasCover || s.coverUrl ? coverHtml(s, { className: "cover", alt: `《${s.title}》封面缩略图` }) : '<div class="cover empty" aria-hidden="true">缺图</div>'}
                      <div class="cs-body">
                        <span class="cs-title od-truncate">${esc(s.title)}</span>
                        <span class="cs-meta od-truncate">${s.id} · ${esc(s.author)} · ${esc(s.source)} · ${fmtNum(s.words)} 字</span>
                      </div>
                    </div>
                  </td>
                  <td class="nowrap">${catName(s.category)}</td>
                  <td class="nowrap">${s.age}${s.age === "9+" ? "" : " 岁"}</td>
                  <td>${badge(s.status)}</td>
                  <td>${audioCell(s)}</td>
                  <td class="col-num">${s.plays ? fmtNum(s.plays) : "—"}</td>
                  <td class="col-num">${s.plays ? fmtPct(s.completion, 0) : "—"}</td>
                  <td class="nowrap text-2">${relDate(s.updatedAt, S.today)}</td>
                  <td class="col-act">
                    <div class="row-actions">
                      <button type="button" class="link-btn" data-act="edit-story" data-id="${s.id}">编辑</button>
                      ${
                        s.status === "pending"
                          ? `<button type="button" class="link-btn" data-act="open-review" data-id="${s.id}">审核</button>`
                          : s.status === "published"
                          ? `<button type="button" class="link-btn danger" data-act="row-status" data-id="${s.id}" data-status="offline">下架</button>`
                          : `<button type="button" class="link-btn" data-act="row-status" data-id="${s.id}" data-status="published">上架</button>`
                      }
                    </div>
                  </td>
                </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="10">${emptyState("没有符合条件的故事", "试着放宽筛选条件，或清空搜索关键词后重试。", '<button type="button" class="btn btn-secondary btn-sm" data-act="reset-filters">重置筛选</button>')}</td></tr>`
              }
            </tbody>
          </table>
        </div>
        ${pagerHtml(page, totalPages, all.length, "stories")}
      </div>
    </div>`;
  },
  mount(root) {
    const input = root.querySelector("#story-search");
    if (input) {
      input.addEventListener("input", () => {
        const caret = input.selectionStart;
        S.list.q = input.value;
        renderApp();
        const next = document.getElementById("story-search");
        if (next) {
          next.focus();
          try {
            next.setSelectionRange(caret, caret);
          } catch (err) {
            /* 忽略不支持 setSelectionRange 的输入类型 */
          }
        }
        renderSuggest(document.querySelector("[data-suggest]"), next ? next.value : "");
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          S.list.q = input.value;
          renderApp();
          const first = document.querySelector('tbody [data-act="edit-story"]');
          if (first) first.focus();
        }
        if (e.key === "Escape") {
          input.value = "";
          S.list.q = "";
          renderApp();
          const next = document.getElementById("story-search");
          if (next) next.focus();
        }
      });
      input.addEventListener("blur", () => {
        window.setTimeout(() => {
          const box = document.querySelector("[data-suggest]");
          if (box) box.hidden = true;
        }, 180);
      });
      input.addEventListener("search", () => {
        if (!input.value) {
          S.list.q = "";
          renderApp();
          const next = document.getElementById("story-search");
          if (next) next.focus();
        }
      });
    }
  },
};
function renderSuggest(box, rawQuery) {
  if (!box) return;
  const q = (rawQuery || "").trim();
  if (!q) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const hits = S.stories.filter((s) => matchStory(s, q)).slice(0, 6);
  if (!hits.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.className = "suggest";
  box.innerHTML = hits
    .map(
      (s) => `<button type="button" data-act="pick-suggest" data-id="${s.id}">
        <span class="s-title od-truncate">${highlight(s.title, q)}</span>
        <span class="s-meta">${catName(s.category)} · ${STATUS_META[s.status].label}</span>
      </button>`
    )
    .join("");
}
function highlight(title, q) {
  const i = title.toLowerCase().indexOf(q.trim().toLowerCase());
  if (i < 0) return esc(title);
  return `${esc(title.slice(0, i))}<mark>${esc(title.slice(i, i + q.trim().length))}</mark>${esc(title.slice(i + q.trim().length))}`;
}

/* ================= 故事编辑 ================= */
VIEWS["story-edit"] = {
  label: "故事编辑",
  crumbs: ["内容管理", "故事编辑"],
  render() {
    const s = S.editing;
    const errors = S.editErrors;
    const words = s.body.replace(/\s/g, "").length;
    const estSec = Math.round((words / 220) * 60);
    const isNew = !S.editingId;
    const err = (k) => (errors[k] ? `<span class="field-error" id="err-${k}">⚠ ${errors[k]}</span>` : "");
    const invalid = (k) => (errors[k] ? " is-invalid" : "");
    const catOpts = CATEGORIES.map(
      (c) => `<option value="${c.id}" ${s.category === c.id ? "selected" : ""}>${c.name}</option>`
    ).join("");

    return `<div class="page">
      ${pageHead(
        isNew ? "新建故事" : `编辑故事 · 《${esc(s.title || "未命名")}》`,
        `${s.id} · 最近更新 ${relDate(s.updatedAt, S.today)} · 编辑 ${esc(s.editor)}`,
        `<button type="button" class="btn btn-secondary" data-act="go" data-route="stories">返回列表</button>
         <button type="button" class="btn btn-secondary" data-act="save-draft">保存草稿</button>
         <button type="button" class="btn btn-primary" data-act="submit-review">提交审核</button>`
      )}
      ${
        Object.keys(errors).length
          ? `<div class="notice notice-warn" style="margin-bottom:var(--sp-4)"><strong>还有 ${Object.keys(errors).length} 项需要处理：</strong><span>${Object.values(errors).join("；")}</span></div>`
          : ""
      }
      <div class="two-col">
        <div class="stack-4">
          <div class="card">
            <div class="card-head"><h2>基础信息</h2><span class="hint">面向 3-9 岁儿童的音频故事</span></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="field span-2">
                  <label class="field-label" for="f-title">故事标题<span class="req">*</span></label>
                  <input id="f-title" class="input${invalid("title")}" data-field="title" value="${esc(s.title)}" maxlength="40" placeholder="例如：纸片上的字" />
                  ${err("title") || '<span class="field-help">建议 4-12 个字，便于家长在列表中快速识别。</span>'}
                </div>
                <div class="field">
                  <label class="field-label" for="f-category">分类<span class="req">*</span></label>
                  <select id="f-category" class="select${invalid("category")}" data-field="category">
                    <option value="">请选择分类</option>${catOpts}
                  </select>
                  ${err("category") || '<span class="field-help">决定故事出现在哪个频道与歌单候选池。</span>'}
                </div>
                <div class="field">
                  <label class="field-label" for="f-source">来源</label>
                  <select id="f-source" class="select" data-field="source">
                    ${["原创", "公版改编", "签约作者"]
                      .map((v) => `<option value="${v}" ${s.source === v ? "selected" : ""}>${v}</option>`)
                      .join("")}
                  </select>
                  <span class="field-help">公版改编请确认原文已进入公有领域。</span>
                </div>
                <div class="field span-2">
                  <span class="field-label">年龄档<span class="req">*</span></span>
                  <div class="radio-cards" role="radiogroup" aria-label="年龄档">
                    ${AGE_BANDS.map(
                      (a) => `<label class="radio-card">
                        <input type="radio" name="age" value="${a.id}" data-field="age" ${s.age === a.id ? "checked" : ""} />
                        <span>${a.name}</span>
                        <span class="text-3" style="font-size:12px">${a.desc}</span>
                      </label>`
                    ).join("")}
                  </div>
                  ${err("age")}
                </div>
                <div class="field span-2">
                  <span class="field-label" for="f-tag-input">标签</span>
                  <div class="tag-editor" data-tag-editor>
                    ${s.tags.map((t) => `<span class="tag">${esc(t)}<button type="button" data-act="remove-tag" data-tag="${esc(t)}" aria-label="移除标签 ${esc(t)}">✕</button></span>`).join("")}
                    <input id="f-tag-input" type="text" placeholder="输入后按回车添加，如：哄睡" data-act="tag-input" />
                  </div>
                  <span class="field-help">最多 6 个标签，用于运营位筛选与推荐。</span>
                </div>
                <div class="field">
                  <label class="field-label" for="f-author">作者 / 主播</label>
                  <input id="f-author" class="input" data-field="author" value="${esc(s.author)}" placeholder="例如：林一禾" />
                </div>
                <div class="field">
                  <label class="field-label" for="f-dur">预计朗读时长</label>
                  <input id="f-dur" class="input" value="${fmtDuration(estSec)}" readonly />
                  <span class="field-help">按 TTS 每分钟约 220 字估算。</span>
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h2>正文</h2>
              <span class="hint">纯文本，空行分段</span>
              <div class="head-actions"><span class="text-2 tnum" id="word-count">${fmtNum(words)} 字</span></div>
            </div>
            <div class="card-body">
              <label class="visually-hidden" for="f-body">故事正文</label>
              <textarea id="f-body" class="textarea${invalid("body")}" data-field="body" placeholder="把故事正文粘贴到这里……">${esc(s.body)}</textarea>
              ${err("body") || '<span class="field-help">提交审核前正文不少于 100 字；TTS 会按段落自然停顿。</span>'}
            </div>
          </div>
        </div>

        <div class="stack-4 sticky-side">
          <div class="card">
            <div class="card-head"><h2>封面</h2><span class="hint">列表与播放页展示</span></div>
            <div class="card-body">
              ${
                s.hasCover || s.coverUrl
                  ? coverHtml(s, { className: "cover cover-lg", alt: `《${s.title || "未命名"}》封面预览` })
                  : `<div class="cover cover-lg empty" aria-hidden="true">暂无封面</div>`
              }
              <div class="field" style="margin-top:var(--sp-3)">
                <button type="button" class="btn btn-secondary btn-block" data-act="upload-cover">${s.hasCover || s.coverUrl ? "替换封面图片" : "上传封面图片"}</button>
                ${err("hasCover") || `<span class="field-help">建议 1200×900，主体居中，避免文字过多。</span>`}
              </div>
              ${
                !s.hasCover
                  ? `<div style="margin-top:var(--sp-3)">
                      <button type="button" class="btn btn-ghost btn-sm btn-block" data-act="gen-cover">先用分类插画占位</button>
                      <span class="field-help">占位图仅用于内部预览，上架前需替换为正式封面。</span>
                    </div>`
                  : ""
              }
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h2>音频</h2><span class="hint">TTS 实时合成</span></div>
            <div class="card-body">
              <div class="audio-box">
                <div class="wave" aria-hidden="true">
                  ${Array.from({ length: 26 })
                    .map((_, i) => {
                      const seed = ((s.id.charCodeAt(2) + i * 7) % 9) + 4;
                      return `<i style="height:${s.audio ? seed * 3 : 6}px" class="${s.audio && i < 16 ? "on" : ""}"></i>`;
                    })
                    .join("")}
                </div>
                <div style="flex:none;text-align:right">
                  <div style="font-size:13px;font-weight:500">${s.audio ? "已生成" : "未生成"}</div>
                  <div class="text-3" style="font-size:12px">${s.audio ? `${fmtDuration(estSec)} · ${esc(s.audio.voice)}` : "播放时实时合成"}</div>
                </div>
              </div>
              <div class="od-row" style="margin-top:var(--sp-3)">
                <button type="button" class="btn btn-secondary btn-sm" data-act="gen-tts" ${S.ttsBusy ? "disabled" : ""}>${S.ttsBusy ? "生成中…" : s.audio ? "重新生成" : "生成 TTS 试听"}</button>
                <span class="text-3" style="font-size:12px">${s.audio ? `生成于 ${relDate(s.audio.at, S.today)}` : "当前全站音频库存为 0，播放依赖实时合成"}</span>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h2>流程状态</h2></div>
            <div class="card-body">
              <div class="od-row" style="justify-content:space-between">
                <span class="text-2" style="font-size:13px">当前状态</span>
                ${badge(s.status)}
              </div>
              ${
                s.status === "rejected" && s.rejectReason
                  ? `<div class="notice notice-warn" style="margin-top:var(--sp-3)"><strong>驳回原因：</strong>${esc(s.rejectReason)}</div>`
                  : ""
              }
              <div class="timeline" style="margin-top:var(--sp-4)">
                <div class="timeline-item now"><span class="t-dot"></span><div><div>最近更新</div><div class="t-time">${fmtDateTime(s.updatedAt)} · ${esc(s.editor)}</div></div></div>
                <div class="timeline-item"><span class="t-dot"></span><div><div>创建</div><div class="t-time">${fmtDateTime(s.createdAt)}</div></div></div>
                ${s.submittedAt ? `<div class="timeline-item"><span class="t-dot"></span><div><div>提交审核</div><div class="t-time">${fmtDateTime(s.submittedAt)}</div></div></div>` : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  },
  mount(root) {
    const body = root.querySelector("#f-body");
    const count = root.querySelector("#word-count");
    if (body && count) {
      body.addEventListener("input", () => {
        S.editing.body = body.value;
        count.textContent = `${fmtNum(body.value.replace(/\s/g, "").length)} 字`;
      });
    }
    root.querySelectorAll("[data-field]").forEach((el) => {
      const key = el.dataset.field;
      const handler = () => {
        S.editing[key] = el.type === "radio" ? el.value : el.value;
        if (S.editErrors[key]) {
          delete S.editErrors[key];
          const msg = root.querySelector(`#err-${key}`);
          if (msg) msg.remove();
          el.classList.remove("is-invalid");
        }
      };
      el.addEventListener(el.tagName === "SELECT" || el.type === "radio" ? "change" : "input", handler);
    });
    const tagInput = root.querySelector('[data-act="tag-input"]');
    if (tagInput) {
      const addTag = () => {
        const v = tagInput.value.trim();
        if (!v) return;
        if (S.editing.tags.length >= 6) {
          toast("标签最多 6 个", "warn");
          return;
        }
        if (!S.editing.tags.includes(v)) S.editing.tags.push(v);
        tagInput.value = "";
        renderApp();
      };
      tagInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addTag();
        }
      });
      tagInput.addEventListener("blur", () => {
        if (tagInput.value.trim()) addTag();
      });
    }
  },
};

/* ================= 审核队列 ================= */
VIEWS.review = {
  label: "审核队列",
  crumbs: ["内容管理", "审核队列"],
  render() {
    const q = S.review.q.trim();
    const pending = S.stories
      .filter((s) => s.status === "pending")
      .filter((s) => matchStory(s, q))
      .sort((a, b) =>
        S.review.sort === "oldest" ? a.submittedAt - b.submittedAt : b.submittedAt - a.submittedAt
      );
    const pageSize = 8;
    const totalPages = Math.max(1, Math.ceil(pending.length / pageSize));
    const page = Math.min(S.review.page, totalPages);
    S.review.page = page;
    const pageItems = pending.slice((page - 1) * pageSize, page * pageSize);
    if (!pageItems.some((s) => s.id === S.review.selectedId)) {
      S.review.selectedId = pageItems.length ? pageItems[0].id : null;
    }
    const current = S.stories.find((s) => s.id === S.review.selectedId) || null;
    const avgWait = pending.length
      ? pending.reduce((sum, s) => sum + (S.today - s.submittedAt) / 86400000, 0) / pending.length
      : 0;

    return `<div class="page">
      ${pageHead(
        "审核队列",
        `待审 <strong class="tnum">${fmtNum(S.stories.filter((s) => s.status === "pending").length)}</strong> 篇 · 平均等待 <span class="tnum">${avgWait.toFixed(1)}</span> 天 · 驳回后回到编辑草稿`,
        `<button type="button" class="btn btn-secondary" data-act="go" data-route="stories">查看全部故事</button>`
      )}
      ${
        pending.length
          ? `<div class="two-col">
              <div class="card">
                <div class="card-head">
                  <h2>待审故事</h2>
                  <div class="head-actions">
                    <label class="visually-hidden" for="review-sort">排序方式</label>
                    <select id="review-sort" class="select" data-review-sort style="min-height:30px;width:132px">
                      <option value="newest" ${S.review.sort === "newest" ? "selected" : ""}>最新提交</option>
                      <option value="oldest" ${S.review.sort === "oldest" ? "selected" : ""}>等待最久</option>
                    </select>
                  </div>
                </div>
                <div class="card-body" style="padding-bottom:var(--sp-3)">
                  <label class="visually-hidden" for="review-search">搜索待审故事</label>
                  <input id="review-search" class="input" type="search" placeholder="搜索待审故事的标题、编号或作者" value="${esc(S.review.q)}" data-review-search />
                </div>
                <div class="card-body" style="padding-top:0">
                  <div class="stack-4" data-review-list>
                    ${pageItems
                      .map(
                        (s) => `<button type="button" class="review-item" data-act="select-review" data-id="${s.id}" ${s.id === S.review.selectedId ? 'aria-current="true"' : ""}>
                          ${s.hasCover || s.coverUrl ? coverHtml(s, { className: "cover", alt: `《${s.title}》封面缩略图` }) : '<div class="cover empty" aria-hidden="true">缺图</div>'}
                          <div class="od-fill">
                            <div class="od-truncate" style="font-size:14px;font-weight:500">${esc(s.title)}</div>
                            <div class="text-3" style="font-size:12px">${s.id} · ${catName(s.category)} · ${s.age} 岁 · ${fmtNum(s.words)} 字</div>
                            <div class="text-3" style="font-size:12px">提交于 ${relDate(s.submittedAt, S.today)} · ${esc(s.editor)}</div>
                          </div>
                          <span class="badge badge-pending">待审</span>
                        </button>`
                      )
                      .join("")}
                  </div>
                </div>
                ${pagerHtml(page, totalPages, pending.length, "review")}
              </div>

              <div class="card review-detail">
                ${
                  current
                    ? `<div class="card-head">
                        <h2>${esc(current.title)}</h2>
                        <div class="head-actions">${badge(current.status)}</div>
                      </div>
                      <div class="card-body">
                        <div class="od-row" style="align-items:flex-start;gap:var(--sp-4)">
                          ${current.hasCover || current.coverUrl ? `<div style="width:132px">${coverHtml(current, { className: "cover cover-lg", alt: `《${current.title}》封面` })}</div>` : '<div class="cover cover-lg empty" style="width:132px" aria-hidden="true">暂无封面</div>'}
                          <div class="od-fill">
                            <div class="kv" style="grid-template-columns:minmax(0,1fr)">
                              <div class="row"><span class="k">编号</span><span class="v">${current.id}</span></div>
                              <div class="row"><span class="k">分类</span><span class="v">${catName(current.category)}</span></div>
                              <div class="row"><span class="k">年龄档</span><span class="v">${current.age} 岁</span></div>
                              <div class="row"><span class="k">字数 / 时长</span><span class="v">${fmtNum(current.words)} 字 · ${fmtDuration(current.seconds)}</span></div>
                              <div class="row"><span class="k">提交人</span><span class="v">${esc(current.editor)}</span></div>
                              <div class="row"><span class="k">提交时间</span><span class="v">${fmtDateTime(current.submittedAt)}</span></div>
                            </div>
                            <div class="od-cluster" style="margin-top:var(--sp-3);--od-gap:6px">
                              ${current.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
                            </div>
                          </div>
                        </div>
                        ${
                          !current.hasCover
                            ? `<div class="notice notice-warn" style="margin-top:var(--sp-4)"><strong>缺少封面：</strong>上架前需要补一张封面，建议先退回编辑。</div>`
                            : ""
                        }
                        <div style="margin-top:var(--sp-4)">
                          <div class="field-label" style="margin-bottom:6px">正文（前 800 字预览）</div>
                          <div class="body-text">${esc(current.body.slice(0, 800))}</div>
                        </div>
                      </div>
                      <div class="dialog-foot">
                        <button type="button" class="btn btn-outline-danger" data-act="open-reject" data-id="${current.id}">驳回并说明原因</button>
                        <div class="grow"></div>
                        <button type="button" class="btn btn-secondary" data-act="edit-story" data-id="${current.id}">进入编辑</button>
                        <button type="button" class="btn btn-primary" data-act="approve" data-id="${current.id}">通过并上架</button>
                      </div>`
                    : emptyState("请选择左侧的一篇故事", "从待审列表里点选一篇，右侧会显示正文与提交信息。")
                }
              </div>
            </div>`
          : `<div class="card">${emptyState(
              "审核队列已清空",
              "当前没有待审故事。新提交的故事会出现在这里，最长等待时间会显示在页面顶部。",
              `<div class="od-row"><button type="button" class="btn btn-secondary btn-sm" data-act="go" data-route="stories">去看故事列表</button><button type="button" class="btn btn-secondary btn-sm" data-act="go" data-route="dashboard">回到看板</button></div>`
            )}</div>`
      }
    </div>`;
  },
  mount(root) {
    const input = root.querySelector("[data-review-search]");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          S.review.q = input.value;
          S.review.page = 1;
          renderApp();
          focusFirstReview();
        }
      });
      input.addEventListener("search", () => {
        S.review.q = input.value;
        S.review.page = 1;
        renderApp();
        focusFirstReview();
      });
    }
    const sort = root.querySelector("[data-review-sort]");
    if (sort) {
      sort.addEventListener("change", () => {
        S.review.sort = sort.value;
        S.review.page = 1;
        renderApp();
      });
    }
  },
};
function focusFirstReview() {
  const el = document.querySelector("[data-review-list] .review-item");
  if (el) el.focus();
}
