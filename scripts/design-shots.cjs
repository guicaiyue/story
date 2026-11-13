#!/usr/bin/env node
// 注意：用 CommonJS（.cjs）。容器里 puppeteer 靠 NODE_PATH 找，ESM 的 import 不认 NODE_PATH。
/**
 * 把 docs/design 下的原型渲染成 PNG（不需要图形浏览器）。
 *
 * 由 design-shots.sh 在 browserless/chrome 容器里执行：
 *   /designs  仓库 docs/design（只读）
 *   /out      临时输出目录（容器内可写）
 *
 * 每个分组输出到 /out/<group>/ 下。加新原型只需在 GROUPS 里加一项。
 */
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

// 手机原型：9 屏，hash 路由。
const PHONE = [
  ['launch', '#/launch'], ['home', '#/home'], ['category', '#/category'],
  ['story', '#/story'], ['player', '#/player'], ['mine', '#/mine'],
  ['gate', '#/gate'], ['parent', '#/parent'], ['night', '#/night'],
];

// 后台原型：登录后点左侧导航切换视图（没有 hash 路由）。
const ADMIN = ['dashboard', 'stories', 'review', 'ops', 'families', 'analytics', 'system'];

const GROUPS = {
  phone: {
    html: 'android-app/index.html',
    viewport: { width: 900, height: 1000 },
    element: '.phone-frame',
    shots: PHONE.map(([name, hash]) => ({ name, hash })),
  },
  tablet: {
    html: 'android-app/tablet.html',
    viewport: { width: 1420, height: 1300 },
    fullPage: true,
    shots: [{ name: 'tablet' }],
  },
  admin: {
    html: 'admin-web/index.html',
    viewport: { width: 1440, height: 900 },
    // 原型有登录门：演示账号已预填，直接提交表单即可。
    login: "document.getElementById('login-form').requestSubmit()",
    clicks: ADMIN.map((route) => ({ name: route, selector: `[data-nav="${route}"]` })),
    shots: ADMIN.map((name) => ({ name })),
  },
};

(async () => {
const target = process.env.TARGET && process.env.TARGET !== 'all' ? process.env.TARGET.split(',') : Object.keys(GROUPS);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  headless: 'new',
});
let count = 0;

for (const key of target) {
  const group = GROUPS[key];
  if (!group) throw new Error(`没有这个分组：${key}（可选：${Object.keys(GROUPS).join('、')}）`);
  const dir = path.join('/out', key);
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ ...group.viewport, deviceScaleFactor: 1 });
  // 每屏重新加载：同一个 page 连续改 hash 会带着上一屏的滚动/过渡状态，截出来是错的。
  await page.goto(`file:///designs/${group.html}`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  if (group.login) {
    await page.evaluate(group.login);
    await new Promise((r) => setTimeout(r, 800));
  }

  for (const [index, shot] of group.shots.entries()) {
    if (index > 0 && shot.hash) {
      await page.goto('about:blank');
      await page.goto(`file:///designs/${group.html}${shot.hash}`, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 500));
    }
    if (shot.hash && index === 0) {
      await page.goto(`file:///designs/${group.html}${shot.hash}`, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 500));
    }
    const click = group.clicks?.[index];
    if (click) {
      await page.evaluate((sel) => document.querySelector(sel)?.click(), click.selector);
      await new Promise((r) => setTimeout(r, 500));
    }
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      for (const el of document.querySelectorAll('.content, .phone-content, .app, .screen')) el.scrollTop = 0;
    });
    await new Promise((r) => setTimeout(r, 100));

    const file = path.join(dir, `${shot.name}.png`);
    const element = group.element ? await page.$(group.element) : null;
    if (group.element && !element) throw new Error(`${group.html} 里找不到 ${group.element}`);
    await (element ?? page).screenshot({ path: file, ...(group.fullPage ? { fullPage: true } : {}) });
    count += 1;
    console.log(`✓ ${key}/${shot.name}`);
  }
  await page.close();
}

await browser.close();
console.log(`完成：${count} 张 → /out`);
})().catch((err) => {
  console.error('渲染失败：', err.message);
  process.exit(1);
});
