#!/usr/bin/env node
/**
 * 端到端冒烟：用**生产镜像 + 生产数据副本**走一遍 App 与后台的真实旅程。
 *
 * 与 `pnpm test` 的区别：单测跑在 fixture（4 条故事）上，这里跑在真实数据上
 * （2197 条内容、真实分类、迁移后的 schema），它回答的是「这么上线，App 能不能用」。
 *
 * 用法（先起一个连副本库的服务，例如）：
 *   docker run -d --name smoke-e2e --network dsh-dev_default \
 *     -e NODE_ENV=production -e DATABASE_URL=...story_e2e_seed \
 *     -e JWT_SECRET=... -e FIXED_SMS_CODE=87654321 story-server:m4
 *   BASE=http://smoke-e2e:3000 ADMIN_PHONE=13900000001 ADMIN_CODE=87654321 \
 *     node apps/server/scripts/e2e-smoke.mjs
 *
 * 退出码 0 = 全通；任何一步失败打印状态与响应片段并以 1 退出。
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? '13900000001';
const ADMIN_CODE = process.env.ADMIN_CODE ?? '';

const out = [];
let token = '';

async function call(name, path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (token && !headers.authorization) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const ok = res.ok && body?.ok !== false;
  out.push({ name, status: res.status, ok, sample: JSON.stringify(body).slice(0, 110) });
  return { body, ok };
}

const j = (data) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

const reg = await call('注册游客设备', '/api/auth/register-device', {
  method: 'POST',
  ...j({ deviceId: `e2e-${Date.now()}` }),
});
token = reg.body?.data?.token ?? '';

await call('首页聚合', '/api/home');
await call('分类列表', '/api/categories');
const list = await call('故事列表', '/api/stories?pageSize=5');
const id = list.body?.data?.items?.[0]?.id;
if (!id) throw new Error('故事列表没有返回任何内容，无法继续');
await call('故事详情', `/api/stories/${id}`);
await call('播放上报', '/api/plays', {
  method: 'POST',
  ...j({ storyId: id, event: 'start', positionSec: 0 }),
});
await call('阅读进度', `/api/progress/${id}`, {
  method: 'PUT',
  ...j({ percent: 0.4, positionSec: 120 }),
});
await call('进度读回', '/api/progress');
await call('收藏', `/api/favorites/${id}`, { method: 'POST' });
await call('收藏列表', '/api/favorites');
await call('我的信息', '/api/me');
await call('音频（TTS 或缓存）', `/api/stories/${id}/audio`);

if (ADMIN_CODE) {
  const login = await call('后台登录', '/api/admin/auth/login', {
    method: 'POST',
    ...j({ phone: ADMIN_PHONE, code: ADMIN_CODE }),
  });
  const adminToken = login.body?.data?.token ?? '';
  const auth = adminToken ? { authorization: `Bearer ${adminToken}` } : {};
  await call('后台仪表盘', '/api/admin/dashboard', { headers: auth });
  await call('后台故事列表', '/api/admin/stories?pageSize=5', { headers: auth });
  await call('后台分析概览', '/api/admin/analytics/overview', { headers: auth });
} else {
  out.push({ name: '后台（跳过：未给 ADMIN_CODE）', status: 0, ok: true, sample: '' });
}

for (const r of out) {
  console.log(`${r.ok ? '✅' : '❌'} ${String(r.status).padEnd(3)} ${r.name}${r.ok ? '' : `  ${r.sample}`}`);
}
const bad = out.filter((r) => !r.ok);
console.log(`\n合计 ${out.length} 项，失败 ${bad.length}`);
process.exit(bad.length ? 1 : 0);
