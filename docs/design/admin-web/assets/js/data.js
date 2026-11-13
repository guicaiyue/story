/* 小故事铺 · 演示数据与工具
   数据口径：2197 篇故事 / 15 个分类 / 0 个音频文件（全部走 TTS 实时合成） */

/* ---------- 基础工具 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const between = (rnd, min, max) => min + rnd() * (max - min);
const intBetween = (rnd, min, max) => Math.round(between(rnd, min, max));

const nf = new Intl.NumberFormat("zh-CN");
const fmtNum = (n) => nf.format(Math.round(n));
const fmtPct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const fmtDuration = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m} 分` : `${m} 分 ${String(s).padStart(2, "0")} 秒`;
};
const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtDateTime = (d) =>
  `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fmtClock = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const daysAgo = (base, n) => new Date(base.getTime() - n * 86400000);
const relDate = (d, now) => {
  const diff = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff < 7) return `${diff} 天前`;
  return fmtDate(d);
};
const maskPhone = (p) => `${p.slice(0, 3)}****${p.slice(7)}`;

/* ---------- 分类（15 个） ---------- */
const CATEGORIES = [
  { id: "bedtime", name: "睡前故事", motif: "moon", palette: ["#E9E4EF", "#7C7396", "#C3B7D6"], desc: "入睡陪伴，语速放缓" },
  { id: "myth", name: "神话传说", motif: "hill", palette: ["#F3E3D6", "#B0713F", "#E0B98C"], desc: "中国神话与民间传说" },
  { id: "idiom", name: "成语故事", motif: "book", palette: ["#EDE6D8", "#8A7A4E", "#CDBD8E"], desc: "一个成语一个故事" },
  { id: "guoxue", name: "国学启蒙", motif: "lantern", palette: ["#E7E9E2", "#5F6F55", "#AFBCA4"], desc: "三字经、唐诗、论语选读" },
  { id: "science", name: "科普百科", motif: "star", palette: ["#E2EAEC", "#4E7180", "#9CBAC4"], desc: "回答孩子的十万个为什么" },
  { id: "fairytale", name: "童话世界", motif: "house", palette: ["#F2E6E6", "#A9666E", "#DDB2B6"], desc: "中外经典童话" },
  { id: "fable", name: "寓言故事", motif: "tree", palette: ["#EDE9DC", "#7E7A46", "#C4BE8E"], desc: "小故事里的大道理" },
  { id: "history", name: "历史人物", motif: "scroll", palette: ["#EFE4DA", "#8C6A50", "#CFAF95"], desc: "古人故事与品格启蒙" },
  { id: "nature", name: "自然探索", motif: "leaf", palette: ["#E4EBE1", "#55705A", "#A6BFA6"], desc: "四季、动植物与天气" },
  { id: "emotion", name: "情绪管理", motif: "cloud", palette: ["#F3E7DF", "#B07A5C", "#DFB9A2"], desc: "认识情绪、学会表达" },
  { id: "habit", name: "习惯养成", motif: "drop", palette: ["#E8E9E4", "#6A7A6C", "#AEBBAF"], desc: "刷牙、收纳、早睡早起" },
  { id: "nursery", name: "儿歌童谣", motif: "bird", palette: ["#F4E9DA", "#B58248", "#E0BF92"], desc: "可跟读的短童谣" },
  { id: "english", name: "英语启蒙", motif: "boat", palette: ["#E4E8EF", "#5B6B8C", "#A9B6CC"], desc: "中英双语短句" },
  { id: "safety", name: "安全教育", motif: "shield", palette: ["#F3E4DE", "#A85F4C", "#DDA894"], desc: "交通、用电、防走失" },
  { id: "family", name: "亲子共读", motif: "heart", palette: ["#F1E7DC", "#9A6B45", "#D5B692"], desc: "适合家长一起听" },
];
const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const catName = (id) => (CATEGORY_BY_ID[id] ? CATEGORY_BY_ID[id].name : "未分类");

const AGE_BANDS = [
  { id: "3-6", name: "3-6 岁", desc: "启蒙期 · 短句慢读" },
  { id: "6-9", name: "6-9 岁", desc: "成长期 · 情节完整" },
  { id: "9+", name: "9 岁以上", desc: "拓展期 · 篇幅较长" },
];

const STATUS_META = {
  published: { label: "已上架", cls: "badge-pub" },
  pending: { label: "待审核", cls: "badge-pending" },
  draft: { label: "草稿", cls: "badge-draft" },
  offline: { label: "已下架", cls: "badge-offline" },
  rejected: { label: "已驳回", cls: "badge-rejected" },
};

const TAGS = [
  "哄睡", "经典改编", "原创", "情绪", "科普", "动物", "勇敢", "亲子",
  "习惯", "友谊", "自然", "国学", "短篇", "连载", "获奖推荐", "主播精选",
];

const AUTHORS = [
  "林一禾", "苏晚舟", "陈小满", "周静宜", "许听雨", "程知夏", "叶南舟",
  "郑云舒", "何砚青", "梁小鹿", "孟秋白", "温言",
];
const EDITORS = ["林知远", "赵晓棠", "吴桐", "沈亦宁", "程未"];

/* ---------- 标题池 ---------- */
const CURATED_TITLES = [
  "纸片上的字", "沉香救母", "小马过河", "月亮船", "猜猜我有多爱你", "爷爷一定有办法",
  "女娲补天", "精卫填海", "后羿射日", "嫦娥奔月", "大禹治水", "夸父追日", "哪吒闹海",
  "守株待兔", "画蛇添足", "拔苗助长", "亡羊补牢", "井底之蛙", "狐假虎威", "刻舟求剑",
  "掩耳盗铃", "邯郸学步", "三字经·人之初", "弟子规·入则孝", "千字文·天地玄黄",
  "唐诗·静夜思", "唐诗·咏鹅", "论语·学而时习之", "为什么会下雨", "牙齿的小秘密",
  "恐龙去哪儿了", "身体的卫士", "星星为什么会眨眼", "种子的旅行", "蜜蜂的舞蹈",
  "大海的潮汐", "森林里的居民", "四季的秘密", "白雪公主", "小红帽", "丑小鸭",
  "卖火柴的小女孩", "拇指姑娘", "坚定的锡兵", "龟兔赛跑", "农夫与蛇", "狐狸和乌鸦",
  "狼来了", "蚂蚁和蟋蟀", "北风与太阳", "司马光砸缸", "曹冲称象", "匡衡凿壁偷光",
  "李白与铁杵", "岳飞的故事", "孔融让梨", "生气的小火山", "我好害怕", "分享的快乐",
  "第一次上幼儿园", "输了也没关系", "妈妈还没来接我", "刷牙小卫士", "自己穿衣服",
  "早睡早起", "收玩具", "不挑食的小老虎", "小星星", "数鸭子", "两只老虎", "拔萝卜",
  "丢手绢", "找朋友", "Hello, Colors", "Animal Friends", "My First Words",
  "Five Little Ducks", "不和陌生人走", "红灯停绿灯行", "着火了怎么办", "插座不能碰",
  "游泳要小心", "小熊的晚安吻", "会打呼噜的云", "晚安，小刺猬", "月亮掉进池塘里",
  "睡不着的小绵羊", "我爸爸", "逃家小兔", "爱心树", "活了一百万次的猫",
  "云朵面包", "小蓝和小黄", "好饿的毛毛虫", "花婆婆", "田鼠阿佛", "小黑鱼",
  "石头汤", "三个和尚", "猴子捞月", "十二生肖的故事", "年的故事", "端午节的故事",
  "中秋节的月亮", "元宵节的灯", "小蝌蚪找妈妈", "雪孩子", "没头脑和不高兴",
  "神笔马良", "九色鹿", "渔童", "猪八戒吃西瓜", "孙悟空出世", "三打白骨精",
  "小鲤鱼跳龙门", "小猫钓鱼", "小壁虎借尾巴", "小公鸡和小鸭子", "要下雨了",
  "秋天到了", "小雪花", "风在哪里", "影子是我的好朋友", "会变的声音",
  "为什么天是蓝的", "雨是从哪里来的", "星星的家在哪里", "小水滴的旅行",
  "谁在夜里工作", "会发光的萤火虫", "大树的一年", "螃蟹为什么横着走",
  "恐龙小百科·霸王龙", "恐龙小百科·三角龙", "身体的秘密·心脏",
  "身体的秘密·骨头", "身体的秘密·鼻子", "我的第一本天气书",
  "爱哭的小兔子", "勇敢的小刺猬", "慢吞吞的小蜗牛", "想家的小狐狸",
  "迷路的小企鹅", "好奇的小海豚", "害羞的小猫头鹰", "勤快的小蚂蚁",
  "爱提问的小松鼠", "大嗓门的小公鸡", "睡不着的小熊", "会飞的小猪",
];
const LONG_TAIL_HEADS = [
  "爱哭的", "勇敢的", "会飞的", "贪吃的", "睡不着的", "迷路的", "好奇的",
  "慢吞吞的", "爱笑的", "想家的", "小小的", "大嗓门的", "害羞的", "勤快的", "爱提问的",
];
const LONG_TAIL_SUBJECTS = [
  "小熊", "兔子", "松鼠", "月亮", "纸船", "星星", "小狐狸", "蜗牛", "风铃",
  "蒲公英", "小象", "刺猬", "小鹿", "灯笼", "雨滴", "小海豚", "猫头鹰", "小乌龟",
  "萤火虫", "雪人",
];
const LONG_TAIL_TAILS = [
  "找妈妈", "的旅行", "的秘密", "过冬记", "的心愿", "交朋友", "上学记",
  "和它的朋友们", "做了一个梦", "迷路了", "学会分享", "的第一场雪",
  "的夜晚", "去看海", "的小花园",
];
const SERIES_SUFFIX = ["· 上篇", "· 下篇", "· 第二集", "· 第三集", "· 亲子版", "· 朗读版"];

const BODY_PARAGRAPHS = [
  "天刚擦黑，窗外的风把梧桐叶吹得沙沙响。小屋里的灯亮着，暖黄的一小团。",
  "「今天想听什么呀？」妈妈把被子往上拉了拉，盖住肩头。孩子想了想，说想听一个很远很远的故事。",
  "于是故事就从一条小路开始了。小路两边长着高高的芦苇，风一过，芦苇就弯下腰去。",
  "路上遇见了一只小动物，它的耳朵上沾着一片花瓣。它说它要去找一样丢了很久的东西。",
  "他们一起往前走。走过石桥，走过晒谷场，走过一盏一盏亮起来的灯。",
  "夜越来越深，星星一颗一颗浮上来。孩子的声音也越来越轻，最后只剩下呼吸。",
  "故事说完了。窗外的风还在吹，灯还亮着，屋子里很安静，也很暖和。",
  "第二天早上，孩子在枕头边发现一片花瓣。他笑了，把它夹进了最厚的那本书里。",
];

/* ---------- 封面插画（程序绘制，示意用） ---------- */
const MOTIFS = {
  moon: (a, b) => `
    <circle cx="86" cy="30" r="15" fill="${b}"/>
    <circle cx="80" cy="26" r="15" fill="var(--motif-bg)"/>
    <path d="M0 74 Q26 52 52 68 T120 62 L120 90 L0 90 Z" fill="${a}" opacity=".55"/>`,
  hill: (a, b) => `
    <path d="M0 78 L34 40 L60 70 L84 34 L120 78 Z" fill="${a}" opacity=".6"/>
    <circle cx="30" cy="26" r="9" fill="${b}"/>`,
  boat: (a, b) => `
    <path d="M14 62 H106 L88 80 H32 Z" fill="${a}"/>
    <path d="M60 22 L60 60 M60 24 L92 58 H60 Z" fill="${b}"/>
    <path d="M6 84 Q30 76 60 84 T114 84" stroke="${a}" stroke-width="3" fill="none"/>`,
  lantern: (a, b) => `
    <rect x="42" y="26" width="36" height="44" rx="14" fill="${a}"/>
    <rect x="56" y="16" width="8" height="10" rx="3" fill="${b}"/>
    <path d="M60 70 v12" stroke="${b}" stroke-width="3"/>
    <path d="M50 38 q10 -8 20 0" stroke="var(--motif-bg)" stroke-width="3" fill="none"/>`,
  leaf: (a, b) => `
    <path d="M60 82 V34" stroke="${b}" stroke-width="3"/>
    <path d="M60 52 C34 46 26 30 30 20 C48 20 60 32 60 52 Z" fill="${a}"/>
    <path d="M60 62 C86 56 94 40 90 30 C72 30 60 42 60 62 Z" fill="${a}" opacity=".7"/>`,
  star: (a, b) => `
    <path d="M60 18 L68 46 L96 46 L73 62 L81 90 L60 72 L39 90 L47 62 L24 46 L52 46 Z" fill="${a}"/>`,
  house: (a, b) => `
    <path d="M24 48 L60 20 L96 48 Z" fill="${a}"/>
    <rect x="34" y="48" width="52" height="34" rx="4" fill="${b}"/>
    <rect x="54" y="60" width="14" height="22" rx="3" fill="var(--motif-bg)"/>`,
  bird: (a, b) => `
    <ellipse cx="58" cy="52" rx="24" ry="17" fill="${a}"/>
    <circle cx="80" cy="40" r="10" fill="${b}"/>
    <path d="M86 40 l12 4 -12 4 Z" fill="${b}"/>
    <path d="M40 64 q16 12 34 2" stroke="var(--motif-bg)" stroke-width="3" fill="none"/>`,
  cloud: (a, b) => `
    <path d="M28 66 a16 16 0 0 1 4 -31 a20 20 0 0 1 38 -4 a14 14 0 0 1 16 22 Z" fill="${a}"/>
    <circle cx="88" cy="26" r="10" fill="${b}"/>`,
  book: (a, b) => `
    <path d="M22 30 h34 a6 6 0 0 1 6 6 v40 h-34 a6 6 0 0 1 -6 -6 Z" fill="${a}"/>
    <path d="M98 30 h-34 a6 6 0 0 0 -6 6 v40 h34 a6 6 0 0 0 6 -6 Z" fill="${b}"/>
    <path d="M60 36 v40" stroke="var(--motif-bg)" stroke-width="3"/>`,
  tree: (a, b) => `
    <rect x="55" y="56" width="10" height="28" rx="4" fill="${b}"/>
    <circle cx="60" cy="42" r="22" fill="${a}"/>
    <circle cx="40" cy="52" r="14" fill="${a}" opacity=".75"/>
    <circle cx="80" cy="52" r="14" fill="${a}" opacity=".75"/>`,
  drop: (a, b) => `
    <path d="M60 20 C74 42 86 52 86 64 a26 26 0 0 1 -52 0 C34 52 46 42 60 20 Z" fill="${a}"/>
    <circle cx="50" cy="62" r="6" fill="${b}" opacity=".8"/>`,
  scroll: (a, b) => `
    <rect x="28" y="24" width="64" height="48" rx="6" fill="${a}"/>
    <path d="M40 40 h40 M40 52 h40 M40 64 h24" stroke="${b}" stroke-width="4" stroke-linecap="round"/>`,
  shield: (a, b) => `
    <path d="M60 18 L92 30 v22 c0 18 -14 28 -32 34 C42 80 28 70 28 52 V30 Z" fill="${a}"/>
    <path d="M46 52 l10 10 l20 -22" stroke="var(--motif-bg)" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  heart: (a, b) => `
    <path d="M60 80 C30 60 22 46 30 34 c7 -11 22 -11 30 2 c8 -13 23 -13 30 -2 c8 12 0 26 -30 46 Z" fill="${a}"/>
    <circle cx="86" cy="26" r="7" fill="${b}"/>`,
};

function coverArt(seed, catId, opts) {
  const o = opts || {};
  const cat = CATEGORY_BY_ID[catId] || CATEGORIES[0];
  const [bg, a, b] = cat.palette;
  const motif = (MOTIFS[cat.motif] || MOTIFS.moon)(a, b);
  const cls = o.className || "cover";
  const size = o.size ? ` width="${o.size}" height="${o.size}"` : "";
  const label = o.label ? ` role="img" aria-label="${o.label}"` : ' aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 120 90" preserveAspectRatio="xMidYMid slice"${size}${label} style="--motif-bg:${bg};background:${bg}">${motif}</svg>`;
}
function coverSvgByStory(story, opts) {
  if (story.coverUrl) {
    const cls = (opts && opts.className) != null ? opts.className : "cover";
    return `<img class="${cls}" src="${story.coverUrl}" alt="" width="120" height="90" />`;
  }
  return coverArt(story.id, story.category, opts);
}

/* ---------- 故事数据 ---------- */
function buildTitles(rnd, total) {
  const titles = [];
  const seen = new Set();
  CURATED_TITLES.forEach((t) => {
    if (!seen.has(t)) {
      seen.add(t);
      titles.push(t);
    }
  });
  let guard = 0;
  while (titles.length < total && guard < total * 40) {
    guard += 1;
    let t = `${pick(rnd, LONG_TAIL_HEADS)}${pick(rnd, LONG_TAIL_SUBJECTS)}${pick(rnd, LONG_TAIL_TAILS)}`;
    if (seen.has(t)) {
      const base = CURATED_TITLES[Math.floor(rnd() * CURATED_TITLES.length)];
      t = `${base}${pick(rnd, SERIES_SUFFIX)}`;
    }
    if (seen.has(t)) continue;
    seen.add(t);
    titles.push(t);
  }
  return titles;
}

function buildStories(today) {
  const rnd = mulberry32(20260921);
  const TOTAL = 2197;
  const titles = buildTitles(rnd, TOTAL);
  const statusPool = [];
  const counts = { published: 1655, pending: 128, draft: 214, offline: 200 };
  Object.keys(counts).forEach((k) => {
    for (let i = 0; i < counts[k]; i += 1) statusPool.push(k);
  });
  for (let i = statusPool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [statusPool[i], statusPool[j]] = [statusPool[j], statusPool[i]];
  }

  const stories = [];
  for (let i = 0; i < TOTAL; i += 1) {
    const status = statusPool[i];
    const category = CATEGORIES[Math.floor(rnd() * CATEGORIES.length)];
    const age = pick(rnd, AGE_BANDS).id;
    const words = intBetween(rnd, 260, 3200);
    const seconds = Math.round((words / 220) * 60);
    /* 命名故事（真实感篇名池）排在最近更新的位置，列表首页即可看到 */
    const ageDays = i < CURATED_TITLES.length ? intBetween(rnd, 0, 20) : intBetween(rnd, 0, 180);
    const updatedAt = daysAgo(today, ageDays);
    const createdAt = daysAgo(today, ageDays + intBetween(rnd, 3, 90));
    const tagCount = intBetween(rnd, 1, 3);
    const tags = [];
    while (tags.length < tagCount) {
      const t = pick(rnd, TAGS);
      if (!tags.includes(t)) tags.push(t);
    }
    const popularity = Math.pow(rnd(), 2.4);
    const plays = status === "published" ? Math.round(popularity * 68000 + 120) : 0;
    const story = {
      id: `ST${1000 + i}`,
      title: titles[i],
      category: category.id,
      age,
      tags,
      words,
      seconds,
      hasCover: true,
      audio: null,
      status,
      plays,
      completion: Number(between(rnd, 0.38, 0.93).toFixed(3)),
      createdAt,
      updatedAt,
      author: status === "draft" ? "—" : pick(rnd, AUTHORS),
      source: pick(rnd, ["原创", "公版改编", "签约作者"]),
      editor: pick(rnd, EDITORS),
      submittedAt: status === "pending" ? daysAgo(today, intBetween(rnd, 0, 8)) : null,
      rejectReason: "",
      body: BODY_PARAGRAPHS.slice(0, intBetween(rnd, 4, 8))
        .map((p) => (i % 7 === 0 ? `${titles[i]}　${p}` : p))
        .join("\n\n"),
    };
    stories.push(story);
  }

  /* 214 篇缺封面：优先落在草稿与已下架里 */
  const weak = stories.filter((s) => s.status === "draft" || s.status === "offline");
  const needCover = new Set();
  let idx = 0;
  while (needCover.size < 214 && idx < weak.length) {
    needCover.add(weak[Math.floor(rnd() * weak.length)].id);
    idx += 1;
  }
  stories.forEach((s) => {
    s.hasCover = !needCover.has(s.id);
  });

  /* 少量已驳回样本，让状态筛选有内容 */
  stories
    .filter((s) => s.status === "offline")
    .slice(0, 26)
    .forEach((s, i) => {
      if (i % 2 === 0) {
        s.status = "rejected";
        s.rejectReason = pick(rnd, [
          "正文出现不适龄表达，请修改后重新提交",
          "与已有故事《小马过河》内容重复度较高",
          "封面缺失，无法进入上架流程",
        ]);
      }
    });

  stories.sort((a, b) => b.updatedAt - a.updatedAt);
  return stories;
}

/* ---------- 家庭 / 儿童 ---------- */
const CITIES = ["杭州", "成都", "南京", "武汉", "西安", "青岛", "长沙", "苏州", "重庆", "郑州"];
const NICKNAMES = [
  "小满妈妈", "果果爸", "月亮妈妈", "糖糖奶奶", "阿布妈妈", "小雨点爸爸",
  "米粒妈妈", "团团妈", "禾禾爸爸", "暖暖妈妈", "小鹿妈妈", "石头爸爸",
];
const CHILD_NAMES = ["小满", "果果", "团团", "糖糖", "米粒", "禾禾", "暖暖", "阿布", "小鹿", "石头", "朵朵", "多多"];
const DEVICES = ["iPhone", "Android", "微信小程序"];

function buildFamilies(today, stories) {
  const rnd = mulberry32(778899);
  const families = [];
  for (let i = 0; i < 64; i += 1) {
    const childCount = rnd() > 0.62 ? 2 : 1;
    const children = [];
    for (let c = 0; c < childCount; c += 1) {
      const ageYears = intBetween(rnd, 3, 10);
      const records = [];
      const recCount = intBetween(rnd, 8, 16);
      for (let r = 0; r < recCount; r += 1) {
        const story = stories[Math.floor(rnd() * stories.length)];
        const progress = between(rnd, 0.25, 1);
        records.push({
          storyId: story.id,
          title: story.title,
          category: story.category,
          playedAt: daysAgo(today, intBetween(rnd, 0, 27)),
          device: pick(rnd, DEVICES),
          progress,
          listenedSeconds: Math.round(story.seconds * progress),
          finished: progress > 0.92,
        });
      }
      records.sort((a, b) => b.playedAt - a.playedAt);
      children.push({
        id: `CH${2000 + i * 2 + c}`,
        name: pick(rnd, CHILD_NAMES),
        ageYears,
        band: ageYears <= 6 ? "3-6" : ageYears <= 9 ? "6-9" : "9+",
        favorite: pick(rnd, CATEGORIES).id,
        totalMinutes: intBetween(rnd, 120, 1860),
        streakDays: intBetween(rnd, 0, 46),
        records,
      });
    }
    const lastActive = daysAgo(today, intBetween(rnd, 0, 45));
    const monthly = intBetween(rnd, 0, 900);
    families.push({
      id: `FM${3000 + i}`,
      nickname: pick(rnd, NICKNAMES),
      phone: `13${intBetween(rnd, 0, 9)}${intBetween(rnd, 10000000, 99999999)}`,
      city: pick(rnd, CITIES),
      children,
      registeredAt: daysAgo(today, intBetween(rnd, 1, 640)),
      lastActive,
      monthlyMinutes: monthly,
      dailyMinutes: intBetween(rnd, 0, 62),
      status: monthly === 0 ? "沉睡" : (today - lastActive) / 86400000 < 7 ? "活跃" : "低频",
    });
  }
  return families;
}

/* ---------- 管理员与日志 ---------- */
function buildAdmins(today) {
  return [
    { id: "AD01", name: "林知远", account: "linzhiyuan@story", role: "超级管理员", scope: "全部模块", status: "启用", lastLogin: daysAgo(today, 0), creator: "系统初始化" },
    { id: "AD02", name: "赵晓棠", account: "zhaoxiaotang@story", role: "内容运营", scope: "故事、运营位", status: "启用", lastLogin: daysAgo(today, 1), creator: "林知远" },
    { id: "AD03", name: "吴桐", account: "wutong@story", role: "审核编辑", scope: "审核队列", status: "启用", lastLogin: daysAgo(today, 0), creator: "林知远" },
    { id: "AD04", name: "沈亦宁", account: "shenyining@story", role: "审核编辑", scope: "审核队列", status: "启用", lastLogin: daysAgo(today, 4), creator: "林知远" },
    { id: "AD05", name: "程未", account: "chengwei@story", role: "数据分析", scope: "数据中心（只读）", status: "启用", lastLogin: daysAgo(today, 9), creator: "林知远" },
    { id: "AD06", name: "许听雨", account: "xutingyu@story", role: "内容运营", scope: "故事、运营位", status: "停用", lastLogin: daysAgo(today, 88), creator: "林知远" },
  ];
}

function buildLogs(today, admins) {
  const rnd = mulberry32(4242);
  const acts = [
    ["故事管理", "提交审核"], ["审核队列", "通过"], ["审核队列", "驳回"],
    ["故事管理", "批量上架"], ["故事管理", "编辑正文"], ["运营位", "调整排序"],
    ["运营位", "更换 banner"], ["系统", "新增管理员"], ["数据看板", "导出报表"],
    ["故事管理", "新增故事"], ["运营位", "新建场景歌单"], ["故事管理", "下架"],
  ];
  const objs = [
    "《纸片上的字》", "《沉香救母》", "《小马过河》", "《月亮船》", "首页 banner A",
    "睡前 30 分钟歌单", "《猜猜我有多爱你》", "管理员 程未", "近 30 天播放报表",
    "《九色鹿》", "《神笔马良》", "首页精选位",
  ];
  const logs = [];
  for (let i = 0; i < 120; i += 1) {
    const act = pick(rnd, acts);
    const admin = admins[Math.floor(rnd() * admins.length)];
    logs.push({
      id: `LG${9000 + i}`,
      at: daysAgo(today, intBetween(rnd, 0, 20)),
      time: `${pad2(intBetween(rnd, 8, 22))}:${pad2(intBetween(rnd, 0, 59))}`,
      admin: admin.name,
      role: admin.role,
      module: act[0],
      action: act[1],
      target: pick(rnd, objs),
      ip: `10.20.${intBetween(rnd, 1, 12)}.${intBetween(rnd, 2, 240)}`,
      result: rnd() > 0.06 ? "成功" : "失败",
    });
  }
  logs.sort((a, b) => b.at - a.at);
  return logs;
}

/* ---------- 运营位 ---------- */
function buildOps(stories) {
  const published = stories.filter((s) => s.status === "published");
  const take = (n, offset) => published.slice(offset, offset + n).map((s) => s.id);
  return {
    banners: [
      { id: "BN01", title: "睡前故事专辑 · 春天篇", subtitle: "12 篇哄睡新作，舒缓女声 TTS", storyIds: take(3, 0), period: "长期", status: "展示中" },
      { id: "BN02", title: "中国神话十讲", subtitle: "从女娲补天到哪吒闹海", storyIds: take(3, 3), period: "3 月 1 日 — 3 月 31 日", status: "展示中" },
      { id: "BN03", title: "亲子共读 · 家长推荐", subtitle: "适合 6-9 岁一起听", storyIds: take(3, 6), period: "待排期", status: "已下线" },
    ],
    featured: take(8, 9),
    playlists: [
      { id: "PL01", name: "睡前 30 分钟", desc: "音量渐弱，语速 0.9 倍", storyIds: take(12, 20), audience: "3-6 岁", updatedAt: "每周更新" },
      { id: "PL02", name: "上学路上", desc: "10 分钟以内短篇，方便断续收听", storyIds: take(10, 34), audience: "6-9 岁", updatedAt: "每周更新" },
      { id: "PL03", name: "周末亲子共读", desc: "家长导读 + 提问引导", storyIds: take(8, 46), audience: "全年龄", updatedAt: "双周更新" },
      { id: "PL04", name: "国学启蒙晨读", desc: "三字经、唐诗跟读", storyIds: take(9, 56), audience: "6-9 岁", updatedAt: "每月更新" },
    ],
  };
}

/* ---------- 趋势与分布（按状态实时派生） ---------- */
function buildTrend(today) {
  const rnd = mulberry32(31415);
  const days = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = daysAgo(today, i);
    const weekday = d.getDay();
    const weekend = weekday === 0 || weekday === 6 ? 1.18 : 1;
    const base = 36000 + (29 - i) * 240;
    const noise = between(rnd, 0.9, 1.1);
    const plays = Math.round(base * weekend * noise);
    days.push({
      date: d,
      plays,
      listeners: Math.round(plays * between(rnd, 0.24, 0.31)),
      completion: Number(between(rnd, 0.64, 0.72).toFixed(3)),
    });
  }
  return days;
}

function buildHourly() {
  const shape = [2, 1, 1, 0, 0, 0, 1, 6, 22, 12, 9, 11, 26, 14, 8, 10, 24, 38, 52, 68, 96, 78, 40, 14];
  const total = shape.reduce((a, b) => a + b, 0);
  return shape.map((v, h) => ({ hour: h, value: v, share: v / total }));
}

function categoryDistribution(stories) {
  return CATEGORIES.map((c) => {
    const list = stories.filter((s) => s.category === c.id);
    return {
      id: c.id,
      name: c.name,
      palette: c.palette,
      total: list.length,
      published: list.filter((s) => s.status === "published").length,
      plays: list.reduce((sum, s) => sum + s.plays, 0),
    };
  }).sort((a, b) => b.plays - a.plays);
}

/* ---------- 汇总指标 ---------- */
function healthSummary(stories) {
  return {
    pending: stories.filter((s) => s.status === "pending").length,
    missingCover: stories.filter((s) => !s.hasCover).length,
    noAudio: stories.filter((s) => !s.audio).length,
    total: stories.length,
    published: stories.filter((s) => s.status === "published").length,
    draft: stories.filter((s) => s.status === "draft").length,
  };
}
