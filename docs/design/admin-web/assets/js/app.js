/* 小故事铺 · 应用状态与交互主控 */

const TODAY = new Date();

const S = {
  today: TODAY,
  user: null,
  route: "dashboard",
  stories: [],
  families: [],
  admins: [],
  logs: [],
  categories: [],
  trend: [],
  hourly: [],
  categoryStats: {},
  metrics: { newFamilies: 326 },
  ops: { tab: "category", banners: [], featured: [], playlists: [] },
  list: { category: "all", age: "all", status: "all", cover: "all", sort: "updated", q: "", page: 1, pageSize: 20, selected: new Set() },
  review: { q: "", sort: "newest", page: 1, selectedId: null },
  families_: { q: "", status: "all", sort: "monthly", page: 1, pageSize: 20 },
  analytics: { range: 30, metric: "plays" },
  system: { tab: "admins", q: "", module: "all", result: "all", page: 1 },
  editing: null,
  editingId: null,
  editErrors: {},
  ttsBusy: false,
  familyId: null,
  familyChildIndex: 0,
  familyRecPage: 1,
  nextStorySeq: 1,
  _confirm: null,
  _pendingBulkIds: [],
  _pick: { mode: "featured", bannerId: null, playlistId: null, q: "" },
  _lastFocus: null,
};

/* ---------- 初始化 ---------- */
function recomputeStats() {
  const stats = {};
  CATEGORIES.forEach((c) => {
    stats[c.id] = { total: 0, published: 0, plays: 0 };
  });
  S.stories.forEach((s) => {
    const row = stats[s.category];
    if (!row) return;
    row.total += 1;
    if (s.status === "published") row.published += 1;
    row.plays += s.plays;
  });
  S.categoryStats = stats;
}

function blankStory() {
  const d = new Date();
  return {
    id: `ST${9000 + S.nextStorySeq}`,
    title: "",
    category: "",
    age: "3-6",
    tags: [],
    words: 0,
    seconds: 0,
    hasCover: false,
    coverUrl: "",
    audio: null,
    status: "draft",
    plays: 0,
    completion: 0,
    createdAt: d,
    updatedAt: d,
    author: S.user ? S.user.name : "林知远",
    source: "原创",
    editor: S.user ? S.user.name : "林知远",
    submittedAt: null,
    rejectReason: "",
    body: "",
  };
}

function prepareNewStory() {
  S.editingId = null;
  S.editing = blankStory();
  S.editErrors = {};
  S.ttsBusy = false;
}

function prepareEditing(id) {
  const s = S.stories.find((x) => x.id === id);
  if (!s) {
    prepareNewStory();
    return;
  }
  S.editingId = s.id;
  S.editing = Object.assign({}, s, { tags: s.tags.slice() });
  S.editErrors = {};
  S.ttsBusy = false;
}

function commitEditing(status, extra) {
  const draft = Object.assign({}, S.editing, extra || {});
  draft.words = draft.body.replace(/\s/g, "").length;
  draft.seconds = Math.round((draft.words / 220) * 60);
  draft.updatedAt = new Date();
  draft.status = status;
  if (status !== "draft") draft.hasCover = Boolean(draft.coverUrl) || draft.hasCover;
  const idx = S.stories.findIndex((s) => s.id === draft.id);
  if (idx >= 0) {
    S.stories[idx] = Object.assign({}, S.stories[idx], draft);
  } else {
    S.nextStorySeq += 1;
    S.stories.unshift(draft);
    S.editingId = draft.id;
  }
  const saved = S.stories.find((s) => s.id === draft.id);
  S.editing = Object.assign({}, saved, { tags: saved.tags.slice() });
  recomputeStats();
  return saved;
}

/* ---------- 渲染 ---------- */
function crumbsHtml(items) {
  return items
    .map((c, i) =>
      i === items.length - 1
        ? `<span class="current">${c}</span>`
        : `<span>${c}</span><span class="sep">/</span>`
    )
    .join("");
}

function renderApp(opts) {
  const o = opts || {};
  const view = VIEWS[S.route] || VIEWS.dashboard;
  const root = document.getElementById("view-root");
  const scroller = document.querySelector(".content");
  const keep = o.keepScroll ? scroller.scrollTop : 0;
  let html;
  try {
    html = view.render();
  } catch (err) {
    html = `<div class="page"><div class="card"><div class="card-body">${emptyState(
      "这一页暂时无法渲染",
      "页面数据出现异常，请切换到其他菜单后再回来。",
      '<button type="button" class="btn btn-secondary btn-sm" data-act="go" data-route="dashboard">回到数据看板</button>'
    )}</div></div></div>`;
  }
  root.innerHTML = html;
  document.getElementById("crumb").innerHTML = crumbsHtml(view.crumbs || []);
  updateChrome();
  if (view.mount) view.mount(root);
  if (o.keepScroll) scroller.scrollTop = keep;
  else scroller.scrollTop = 0;
}

function updateChrome() {
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    const on = btn.dataset.nav === S.route || (S.route === "story-edit" && btn.dataset.nav === "stories") || (S.route === "family-detail" && btn.dataset.nav === "families");
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  const pending = S.stories.filter((s) => s.status === "pending").length;
  document.querySelectorAll("[data-pending-count]").forEach((el) => {
    el.textContent = fmtNum(pending);
    el.hidden = pending === 0;
  });
  const noAudio = S.stories.filter((s) => !s.audio).length;
  const tts = document.getElementById("tts-queue");
  if (tts) tts.innerHTML = `<span class="ping"></span>TTS 队列 · ${fmtNum(noAudio)} 篇待生成`;
  const who = document.getElementById("user-name");
  if (who && S.user) who.textContent = S.user.name;
}

function navTo(route, opts) {
  const o = opts || {};
  if (route === "story-edit") {
    if (o.id) prepareEditing(o.id);
    else prepareNewStory();
  }
  S.route = route;
  renderApp();
  const focus = document.getElementById("view-root").querySelector("h1");
  if (focus) {
    focus.setAttribute("tabindex", "-1");
    focus.focus({ preventScroll: true });
  }
}

/* ---------- 提示条 ---------- */
function toast(message, kind) {
  const region = document.getElementById("toast-region");
  if (!region) return;
  const el = document.createElement("div");
  el.className = `toast ${kind || ""}`.trim();
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="dot"></span><span>${esc(message)}</span>`;
  region.appendChild(el);
  window.setTimeout(() => {
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 220);
  }, 2600);
  while (region.children.length > 3) region.removeChild(region.firstChild);
}

/* ---------- 对话框 ---------- */
function openDialog(dialog, focusSelector) {
  S._lastFocus = document.activeElement;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  dialog.classList.add("dialog-enter");
  window.setTimeout(() => {
    const target = (focusSelector && dialog.querySelector(focusSelector)) || dialog.querySelector("button, input, select, textarea");
    if (target) target.focus();
  }, 30);
}
function closeDialog(dialog) {
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
  dialog.classList.remove("dialog-enter");
  const back = S._lastFocus;
  if (back && document.contains(back)) back.focus();
  else {
    const fallback = document.querySelector("#view-root .page-head .btn-primary, #view-root button");
    if (fallback) fallback.focus();
  }
  S._lastFocus = null;
}
function askConfirm(opts) {
  const dlg = document.getElementById("dlg-confirm");
  document.getElementById("confirm-title").textContent = opts.title;
  document.getElementById("confirm-desc").textContent = opts.desc;
  const ok = document.getElementById("confirm-ok");
  ok.textContent = opts.okLabel || "确认";
  ok.className = `btn ${opts.danger ? "btn-danger" : "btn-primary"}`;
  S._confirm = opts.onConfirm;
  openDialog(dlg, "#confirm-ok");
}

/* ---------- 分页 ---------- */
function handlePage(btn) {
  const holder = btn.closest("[data-pager]");
  const id = holder ? holder.dataset.pager : "stories";
  const p = Number(btn.dataset.page);
  if (!p || p < 1) return;
  if (id === "stories") S.list.page = p;
  else if (id === "review") S.review.page = p;
  else if (id === "families") S.families_.page = p;
  else if (id === "family-records") S.familyRecPage = p;
  else if (id === "logs") S.system.page = p;
  renderApp({ keepScroll: false });
}

/* ---------- 审核动作 ---------- */
function nextPendingId(excludeId) {
  const list = S.stories
    .filter((s) => s.status === "pending")
    .sort((a, b) => (S.review.sort === "oldest" ? a.submittedAt - b.submittedAt : b.submittedAt - a.submittedAt));
  if (!list.length) return null;
  const idx = list.findIndex((s) => s.id === excludeId);
  if (idx < 0) return list[0].id;
  return list[Math.min(idx, list.length - 1)].id;
}

/* ---------- 推荐位挑选 ---------- */
function pickMembership() {
  const p = S._pick;
  if (p.mode === "featured") return S.ops.featured;
  if (p.mode === "banner") {
    const b = S.ops.banners.find((x) => x.id === p.bannerId);
    return b ? b.storyIds : [];
  }
  const pl = S.ops.playlists.find((x) => x.id === p.playlistId);
  return pl ? pl.storyIds : [];
}
function renderPickList() {
  const box = document.getElementById("pick-list");
  if (!box) return;
  const q = S._pick.q.trim();
  const members = pickMembership();
  const list = S.stories
    .filter((s) => s.status === "published")
    .filter((s) => matchStory(s, q))
    .slice(0, 40);
  const label =
    S._pick.mode === "featured" ? "精选位" : S._pick.mode === "banner" ? "banner 关联内容" : "歌单曲目";
  document.getElementById("pick-title").textContent = `选择内容 · ${label}`;
  document.getElementById("pick-count").textContent = `已选 ${members.length} 篇`;
  box.innerHTML = list.length
    ? list
        .map((s) => {
          const has = members.includes(s.id);
          return `<div class="pick-row">
            ${coverSvgByStory(s, { className: "cover" })}
            <div class="od-fill">
              <div class="od-truncate" style="font-size:13px;font-weight:500">${esc(s.title)}</div>
              <div class="text-3" style="font-size:12px">${catName(s.category)} · ${s.age} 岁 · ${fmtNum(s.plays)} 次播放</div>
            </div>
            <button type="button" class="btn btn-sm ${has ? "btn-ghost" : "btn-secondary"}" data-act="pick-toggle" data-id="${s.id}">${has ? "移除" : "加入"}</button>
          </div>`;
        })
        .join("")
    : emptyState("没有匹配的已上架故事", "只有「已上架」的故事可以放进推荐位，换个关键词试试。");
}
function openPick(mode, opts) {
  S._pick = { mode, bannerId: (opts && opts.bannerId) || null, playlistId: (opts && opts.playlistId) || null, q: "" };
  const input = document.getElementById("pick-search");
  input.value = "";
  renderPickList();
  openDialog(document.getElementById("dlg-pick"), "#pick-search");
}

/* ---------- 登录 ---------- */
function enterApp(user) {
  S.user = user;
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  const who = document.getElementById("user-name");
  if (who) who.textContent = user.name;
  const role = document.getElementById("user-role");
  if (role) role.textContent = user.role;
  const av = document.getElementById("user-avatar");
  if (av) av.textContent = user.name.slice(0, 1);
  navTo("dashboard");
  toast(`欢迎回来，${user.name}`, "ok");
}
function bindLogin() {
  const form = document.getElementById("login-form");
  const tabs = document.querySelectorAll(".login-tab");
  const phone = document.getElementById("login-phone");
  const code = document.getElementById("login-code");
  const pwd = document.getElementById("login-pwd");
  const codeBtn = document.getElementById("send-code");
  const errBox = document.getElementById("login-error");
  let mode = "code";
  let timer = null;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      mode = tab.dataset.mode;
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      document.getElementById("code-field").hidden = mode !== "code";
      document.getElementById("pwd-field").hidden = mode !== "pwd";
      errBox.hidden = true;
    });
  });

  codeBtn.addEventListener("click", () => {
    const ok = /^1\d{10}$/.test(phone.value.trim());
    if (!ok) {
      showLoginError("请先填写 11 位手机号");
      phone.focus();
      return;
    }
    let left = 60;
    codeBtn.disabled = true;
    codeBtn.textContent = `重新获取 ${left}s`;
    timer = window.setInterval(() => {
      left -= 1;
      codeBtn.textContent = `重新获取 ${left}s`;
      if (left <= 0) {
        window.clearInterval(timer);
        codeBtn.disabled = false;
        codeBtn.textContent = "获取验证码";
      }
    }, 1000);
    toast("验证码已发送（演示环境请输入任意 6 位数字）", "ok");
  });

  function showLoginError(msg) {
    errBox.hidden = false;
    errBox.textContent = `⚠ ${msg}`;
  }
  function clearFieldErrors() {
    [phone, code, pwd].forEach((el) => el.classList.remove("is-invalid"));
    errBox.hidden = true;
  }

  const submit = () => {
    clearFieldErrors();
    const p = phone.value.trim();
    const problems = [];
    if (!/^1\d{10}$/.test(p)) {
      problems.push("手机号需要是 11 位、以 1 开头的号码");
      phone.classList.add("is-invalid");
    }
    if (mode === "code") {
      if (!/^\d{6}$/.test(code.value.trim())) {
        problems.push("验证码为 6 位数字，演示环境可输入 123456");
        code.classList.add("is-invalid");
      }
    } else if (pwd.value.trim().length < 6) {
      problems.push("密码至少 6 位");
      pwd.classList.add("is-invalid");
    }
    if (problems.length) {
      showLoginError(problems.join("；"));
      const first = document.querySelector(".login-form .is-invalid");
      if (first) first.focus();
      return;
    }
    const btn = document.getElementById("login-submit");
    btn.disabled = true;
    btn.textContent = "登录中…";
    window.setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "登录";
      enterApp({ name: "林知远", role: "内容运营 · 超级管理员", phone: p });
    }, 520);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  document.getElementById("login-submit").addEventListener("click", (e) => {
    e.preventDefault();
    submit();
  });
  [phone, code, pwd].forEach((el) => {
    el.addEventListener("input", () => {
      el.classList.remove("is-invalid");
      errBox.hidden = true;
    });
  });
}

/* ---------- 事件委托 ---------- */
const CLICK_ACTIONS = {
  go: (el) => navTo(el.dataset.route),
  page: (el) => handlePage(el),
  "ops-tab": (el) => {
    S.ops.tab = el.dataset.tab;
    renderApp();
  },
  "system-tab": (el) => {
    S.system.tab = el.dataset.tab;
    S.system.page = 1;
    renderApp();
  },
  "analytics-range": (el) => {
    S.analytics.range = Number(el.dataset.range);
    renderApp();
  },
  "analytics-metric": (el) => {
    S.analytics.metric = el.dataset.tab;
    renderApp();
  },
  "edit-story": (el) => navTo("story-edit", { id: el.dataset.id }),
  "new-story": () => navTo("story-edit"),
  "open-review": (el) => {
    S.review.q = "";
    S.review.sort = "newest";
    S.review.page = 1;
    S.review.selectedId = el.dataset.id || null;
    S.route = "review";
    renderApp();
  },
  "select-review": (el) => {
    S.review.selectedId = el.dataset.id;
    renderApp({ keepScroll: true });
    const item = document.querySelector(`[data-act="select-review"][data-id="${el.dataset.id}"]`);
    if (item) item.focus();
  },
  "filter-no-cover": () => {
    S.list.cover = S.list.cover === "missing" ? "all" : "missing";
    S.list.page = 1;
    if (S.route !== "stories") {
      S.route = "stories";
      renderApp();
    } else {
      renderApp();
    }
    toast(S.list.cover === "missing" ? "已筛选出缺封面的故事" : "已取消缺封面筛选", "ok");
  },
  "reset-filters": () => {
    S.list = Object.assign({}, S.list, { category: "all", age: "all", status: "all", cover: "all", sort: "updated", q: "", page: 1, selected: new Set() });
    renderApp();
    const input = document.getElementById("story-search");
    if (input) input.focus();
    toast("筛选条件已重置", "ok");
  },
  "pick-suggest": (el) => {
    const story = S.stories.find((s) => s.id === el.dataset.id);
    if (!story) return;
    S.list.q = story.title;
    S.list.page = 1;
    renderApp();
    toast(`已跳转到《${story.title}》`, "ok");
  },
  "clear-selection": () => {
    S.list.selected = new Set();
    renderApp({ keepScroll: true });
  },
  "bulk-status": (el) => {
    const ids = Array.from(S.list.selected);
    const status = el.dataset.status;
    if (!ids.length) return;
    if (status === "offline") {
      askConfirm({
        title: `确认下架 ${ids.length} 篇故事？`,
        desc: "下架后家长端将立即无法播放这些故事，已加入歌单的条目也会一并失效。",
        okLabel: "确认下架",
        danger: true,
        onConfirm: () => applyBulk(ids, status),
      });
    } else {
      applyBulk(ids, status);
    }
  },
  "bulk-tag": () => {
    const ids = Array.from(S.list.selected);
    if (!ids.length) return;
    S._pendingBulkIds = ids;
    const dlg = document.getElementById("dlg-tag");
    dlg.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = false));
    document.getElementById("tag-custom").value = "";
    openDialog(dlg, "#dlg-tag input[type=checkbox]");
  },
  "row-status": (el) => {
    const story = S.stories.find((s) => s.id === el.dataset.id);
    if (!story) return;
    const status = el.dataset.status;
    if (status === "offline") {
      askConfirm({
        title: `确认下架《${story.title}》？`,
        desc: "下架后家长端将无法搜索到这篇故事，重新上架后可恢复。",
        okLabel: "确认下架",
        danger: true,
        onConfirm: () => applySingleStatus(story.id, "offline"),
      });
    } else {
      applySingleStatus(story.id, "published");
    }
  },
  "save-draft": () => {
    const draft = S.editing;
    if (!draft.title.trim()) {
      S.editErrors = { title: "保存草稿也需要先填写故事标题" };
      renderApp();
      const el = document.getElementById("f-title");
      if (el) el.focus();
      toast("请先填写故事标题", "warn");
      return;
    }
    S.editErrors = {};
    const keepPublished = S.editingId && draft.status === "published";
    const saved = commitEditing(keepPublished ? "published" : "draft");
    toast(keepPublished ? "已保存，故事保持上架状态" : `《${saved.title}》已保存为草稿`, "ok");
    renderApp();
    const back = document.getElementById("view-root").querySelector("h1");
    if (back) back.focus();
  },
  "submit-review": () => {
    const d = S.editing;
    const errors = {};
    if (!d.title.trim()) errors.title = "请填写故事标题";
    if (!d.category) errors.category = "请选择分类";
    if (!d.age) errors.age = "请选择年龄档";
    const words = d.body.replace(/\s/g, "").length;
    if (words < 100) errors.body = `正文至少 100 字，当前 ${words} 字`;
    if (!d.hasCover && !d.coverUrl) errors.hasCover = "提交审核前需要上传封面（可先用分类插画占位）";
    if (Object.keys(errors).length) {
      S.editErrors = errors;
      renderApp();
      const firstKey = Object.keys(errors)[0];
      const map = { title: "f-title", category: "f-category", body: "f-body" };
      const el = document.getElementById(map[firstKey]) || document.getElementById("f-title");
      if (el) el.focus();
      toast(`还有 ${Object.keys(errors).length} 项需要处理`, "err");
      return;
    }
    S.editErrors = {};
    const saved = commitEditing("pending", { submittedAt: new Date() });
    toast(`《${saved.title}》已提交审核`, "ok");
    S.review.selectedId = saved.id;
    S.review.q = "";
    S.review.page = 1;
    S.route = "review";
    renderApp();
  },
  "gen-cover": () => {
    S.editing.hasCover = true;
    S.editing.coverUrl = "";
    if (S.editErrors.hasCover) delete S.editErrors.hasCover;
    toast("已使用分类插画占位，上架前请替换为正式封面", "warn");
    renderApp();
  },
  "upload-cover": () => {
    const file = document.getElementById("cover-file");
    if (file) file.click();
  },
  "remove-tag": (el) => {
    S.editing.tags = S.editing.tags.filter((t) => t !== el.dataset.tag);
    renderApp();
    const input = document.querySelector('[data-act="tag-input"]');
    if (input) input.focus();
  },
  "gen-tts": () => {
    if (S.ttsBusy) return;
    S.ttsBusy = true;
    renderApp({ keepScroll: true });
    window.setTimeout(() => {
      S.ttsBusy = false;
      S.editing.audio = { voice: "温柔女声（TTS）", at: new Date() };
      const words = S.editing.body.replace(/\s/g, "").length;
      S.editing.seconds = Math.round((words / 220) * 60);
      const idx = S.stories.findIndex((s) => s.id === S.editing.id);
      if (idx >= 0) {
        S.stories[idx].audio = S.editing.audio;
        S.stories[idx].seconds = S.editing.seconds;
      }
      updateChrome();
      renderApp({ keepScroll: true });
      toast("TTS 音频已生成，可在编辑页试听", "ok");
    }, 900);
  },
  approve: (el) => {
    const story = S.stories.find((s) => s.id === el.dataset.id);
    if (!story) return;
    story.status = "published";
    story.updatedAt = new Date();
    story.rejectReason = "";
    recomputeStats();
    const next = nextPendingId(story.id);
    S.review.selectedId = next;
    renderApp({ keepScroll: true });
    toast(`《${story.title}》已通过并上架`, "ok");
    const item = document.querySelector("[data-review-list] .review-item");
    if (item) item.focus();
  },
  "open-reject": (el) => {
    const dlg = document.getElementById("dlg-reject");
    dlg.dataset.storyId = el.dataset.id;
    const story = S.stories.find((s) => s.id === el.dataset.id);
    document.getElementById("reject-story").textContent = story ? `《${story.title}》` : "";
    document.getElementById("reject-select").value = "正文出现不适龄表达，请修改后重新提交";
    document.getElementById("reject-note").value = "";
    document.getElementById("reject-error").hidden = true;
    openDialog(dlg, "#reject-select");
  },
  "dlg-close": (el) => closeDialog(el.closest("dialog")),
  "dlg-cancel": (el) => closeDialog(el.closest("dialog")),
  "dlg-confirm": () => {
    const fn = S._confirm;
    closeDialog(document.getElementById("dlg-confirm"));
    S._confirm = null;
    if (fn) fn();
  },
  "reject-submit": () => {
    const dlg = document.getElementById("dlg-reject");
    const story = S.stories.find((s) => s.id === dlg.dataset.storyId);
    const note = document.getElementById("reject-note").value.trim();
    const preset = document.getElementById("reject-select").value;
    const reason = note ? `${preset}（补充：${note}）` : preset;
    if (!reason) {
      const err = document.getElementById("reject-error");
      err.hidden = false;
      err.textContent = "请选择或填写驳回原因";
      return;
    }
    if (!story) {
      closeDialog(dlg);
      return;
    }
    story.status = "rejected";
    story.rejectReason = reason;
    story.updatedAt = new Date();
    recomputeStats();
    S.review.selectedId = nextPendingId(story.id);
    closeDialog(dlg);
    renderApp({ keepScroll: true });
    toast(`《${story.title}》已驳回并通知编辑`, "warn");
    const item = document.querySelector("[data-review-list] .review-item");
    if (item) item.focus();
  },
  "cat-up": (el) => shiftCategory(el.dataset.id, -1),
  "cat-down": (el) => shiftCategory(el.dataset.id, 1),
  "reset-cat-order": () => {
    S.categories = CATEGORIES.map((c) => ({ ...c, enabled: true }));
    renderApp();
    toast("分类顺序已恢复默认", "ok");
  },
  "save-cat-order": () => toast("排序已保存，App 首页频道会在 5 分钟内生效", "ok"),
  "edit-banner": (el) => {
    const b = S.ops.banners.find((x) => x.id === el.dataset.id);
    if (!b) return;
    const dlg = document.getElementById("dlg-banner");
    dlg.dataset.bannerId = b.id;
    document.getElementById("banner-title").value = b.title;
    document.getElementById("banner-sub").value = b.subtitle;
    document.getElementById("banner-period").value = b.period;
    document.getElementById("banner-status").value = b.status;
    openDialog(dlg, "#banner-title");
  },
  "banner-submit": () => {
    const dlg = document.getElementById("dlg-banner");
    const b = S.ops.banners.find((x) => x.id === dlg.dataset.bannerId);
    const title = document.getElementById("banner-title").value.trim();
    const err = document.getElementById("banner-error");
    if (!title) {
      err.hidden = false;
      err.textContent = "标题不能为空";
      document.getElementById("banner-title").focus();
      return;
    }
    if (b) {
      b.title = title;
      b.subtitle = document.getElementById("banner-sub").value.trim();
      b.period = document.getElementById("banner-period").value.trim() || "长期";
      b.status = document.getElementById("banner-status").value;
    }
    closeDialog(dlg);
    renderApp({ keepScroll: true });
    toast("banner 已更新", "ok");
  },
  "toggle-banner": (el) => {
    const b = S.ops.banners.find((x) => x.id === el.dataset.id);
    if (!b) return;
    b.status = b.status === "展示中" ? "已下线" : "展示中";
    renderApp({ keepScroll: true });
    toast(`banner「${b.title}」${b.status === "展示中" ? "已上线" : "已下线"}`, b.status === "展示中" ? "ok" : "warn");
  },
  "add-banner": () => {
    const id = `BN${String(S.ops.banners.length + 1).padStart(2, "0")}`;
    S.ops.banners.push({ id, title: "未命名 banner", subtitle: "请补充一句话卖点", storyIds: [], period: "待排期", status: "已下线" });
    renderApp({ keepScroll: true });
    const btn = document.querySelector(`[data-act="edit-banner"][data-id="${id}"]`);
    if (btn) btn.focus();
    toast("已新增一个 banner，请补充标题与内容", "ok");
  },
  "pick-story": (el) => {
    const mode = el.dataset.mode;
    openPick(mode, { bannerId: el.dataset.id, playlistId: el.dataset.id });
  },
  "new-playlist": () => {
    const dlg = document.getElementById("dlg-playlist");
    document.getElementById("pl-name").value = "";
    document.getElementById("pl-desc").value = "";
    document.getElementById("pl-error").hidden = true;
    openDialog(dlg, "#pl-name");
  },
  "playlist-submit": () => {
    const dlg = document.getElementById("dlg-playlist");
    const name = document.getElementById("pl-name").value.trim();
    const err = document.getElementById("pl-error");
    if (!name) {
      err.hidden = false;
      err.textContent = "歌单名称不能为空";
      document.getElementById("pl-name").focus();
      return;
    }
    const id = `PL${String(S.ops.playlists.length + 1).padStart(2, "0")}`;
    S.ops.playlists.push({
      id,
      name,
      desc: document.getElementById("pl-desc").value.trim() || "未填写场景说明",
      audience: document.getElementById("pl-audience").value,
      storyIds: [],
      updatedAt: "刚刚创建",
    });
    closeDialog(dlg);
    S.ops.tab = "slots";
    renderApp({ keepScroll: true });
    toast(`歌单「${name}」已创建，可以开始添加曲目`, "ok");
  },
  "pick-toggle": (el) => {
    const id = el.dataset.id;
    const p = S._pick;
    if (p.mode === "featured") {
      const members = S.ops.featured;
      const i = members.indexOf(id);
      if (i >= 0) members.splice(i, 1);
      else if (members.length >= 8) {
        toast("精选位已满，请先移除一个位置", "warn");
        return;
      } else members.push(id);
    } else if (p.mode === "banner") {
      const b = S.ops.banners.find((x) => x.id === p.bannerId);
      if (!b) return;
      const i = b.storyIds.indexOf(id);
      if (i >= 0) b.storyIds.splice(i, 1);
      else if (b.storyIds.length >= 3) {
        toast("单个 banner 最多关联 3 篇故事", "warn");
        return;
      } else b.storyIds.push(id);
    } else {
      const pl = S.ops.playlists.find((x) => x.id === p.playlistId);
      if (!pl) return;
      const i = pl.storyIds.indexOf(id);
      if (i >= 0) pl.storyIds.splice(i, 1);
      else pl.storyIds.push(id);
      pl.updatedAt = "刚刚更新";
    }
    renderPickList();
    renderApp({ keepScroll: true });
  },
  "remove-slot-story": (el) => {
    const i = Number(el.dataset.index);
    const [removed] = S.ops.featured.splice(i, 1);
    renderApp({ keepScroll: true });
    const story = storyById(removed);
    toast(`已从精选位移除《${story ? story.title : ""}》`, "warn");
    const next = document.querySelector('[data-act="pick-story"][data-mode="featured"]');
    if (next) next.focus();
  },
  "featured-up": (el) => {
    const i = Number(el.dataset.index);
    if (i <= 0) return;
    const arr = S.ops.featured;
    [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    renderApp({ keepScroll: true });
  },
  "open-family": (el) => {
    S.familyId = el.dataset.id;
    S.familyChildIndex = 0;
    S.familyRecPage = 1;
    navTo("family-detail");
  },
  "pick-child": (el) => {
    S.familyChildIndex = Number(el.dataset.index);
    S.familyRecPage = 1;
    renderApp({ keepScroll: true });
  },
  "new-admin": () => openAdminDialog(null),
  "edit-admin": (el) => openAdminDialog(el.dataset.id),
  "toggle-admin": (el) => {
    const a = S.admins.find((x) => x.id === el.dataset.id);
    if (!a) return;
    const off = a.status === "启用";
    askConfirm({
      title: off ? `确认停用「${a.name}」的账号？` : `确认启用「${a.name}」的账号？`,
      desc: off ? "停用后该账号将无法登录后台，已登录的会话在 10 分钟内失效。" : "启用后该账号可以按角色权限登录后台。",
      okLabel: off ? "确认停用" : "确认启用",
      danger: off,
      onConfirm: () => {
        a.status = off ? "停用" : "启用";
        renderApp({ keepScroll: true });
        toast(`账号「${a.name}」已${a.status}`, off ? "warn" : "ok");
        const btn = document.querySelector(`[data-act="toggle-admin"][data-id="${a.id}"]`);
        if (btn) btn.focus();
      },
    });
  },
  "admin-submit": () => submitAdminDialog(),
  "logout": () => {
    S.user = null;
    document.getElementById("app-shell").hidden = true;
    document.getElementById("login-screen").hidden = false;
    const form = document.getElementById("login-form");
    if (form) form.reset();
    toast("已退出登录", "ok");
  },
  "nav-toggle": () => {
    const shell = document.getElementById("app-shell");
    const open = shell.classList.toggle("nav-open");
    let scrim = document.getElementById("nav-scrim");
    if (open && !scrim) {
      scrim = document.createElement("div");
      scrim.id = "nav-scrim";
      scrim.className = "drawer-scrim";
      scrim.addEventListener("click", () => {
        shell.classList.remove("nav-open");
        scrim.remove();
      });
      document.body.appendChild(scrim);
    } else if (!open && scrim) {
      scrim.remove();
    }
  },
};

function applyBulk(ids, status) {
  let n = 0;
  ids.forEach((id) => {
    const s = S.stories.find((x) => x.id === id);
    if (!s) return;
    s.status = status;
    s.updatedAt = new Date();
    n += 1;
  });
  S.list.selected = new Set();
  recomputeStats();
  renderApp({ keepScroll: true });
  toast(`已${status === "published" ? "上架" : "下架"} ${n} 篇故事`, status === "published" ? "ok" : "warn");
  const btn = document.querySelector('[data-act="bulk-status"]');
  if (btn) btn.focus();
  else {
    const first = document.querySelector('tbody [data-act="edit-story"]');
    if (first) first.focus();
  }
}
function applySingleStatus(id, status) {
  const s = S.stories.find((x) => x.id === id);
  if (!s) return;
  s.status = status;
  s.updatedAt = new Date();
  recomputeStats();
  renderApp({ keepScroll: true });
  toast(`《${s.title}》已${status === "published" ? "上架" : "下架"}`, status === "published" ? "ok" : "warn");
  const row = document.querySelector(`tr[data-row="${id}"]`);
  const btn = row ? row.querySelector('[data-act="row-status"]') : null;
  if (btn) btn.focus();
}
function shiftCategory(id, dir) {
  const i = S.categories.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= S.categories.length) return;
  const [moved] = S.categories.splice(i, 1);
  S.categories.splice(j, 0, moved);
  renderApp({ keepScroll: true });
  toast(`「${moved.name}」已移动到第 ${j + 1} 位`, "ok");
  const btn = document.querySelector(`[data-act="${dir < 0 ? "cat-up" : "cat-down"}"][data-id="${id}"]`);
  if (btn) btn.focus();
}
function openAdminDialog(id) {
  const dlg = document.getElementById("dlg-admin");
  const a = id ? S.admins.find((x) => x.id === id) : null;
  dlg.dataset.adminId = id || "";
  document.getElementById("admin-name").value = a ? a.name : "";
  document.getElementById("admin-account").value = a ? a.account : "";
  document.getElementById("admin-role").value = a ? a.role : "内容运营";
  document.getElementById("admin-scope").value = a ? a.scope : "故事、运营位";
  document.getElementById("admin-status").checked = a ? a.status === "启用" : true;
  document.getElementById("admin-error").hidden = true;
  document.getElementById("admin-mode").textContent = a ? "编辑管理员账号" : "新增管理员账号";
  openDialog(dlg, "#admin-name");
}
function submitAdminDialog() {
  const dlg = document.getElementById("dlg-admin");
  const name = document.getElementById("admin-name").value.trim();
  const account = document.getElementById("admin-account").value.trim();
  const err = document.getElementById("admin-error");
  const id = dlg.dataset.adminId;
  const dup = S.admins.some((a) => a.account === account && a.id !== id);
  if (!name) {
    err.hidden = false;
    err.textContent = "请填写管理员姓名";
    document.getElementById("admin-name").focus();
    return;
  }
  if (!/^[\w.@-]{4,}$/.test(account)) {
    err.hidden = false;
    err.textContent = "账号至少 4 位，可用字母、数字、. _ - @";
    document.getElementById("admin-account").focus();
    return;
  }
  if (dup) {
    err.hidden = false;
    err.textContent = "该账号已存在，请更换账号名";
    document.getElementById("admin-account").focus();
    return;
  }
  const status = document.getElementById("admin-status").checked ? "启用" : "停用";
  const role = document.getElementById("admin-role").value;
  const scope = document.getElementById("admin-scope").value.trim() || "按角色默认";
  if (id) {
    const a = S.admins.find((x) => x.id === id);
    Object.assign(a, { name, account, role, scope, status });
  } else {
    S.admins.push({
      id: `AD${String(S.admins.length + 1).padStart(2, "0")}`,
      name,
      account,
      role,
      scope,
      status,
      lastLogin: new Date(),
      creator: S.user ? S.user.name : "林知远",
    });
  }
  closeDialog(dlg);
  renderApp({ keepScroll: true });
  toast(`管理员「${name}」已${id ? "更新" : "新增"}`, "ok");
  const btn = document.querySelector(id ? `[data-act="edit-admin"][data-id="${id}"]` : '[data-act="new-admin"]');
  if (btn) btn.focus();
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (el.tagName === "INPUT" && el.type === "checkbox") return;
  const handler = CLICK_ACTIONS[act];
  if (!handler) return;
  if (el.tagName === "BUTTON" || el.tagName === "A") e.preventDefault();
  handler(el);
});

document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "check-all") {
    const rows = document.querySelectorAll("tbody [data-act='check-row']");
    rows.forEach((cb) => {
      const id = cb.dataset.id;
      if (el.checked) S.list.selected.add(id);
      else S.list.selected.delete(id);
    });
    renderApp({ keepScroll: true });
    const again = document.querySelector("[data-act='check-all']");
    if (again) again.focus();
    return;
  }
  if (act === "check-row") {
    const id = el.dataset.id;
    if (el.checked) S.list.selected.add(id);
    else S.list.selected.delete(id);
    renderApp({ keepScroll: true });
    const again = document.querySelector(`[data-act="check-row"][data-id="${id}"]`);
    if (again) again.focus();
    return;
  }
  if (act === "toggle-cat") {
    const c = S.categories.find((x) => x.id === el.dataset.id);
    if (!c) return;
    c.enabled = el.checked;
    renderApp({ keepScroll: true });
    toast(`分类「${c.name}」已${c.enabled ? "启用" : "停用"}`, c.enabled ? "ok" : "warn");
    const again = document.querySelector(`[data-act="toggle-cat"][data-id="${c.id}"]`);
    if (again) again.focus();
  }
});

/* 列表筛选下拉 */
document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-filter]");
  if (!el) return;
  const key = el.dataset.filter;
  S.list[key] = el.value;
  S.list.page = 1;
  renderApp({ keepScroll: true });
  const again = document.querySelector(`[data-filter="${key}"]`);
  if (again) again.focus();
});

/* 封面文件选择 */
function bindCoverFile() {
  const file = document.getElementById("cover-file");
  if (!file) return;
  file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      toast("请选择图片文件（JPG / PNG / WebP）", "err");
      file.value = "";
      return;
    }
    S.editing.coverUrl = URL.createObjectURL(f);
    S.editing.hasCover = true;
    if (S.editErrors.hasCover) delete S.editErrors.hasCover;
    renderApp({ keepScroll: true });
    toast("封面已更新，列表缩略图会同步替换", "ok");
    file.value = "";
  });
}

/* 推荐位搜索 */
function bindPickSearch() {
  const input = document.getElementById("pick-search");
  if (!input) return;
  input.addEventListener("input", () => {
    S._pick.q = input.value;
    renderPickList();
  });
}

/* 批量标签 */
function bindBulkTag() {
  const btn = document.getElementById("tag-submit");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const dlg = document.getElementById("dlg-tag");
    const picked = Array.from(dlg.querySelectorAll("input[type=checkbox]:checked")).map((c) => c.value);
    const custom = document.getElementById("tag-custom").value.trim();
    if (custom) picked.push(custom);
    if (!picked.length) {
      const err = document.getElementById("tag-error");
      err.hidden = false;
      err.textContent = "请至少选择一个标签";
      return;
    }
    const ids = S._pendingBulkIds;
    let count = 0;
    ids.forEach((id) => {
      const s = S.stories.find((x) => x.id === id);
      if (!s) return;
      picked.forEach((t) => {
        if (!s.tags.includes(t) && s.tags.length < 6) s.tags.push(t);
      });
      s.updatedAt = new Date();
      count += 1;
    });
    S.list.selected = new Set();
    S._pendingBulkIds = [];
    closeDialog(dlg);
    renderApp({ keepScroll: true });
    toast(`已为 ${count} 篇故事添加标签：${picked.join("、")}`, "ok");
    const first = document.querySelector('tbody [data-act="edit-story"]');
    if (first) first.focus();
  });
}

/* ---------- 启动 ---------- */
function boot() {
  S.stories = buildStories(TODAY);
  S.families = buildFamilies(TODAY, S.stories);
  S.admins = buildAdmins(TODAY);
  S.logs = buildLogs(TODAY, S.admins);
  S.categories = CATEGORIES.map((c) => ({ ...c, enabled: true }));
  S.trend = buildTrend(TODAY);
  S.hourly = buildHourly();
  S.ops = Object.assign({ tab: "category" }, buildOps(S.stories));
  S.nextStorySeq = 1;
  recomputeStats();
  prepareNewStory();

  /* 先确保登录页可见，再绑定交互，避免绑定异常导致白屏 */
  document.getElementById("app-shell").hidden = true;
  document.getElementById("login-screen").hidden = false;

  bindLogin();
  bindCoverFile();
  bindPickSearch();
  bindBulkTag();
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("close", () => {
      const back = S._lastFocus;
      if (back && document.contains(back)) back.focus();
      S._lastFocus = null;
    });
  });

  const phone = document.getElementById("login-phone");
  if (phone) phone.focus();
}

boot();
