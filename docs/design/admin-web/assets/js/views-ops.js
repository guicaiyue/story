/* 小故事铺 · 运营 / 用户档案 / 数据中心 / 系统视图 */

function tabbar(items, active, act) {
  return `<div class="seg" role="tablist" aria-label="视图切换">
    ${items
      .map(
        (it) => `<button type="button" role="tab" aria-selected="${it.id === active}" aria-pressed="${it.id === active}" data-act="${act}" data-tab="${it.id}">${it.label}</button>`
      )
      .join("")}
  </div>`;
}

/* ================= 运营：分类管理 + 首页推荐位 ================= */
VIEWS.ops = {
  label: "分类与推荐位",
  crumbs: ["运营", "分类与推荐位"],
  render() {
    const tab = S.ops.tab;
    const head = pageHead(
      "运营配置",
      tab === "category" ? "分类顺序决定 App 首页频道的排列，也会影响推荐位的候选顺序" : "首页 banner、精选位与场景歌单直接影响每天的播放量",
      `<button type="button" class="btn btn-secondary" data-act="go" data-route="analytics">看效果数据</button>`
    );
    const body = tab === "category" ? opsCategory() : opsSlots();
    return `<div class="page">${head}
      <div style="margin-bottom:var(--sp-4)">
        ${tabbar(
          [
            { id: "category", label: "分类管理" },
            { id: "slots", label: "首页推荐位" },
          ],
          tab,
          "ops-tab"
        )}
      </div>
      ${body}
    </div>`;
  },
  mount(root) {
    const list = root.querySelector("[data-sort-list]");
    if (!list) return;
    let draggingId = null;
    list.querySelectorAll("[data-cat-row]").forEach((row) => {
      row.addEventListener("dragstart", (e) => {
        draggingId = row.dataset.catRow;
        row.classList.add("dragging");
        try {
          e.dataTransfer.setData("text/plain", draggingId);
          e.dataTransfer.effectAllowed = "move";
        } catch (err) {
          /* 沙箱可能禁用 dataTransfer，仍可用上下箭头排序 */
        }
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        list.querySelectorAll(".sort-row").forEach((r) => r.classList.remove("drop-target"));
        draggingId = null;
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (row.dataset.catRow !== draggingId) row.classList.add("drop-target");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drop-target");
        const from = draggingId || e.dataTransfer.getData("text/plain");
        moveCategory(from, row.dataset.catRow);
      });
    });
  },
};

function opsCategory() {
  return `<div class="card">
    <div class="card-head">
      <h2>分类管理</h2>
      <span class="hint">拖动左侧手柄，或用 ↑ ↓ 调整位置</span>
      <div class="head-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-act="reset-cat-order">恢复默认</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="save-cat-order">保存排序</button>
      </div>
    </div>
    <div class="card-body">
      <div class="sort-list" data-sort-list>
        ${S.categories
          .map((c, i) => {
            const stat = S.categoryStats[c.id] || { total: 0, published: 0 };
            return `<div class="sort-row" data-cat-row="${c.id}" draggable="true">
              <span class="drag-handle" aria-hidden="true">⠿</span>
              <div class="od-row" style="gap:var(--sp-3)">
                <span class="tnum text-3" style="width:16px">${i + 1}</span>
                ${coverArt(c.id, c.id, { className: "cover" })}
                <div class="od-fill">
                  <div style="font-size:14px;font-weight:500">${c.name}</div>
                  <div class="text-3" style="font-size:12px">${c.desc}</div>
                </div>
              </div>
              <div class="text-2 tnum nowrap" style="font-size:12px">${fmtNum(stat.total)} 篇 · 已上架 ${fmtNum(stat.published)}</div>
              <div class="od-row" style="gap:var(--sp-2)">
                <label class="switch-row" style="font-size:12px">
                  <input type="checkbox" data-act="toggle-cat" data-id="${c.id}" ${c.enabled ? "checked" : ""} aria-label="启用 ${c.name} 分类" />
                  ${c.enabled ? "启用" : "已停用"}
                </label>
                <button type="button" class="btn btn-icon btn-secondary" data-act="cat-up" data-id="${c.id}" aria-label="将 ${c.name} 上移" ${i === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="btn btn-icon btn-secondary" data-act="cat-down" data-id="${c.id}" aria-label="将 ${c.name} 下移" ${i === S.categories.length - 1 ? "disabled" : ""}>↓</button>
              </div>
            </div>`;
          })
          .join("")}
      </div>
      <div class="notice notice-info" style="margin-top:var(--sp-4)">
        <strong>提示：</strong>停用分类不会下架已有故事，但该分类会从 App 首页频道与新故事编辑入口中隐藏。
      </div>
    </div>
  </div>`;
}

function storyById(id) {
  return S.stories.find((s) => s.id === id) || null;
}
function opsSlots() {
  const o = S.ops;
  const bannerCards = o.banners
    .map((b) => {
      const first = storyById(b.storyIds[0]);
      return `<div class="slot-card">
        <div class="slot-thumb">${first ? coverSvgByStory(first, { className: "" }) : ""}</div>
        <div class="slot-body">
          <div class="od-row" style="gap:var(--sp-2)">
            <strong style="font-size:14px">${esc(b.title)}</strong>
            <span class="badge ${b.status === "展示中" ? "badge-pub" : "badge-draft"}">${b.status}</span>
          </div>
          <div class="text-2" style="font-size:13px">${esc(b.subtitle)}</div>
          <div class="text-3" style="font-size:12px">排期：${esc(b.period)} · 关联 ${b.storyIds.length} 篇故事</div>
          <div class="od-cluster" style="--od-gap:6px;margin-top:2px">
            ${b.storyIds
              .map((id) => {
                const s = storyById(id);
                return s ? `<span class="tag">${esc(s.title)}</span>` : "";
              })
              .join("")}
          </div>
          <div class="slot-actions">
            <button type="button" class="btn btn-sm btn-secondary" data-act="edit-banner" data-id="${b.id}">编辑</button>
            <button type="button" class="btn btn-sm btn-ghost" data-act="toggle-banner" data-id="${b.id}">${b.status === "展示中" ? "下线" : "上线"}</button>
            <button type="button" class="btn btn-sm btn-ghost" data-act="pick-story" data-mode="banner" data-id="${b.id}">替换内容</button>
          </div>
        </div>
      </div>`;
    })
    .join("");

  const featuredSlots = [];
  for (let i = 0; i < 8; i += 1) {
    const s = storyById(o.featured[i]);
    featuredSlots.push(
      s
        ? `<div class="slot-body" style="border:1px solid var(--line);border-radius:var(--r-md);padding:var(--sp-3);background:var(--surface)">
            <div class="od-row" style="gap:var(--sp-3)">
              ${coverSvgByStory(s, { className: "cover" })}
              <div class="od-fill">
                <div class="od-truncate" style="font-size:13px;font-weight:500">${esc(s.title)}</div>
                <div class="text-3" style="font-size:12px">${catName(s.category)} · ${fmtNum(s.plays)} 次播放</div>
              </div>
            </div>
            <div class="slot-actions" style="margin-top:var(--sp-2)">
              <button type="button" class="link-btn" data-act="featured-up" data-index="${i}" ${i === 0 ? "disabled" : ""}>前移</button>
              <button type="button" class="link-btn danger" data-act="remove-slot-story" data-mode="featured" data-index="${i}">移除</button>
            </div>
          </div>`
        : `<div class="slot-body" style="align-content:center;justify-items:center;border:1px dashed var(--line-strong);border-radius:var(--r-md);padding:var(--sp-4);background:var(--surface-2);text-align:center">
            <span class="text-3" style="font-size:12px">空位 ${i + 1}</span>
            <button type="button" class="btn btn-sm btn-secondary" data-act="pick-story" data-mode="featured">添加内容</button>
          </div>`
    );
  }

  const playlists = o.playlists
    .map(
      (p) => `<div class="playlist-row">
        <div class="cover" style="width:40px;height:40px">${coverArt(p.id, p.storyIds[0] ? storyById(p.storyIds[0]).category : "bedtime", { className: "" })}</div>
        <div>
          <div style="font-size:14px;font-weight:500">${esc(p.name)}</div>
          <div class="text-3" style="font-size:12px">${esc(p.desc)}</div>
        </div>
        <div class="text-2 tnum nowrap" style="font-size:12px">${p.storyIds.length} 篇 · ${esc(p.audience)} · ${esc(p.updatedAt)}</div>
        <div class="od-row" style="gap:var(--sp-2)">
          <button type="button" class="btn btn-sm btn-secondary" data-act="pick-story" data-mode="playlist" data-id="${p.id}">管理曲目</button>
        </div>
      </div>`
    )
    .join("");

  return `<div class="stack-4">
    <div class="card">
      <div class="card-head"><h2>首页 banner</h2><span class="hint">首屏轮播，建议 3 张以内</span>
        <div class="head-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="add-banner">新增 banner</button></div>
      </div>
      <div class="card-body"><div class="slot-grid">${bannerCards}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>精选位</h2><span class="hint">共 8 个位置，按顺序展示</span>
        <div class="head-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="pick-story" data-mode="featured">添加内容</button></div>
      </div>
      <div class="card-body">
        <div class="od-grid" style="--od-cols:4;--od-gap:12px">${featuredSlots.join("")}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>场景歌单</h2><span class="hint">按使用场景组织，播放页可直接进入</span>
        <div class="head-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="new-playlist">新建歌单</button></div>
      </div>
      <div class="card-body"><div class="stack-4">${playlists}</div></div>
    </div>
  </div>`;
}

function moveCategory(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const from = S.categories.findIndex((c) => c.id === fromId);
  const to = S.categories.findIndex((c) => c.id === toId);
  if (from < 0 || to < 0) return;
  const [moved] = S.categories.splice(from, 1);
  S.categories.splice(to, 0, moved);
  renderApp();
  toast(`已将「${moved.name}」移动到第 ${to + 1} 位`, "ok");
}

/* ================= 用户与儿童档案 ================= */
function filteredFamilies() {
  const q = S.families_.q.trim().toLowerCase();
  let list = S.families.filter(
    (f) =>
      (S.families_.status === "all" || f.status === S.families_.status) &&
      (!q ||
        f.id.toLowerCase().includes(q) ||
        f.nickname.toLowerCase().includes(q) ||
        f.phone.includes(q) ||
        f.city.includes(q))
  );
  const sorters = {
    monthly: (a, b) => b.monthlyMinutes - a.monthlyMinutes,
    active: (a, b) => b.lastActive - a.lastActive,
    registered: (a, b) => b.registeredAt - a.registeredAt,
  };
  return list.sort(sorters[S.families_.sort] || sorters.monthly);
}

VIEWS.families = {
  label: "家庭与儿童档案",
  crumbs: ["用户", "家庭与儿童档案"],
  render() {
    const all = filteredFamilies();
    const pageSize = S.families_.pageSize;
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    const page = Math.min(S.families_.page, totalPages);
    S.families_.page = page;
    const rows = all.slice((page - 1) * pageSize, page * pageSize);
    const childCount = S.families.reduce((sum, f) => sum + f.children.length, 0);
    const activeCount = S.families.filter((f) => f.status === "活跃").length;

    return `<div class="page">
      ${pageHead(
        "用户与儿童档案",
        `共 <strong class="tnum">${fmtNum(S.families.length)}</strong> 个家庭 · <strong class="tnum">${fmtNum(childCount)}</strong> 名儿童 · 近 7 日活跃 ${fmtNum(activeCount)} 个家庭`,
        `<button type="button" class="btn btn-secondary" data-act="go" data-route="analytics">收听数据</button>`
      )}
      <div class="card">
        <div class="filters">
          <div class="filter-search">
            <label class="visually-hidden" for="family-search">搜索家庭</label>
            <input id="family-search" class="input" type="search" placeholder="搜索家庭编号 / 家长昵称 / 手机号 / 城市" value="${esc(S.families_.q)}" data-act="family-search" />
          </div>
          <label class="filter-item"><span>活跃状态</span>
            <select class="select" data-family-status>
              ${["all", "活跃", "低频", "沉睡"]
                .map((v) => `<option value="${v}" ${S.families_.status === v ? "selected" : ""}>${v === "all" ? "全部状态" : v}</option>`)
                .join("")}
            </select>
          </label>
          <label class="filter-item"><span>排序</span>
            <select class="select" data-family-sort>
              <option value="monthly" ${S.families_.sort === "monthly" ? "selected" : ""}>近 30 天收听时长</option>
              <option value="active" ${S.families_.sort === "active" ? "selected" : ""}>最近活跃</option>
              <option value="registered" ${S.families_.sort === "registered" ? "selected" : ""}>注册时间</option>
            </select>
          </label>
        </div>
        <div class="table-scroll">
          <table class="data">
            <thead>
              <tr>
                <th>家庭</th>
                <th>城市</th>
                <th>儿童</th>
                <th class="col-num">近 30 天收听</th>
                <th class="col-num">今日收听</th>
                <th>最近活跃</th>
                <th>状态</th>
                <th class="col-act">操作</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows
                      .map(
                        (f) => `<tr>
                  <td>
                    <div class="cell-story">
                      <span class="avatar" aria-hidden="true">${esc(f.nickname.slice(0, 1))}</span>
                      <div class="cs-body">
                        <span class="cs-title">${esc(f.nickname)}</span>
                        <span class="cs-meta">${f.id} · ${maskPhone(f.phone)}</span>
                      </div>
                    </div>
                  </td>
                  <td class="nowrap">${f.city}</td>
                  <td class="nowrap">${f.children.map((c) => `${esc(c.name)}（${c.ageYears} 岁）`).join("、")}</td>
                  <td class="col-num">${fmtNum(f.monthlyMinutes)} 分钟</td>
                  <td class="col-num">${fmtNum(f.dailyMinutes)} 分钟</td>
                  <td class="nowrap text-2">${relDate(f.lastActive, S.today)}</td>
                  <td><span class="badge ${f.status === "活跃" ? "badge-pub" : f.status === "低频" ? "badge-offline" : "badge-draft"}">${f.status}</span></td>
                  <td class="col-act"><button type="button" class="link-btn" data-act="open-family" data-id="${f.id}">查看档案</button></td>
                </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="8">${emptyState("没有匹配的家庭", "换个手机号或昵称再试，或把状态筛选改为「全部状态」。")}</td></tr>`
              }
            </tbody>
          </table>
        </div>
        ${pagerHtml(page, totalPages, all.length, "families")}
      </div>
    </div>`;
  },
  mount(root) {
    const input = root.querySelector("[data-act='family-search']");
    if (input) {
      input.addEventListener("input", () => {
        const caret = input.selectionStart;
        S.families_.q = input.value;
        S.families_.page = 1;
        renderApp();
        const next = document.querySelector("[data-act='family-search']");
        if (next) {
          next.focus();
          try {
            next.setSelectionRange(caret, caret);
          } catch (err) {
            /* noop */
          }
        }
      });
    }
    const status = root.querySelector("[data-family-status]");
    if (status) {
      status.addEventListener("change", () => {
        S.families_.status = status.value;
        S.families_.page = 1;
        renderApp();
      });
    }
    const sort = root.querySelector("[data-family-sort]");
    if (sort) {
      sort.addEventListener("change", () => {
        S.families_.sort = sort.value;
        renderApp();
      });
    }
  },
};

VIEWS["family-detail"] = {
  label: "家庭档案",
  crumbs: ["用户", "家庭与儿童档案", "家庭详情"],
  render() {
    const f = S.families.find((x) => x.id === S.familyId);
    if (!f) {
      return `<div class="page">${pageHead("家庭不存在", "该家庭可能已被删除或编号有误。", '<button type="button" class="btn btn-secondary" data-act="go" data-route="families">返回家庭列表</button>')}</div>`;
    }
    const child = f.children[S.familyChildIndex] || f.children[0];
    const recPageSize = 10;
    const totalPages = Math.max(1, Math.ceil(child.records.length / recPageSize));
    const page = Math.min(S.familyRecPage, totalPages);
    S.familyRecPage = page;
    const recs = child.records.slice((page - 1) * recPageSize, page * recPageSize);
    const finishedRate = child.records.filter((r) => r.finished).length / child.records.length;

    return `<div class="page">
      ${pageHead(
        "家庭详情",
        `${f.id} · 注册于 ${fmtDate(f.registeredAt)} · 最近活跃 ${relDate(f.lastActive, S.today)}`,
        `<button type="button" class="btn btn-secondary" data-act="go" data-route="families">返回列表</button>`
      )}
      <div class="stack-4">
        <div class="card">
          <div class="card-body">
            <div class="profile-hero">
              <span class="avatar" style="width:48px;height:48px;font-size:18px" aria-hidden="true">${esc(f.nickname.slice(0, 1))}</span>
              <div class="ph-main">
                <h2>${esc(f.nickname)}</h2>
                <div class="text-2" style="font-size:13px">${maskPhone(f.phone)} · ${f.city} · <span class="badge ${f.status === "活跃" ? "badge-pub" : f.status === "低频" ? "badge-offline" : "badge-draft"}">${f.status}</span></div>
              </div>
              <div class="ph-stats">
                <span class="od-stat"><span>${fmtNum(f.children.length)}</span><span>儿童档案</span></span>
                <span class="od-stat"><span>${fmtNum(f.monthlyMinutes)}</span><span>近 30 天收听（分钟）</span></span>
                <span class="od-stat"><span>${fmtNum(f.dailyMinutes)}</span><span>今日收听（分钟）</span></span>
              </div>
            </div>
          </div>
        </div>

        <div class="grid-2-even">
          ${f.children
            .map(
              (c, i) => `<div class="child-card">
                <div class="child-head">
                  <span class="child-avatar" aria-hidden="true">${esc(c.name.slice(0, 1))}</span>
                  <div class="od-fill">
                    <div style="font-size:15px;font-weight:600">${esc(c.name)}</div>
                    <div class="text-3" style="font-size:12px">${c.id} · ${c.ageYears} 岁 · ${c.band} 岁档</div>
                  </div>
                  ${f.children.length > 1 ? `<button type="button" class="btn btn-sm ${i === S.familyChildIndex ? "btn-primary" : "btn-secondary"}" data-act="pick-child" data-index="${i}">${i === S.familyChildIndex ? "正在查看" : "查看记录"}</button>` : ""}
                </div>
                <div class="kv">
                  <div class="row"><span class="k">偏好分类</span><span class="v">${catName(c.favorite)}</span></div>
                  <div class="row"><span class="k">累计收听</span><span class="v">${fmtNum(c.totalMinutes)} 分钟</span></div>
                  <div class="row"><span class="k">连续收听</span><span class="v">${c.streakDays} 天</span></div>
                  <div class="row"><span class="k">完播比例</span><span class="v">${fmtPct(c.records.filter((r) => r.finished).length / c.records.length, 0)}</span></div>
                </div>
              </div>`
            )
            .join("")}
        </div>

        <div class="card">
          <div class="card-head">
            <h2>播放记录 · ${esc(child.name)}</h2>
            <span class="hint">只读 · 共 ${fmtNum(child.records.length)} 条 · 完播比例 ${fmtPct(finishedRate, 0)}</span>
          </div>
          <div class="table-scroll">
            <table class="data" style="min-width:720px">
              <thead>
                <tr>
                  <th>故事</th>
                  <th>分类</th>
                  <th>播放时间</th>
                  <th>设备</th>
                  <th class="col-num">收听时长</th>
                  <th class="col-num">完成度</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                ${recs
                  .map(
                    (r) => `<tr>
                  <td><span class="od-truncate" style="max-width:220px;font-weight:500">${esc(r.title)}</span></td>
                  <td class="nowrap">${catName(r.category)}</td>
                  <td class="nowrap text-2">${fmtDateTime(r.playedAt)}</td>
                  <td class="nowrap">${r.device}</td>
                  <td class="col-num">${fmtDuration(r.listenedSeconds)}</td>
                  <td class="col-num">${fmtPct(r.progress, 0)}</td>
                  <td>${r.finished ? '<span class="badge badge-pub">听完</span>' : '<span class="badge badge-draft">未听完</span>'}</td>
                </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${pagerHtml(page, totalPages, child.records.length, "family-records")}
        </div>
        <div class="notice notice-info"><strong>数据边界：</strong>播放记录来自客户端上报，仅用于收听行为分析；儿童档案不包含真实姓名与联系方式，家长可自行删除档案。</div>
      </div>
    </div>`;
  },
  mount() {},
};

/* ================= 数据中心 ================= */
VIEWS.analytics = {
  label: "数据中心",
  crumbs: ["数据分析", "数据中心"],
  render() {
    const range = S.analytics.range;
    const days = S.trend.slice(-range);
    const metric = S.analytics.metric;
    const totalPlays = days.reduce((sum, d) => sum + d.plays, 0);
    const avgPlays = totalPlays / days.length;
    const avgCompletion = days.reduce((sum, d) => sum + d.completion, 0) / days.length;
    const topStories = S.stories
      .filter((s) => s.status === "published")
      .slice(0, 400)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 10);
    const dist = S.categoryStats;
    const distSorted = CATEGORIES.map((c) => ({
      id: c.id,
      name: c.name,
      palette: c.palette,
      total: dist[c.id].total,
      published: dist[c.id].published,
      plays: dist[c.id].plays,
    })).sort((a, b) => b.plays - a.plays);
    const donutItems = distSorted.slice(0, 8);
    const restTotal = distSorted.slice(8).reduce((sum, d) => sum + d.total, 0);
    if (restTotal > 0) donutItems.push({ id: "rest", name: "其他分类", palette: ["#EFE9DF", "#A9A28C", "#CFC7B6"], total: restTotal, published: 0, plays: 0 });
    const hourly = S.hourly;
    const peak = hourly.reduce((a, b) => (b.value > a.value ? b : a), hourly[0]);
    const totalPlaysAll = distSorted.reduce((sum, d) => sum + d.plays, 0) || 1;

    return `<div class="page">
      ${pageHead(
        "数据中心",
        `统计范围：近 ${range} 天 · 覆盖 ${fmtNum(S.families.length)} 个家庭 · 数据按自然日汇总`,
        `<div class="seg" role="group" aria-label="时间范围">
          <button type="button" data-act="analytics-range" data-range="7" aria-pressed="${range === 7}">近 7 天</button>
          <button type="button" data-act="analytics-range" data-range="30" aria-pressed="${range === 30}">近 30 天</button>
        </div>`
      )}
      <div class="stack-4">
        <div class="grid-kpi">
          <div class="kpi">
            <div class="kpi-label">期间播放总量</div>
            <div class="kpi-value">${fmtNum(totalPlays)}<span class="unit">次</span></div>
            <div class="kpi-foot">近 ${range} 天累计</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">日均播放</div>
            <div class="kpi-value">${fmtNum(avgPlays)}<span class="unit">次</span></div>
            <div class="kpi-foot">按自然日平均</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">平均完播率</div>
            <div class="kpi-value">${fmtPct(avgCompletion)}</div>
            <div class="kpi-foot">低于 60% 的故事建议缩短篇幅</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">发布中故事</div>
            <div class="kpi-value">${fmtNum(S.stories.filter((s) => s.status === "published").length)}<span class="unit">篇</span></div>
            <div class="kpi-foot">占全部内容的 ${fmtPct(S.stories.filter((s) => s.status === "published").length / S.stories.length, 0)}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>播放趋势</h2>
            <span class="hint">近 ${range} 天</span>
            <div class="head-actions">
              ${tabbar(
                [
                  { id: "plays", label: "播放量" },
                  { id: "listeners", label: "听众人数" },
                  { id: "completion", label: "完播率" },
                ],
                metric,
                "analytics-metric"
              )}
            </div>
          </div>
          <div class="card-body">
            <div class="chart-wrap chart-trend">
              ${svgTrendChart(days, metric)}
              <div class="chart-tip" hidden></div>
            </div>
            <div class="chart-legend" style="margin-top:var(--sp-3)">
              <span class="lg"><span class="swatch" style="background:${SERIES_META[metric].color}"></span>${SERIES_META[metric].label}</span>
              <span class="lg text-3">把鼠标移到折线上查看每天的数值</span>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-head"><h2>内容 Top 10</h2><span class="hint">按累计播放量</span></div>
            <div class="card-body">${svgTopBars(topStories, "plays")}</div>
          </div>
          <div class="card">
            <div class="card-head"><h2>分类分布</h2><span class="hint">按内容篇数</span></div>
            <div class="card-body">
              <div class="od-row" style="align-items:flex-start;gap:var(--sp-5);flex-wrap:wrap">
                <div>${svgDonut(donutItems, S.stories.length, 200)}</div>
                <div class="od-fill donut-legend">
                  ${donutItems
                    .map(
                      (d) => `<div class="dl-row">
                        <span class="swatch" style="width:10px;height:10px;border-radius:3px;background:${d.palette[1]}"></span>
                        <span class="od-truncate">${d.name}</span>
                        <span class="v">${fmtNum(d.total)}</span>
                        <span class="p">${fmtPct(d.total / S.stories.length, 1)}</span>
                      </div>`
                    )
                    .join("")}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>收听时段分布</h2>
            <span class="hint">峰值出现在 ${pad2(peak.hour)}:00–${pad2((peak.hour + 1) % 24)}:00，占全天 ${fmtPct(peak.share)}</span>
          </div>
          <div class="card-body">
            ${svgHourly(hourly)}
            <div class="notice notice-info" style="margin-top:var(--sp-4)">
              <strong>运营建议：</strong>20:00–22:00 是哄睡高峰，新故事上线后优先排进「睡前 30 分钟」歌单；7:00–8:00 的晨间收听集中在国学与英语启蒙。
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>分类明细</h2><span class="hint">按播放量排序</span></div>
          <div class="table-scroll">
            <table class="data" style="min-width:720px">
              <thead>
                <tr>
                  <th>分类</th>
                  <th class="col-num">故事数</th>
                  <th class="col-num">已上架</th>
                  <th class="col-num">累计播放</th>
                  <th class="col-num">播放占比</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                ${distSorted
                  .map(
                    (d) => `<tr>
                  <td>
                    <div class="cell-story">
                      <span class="nav-dot" style="background:${d.palette[1]};width:10px;height:10px"></span>
                      <span style="font-weight:500">${d.name}</span>
                    </div>
                  </td>
                  <td class="col-num">${fmtNum(d.total)}</td>
                  <td class="col-num">${fmtNum(d.published)}</td>
                  <td class="col-num">${fmtNum(d.plays)}</td>
                  <td class="col-num">${fmtPct(d.plays / totalPlaysAll, 1)}</td>
                  <td>${S.categories.find((c) => c.id === d.id) && S.categories.find((c) => c.id === d.id).enabled ? '<span class="badge badge-pub">启用中</span>' : '<span class="badge badge-draft">已停用</span>'}</td>
                </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
  },
  mount(root) {
    const wrap = root.querySelector(".chart-trend");
    if (wrap) bindTrendHover(wrap, S.trend.slice(-S.analytics.range), S.analytics.metric);
  },
};

/* ================= 系统 ================= */
VIEWS.system = {
  label: "管理员与日志",
  crumbs: ["系统", "管理员与日志"],
  render() {
    const tab = S.system.tab;
    return `<div class="page">
      ${pageHead(
        "系统设置",
        tab === "admins" ? "管理员账号按角色分配权限，账号停用后立即失去登录能力" : "操作日志保留 180 天，可导出给合规审计",
        tab === "admins"
          ? `<button type="button" class="btn btn-primary" data-act="new-admin">新增管理员</button>`
          : `<button type="button" class="btn btn-secondary" data-act="go" data-route="analytics">查看数据报表</button>`
      )}
      <div style="margin-bottom:var(--sp-4)">
        ${tabbar(
          [
            { id: "admins", label: "管理员账号" },
            { id: "logs", label: "操作日志" },
          ],
          tab,
          "system-tab"
        )}
      </div>
      ${tab === "admins" ? systemAdmins() : systemLogs()}
    </div>`;
  },
  mount(root) {
    const input = root.querySelector("[data-log-search]");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          S.system.q = input.value;
          S.system.page = 1;
          renderApp();
        }
      });
      input.addEventListener("search", () => {
        S.system.q = input.value;
        S.system.page = 1;
        renderApp();
      });
    }
    ["module", "result"].forEach((k) => {
      const el = root.querySelector(`[data-log-${k}]`);
      if (el) {
        el.addEventListener("change", () => {
          S.system[k] = el.value;
          S.system.page = 1;
          renderApp();
        });
      }
    });
  },
};

function systemAdmins() {
  return `<div class="card">
    <div class="card-head"><h2>管理员账号</h2><span class="hint">共 ${S.admins.length} 个账号 · ${S.admins.filter((a) => a.status === "启用").length} 个启用中</span></div>
    <div class="table-scroll">
      <table class="data">
        <thead>
          <tr>
            <th>姓名</th>
            <th>账号</th>
            <th>角色</th>
            <th>权限范围</th>
            <th>最近登录</th>
            <th>状态</th>
            <th class="col-act">操作</th>
          </tr>
        </thead>
        <tbody>
          ${S.admins
            .map(
              (a) => `<tr>
            <td>
              <div class="cell-story">
                <span class="avatar" aria-hidden="true">${esc(a.name.slice(0, 1))}</span>
                <div class="cs-body"><span class="cs-title">${esc(a.name)}</span><span class="cs-meta">创建人：${esc(a.creator)}</span></div>
              </div>
            </td>
            <td class="text-2">${esc(a.account)}</td>
            <td><span class="badge badge-plain">${esc(a.role)}</span></td>
            <td class="text-2">${esc(a.scope)}</td>
            <td class="nowrap text-2">${relDate(a.lastLogin, S.today)}</td>
            <td>${a.status === "启用" ? '<span class="badge badge-pub">启用</span>' : '<span class="badge badge-draft">停用</span>'}</td>
            <td class="col-act">
              <div class="row-actions">
                <button type="button" class="link-btn" data-act="edit-admin" data-id="${a.id}">编辑</button>
                <button type="button" class="link-btn ${a.status === "启用" ? "danger" : ""}" data-act="toggle-admin" data-id="${a.id}">${a.status === "启用" ? "停用" : "启用"}</button>
              </div>
            </td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </div>`;
}

function filteredLogs() {
  const q = S.system.q.trim().toLowerCase();
  return S.logs.filter(
    (l) =>
      (S.system.module === "all" || l.module === S.system.module) &&
      (S.system.result === "all" || l.result === S.system.result) &&
      (!q || l.admin.toLowerCase().includes(q) || l.target.toLowerCase().includes(q) || l.action.includes(q))
  );
}

function systemLogs() {
  const all = filteredLogs();
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(S.system.page, totalPages);
  S.system.page = page;
  const rows = all.slice((page - 1) * pageSize, page * pageSize);
  const modules = ["故事管理", "审核队列", "运营位", "系统", "数据看板"];
  return `<div class="card">
    <div class="filters">
      <div class="filter-search">
        <label class="visually-hidden" for="log-search">搜索操作人或对象</label>
        <input id="log-search" class="input" type="search" placeholder="搜索操作人或操作对象" value="${esc(S.system.q)}" data-log-search />
      </div>
      <label class="filter-item"><span>模块</span>
        <select class="select" data-log-module>
          <option value="all">全部模块</option>
          ${modules.map((m) => `<option value="${m}" ${S.system.module === m ? "selected" : ""}>${m}</option>`).join("")}
        </select>
      </label>
      <label class="filter-item"><span>结果</span>
        <select class="select" data-log-result>
          <option value="all">全部结果</option>
          <option value="成功" ${S.system.result === "成功" ? "selected" : ""}>成功</option>
          <option value="失败" ${S.system.result === "失败" ? "selected" : ""}>失败</option>
        </select>
      </label>
      <div class="filter-foot"><span>共 ${fmtNum(all.length)} 条记录</span></div>
    </div>
    <div class="table-scroll">
      <table class="data" style="min-width:880px">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>模块</th>
            <th>操作</th>
            <th>对象</th>
            <th>IP</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (l) => `<tr>
              <td class="nowrap text-2">${fmtDate(l.at)} ${l.time}</td>
              <td class="nowrap">${esc(l.admin)}<span class="text-3" style="font-size:12px"> · ${esc(l.role)}</span></td>
              <td class="nowrap">${esc(l.module)}</td>
              <td class="nowrap">${esc(l.action)}</td>
              <td class="od-truncate" style="max-width:200px">${esc(l.target)}</td>
              <td class="nowrap text-3">${l.ip}</td>
              <td>${l.result === "成功" ? '<span class="badge badge-pub">成功</span>' : '<span class="badge badge-rejected">失败</span>'}</td>
            </tr>`
                  )
                  .join("")
              : `<tr><td colspan="7">${emptyState("没有符合条件的日志", "调整模块、结果筛选或清空搜索词后再试。")}</td></tr>`
          }
        </tbody>
      </table>
    </div>
    ${pagerHtml(page, totalPages, all.length, "logs")}
  </div>`;
}
