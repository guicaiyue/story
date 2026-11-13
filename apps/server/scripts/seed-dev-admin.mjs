/**
 * Seeds DEV-ONLY data needed for the admin UI to show realistic content.
 *
 * 03-decisions D7: this script targets the dev database ONLY (story-dev-postgres).
 * It refuses to run against the production `story` database.
 *
 * What it adds:
 *   - admin + editor accounts (so /api/admin/auth/login works)
 *   - families and children (家庭与儿童档案)
 *   - play events spread over 14 days, weighted to 20:00-23:00 (睡前场景)
 *   - a handful of stories moved to `review` / `draft` (审核队列)
 *   - banners (推荐位) and featured picks
 *
 * Idempotent: clears app.* rows it owns and resets touched story statuses first.
 */
import { PrismaClient } from '@prisma/client';
import { loadDotEnv } from '../src/load-env.mjs';

loadDotEnv();

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (/\/story(\?|$)/.test(url)) {
  console.error('REFUSING TO RUN: DATABASE_URL points at the production `story` database.');
  console.error('03-decisions D7 forbids seeding production. Use story_dev.');
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url } } });

const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  console.log('seeding dev admin data…');

  // --- reset the rows this script owns -------------------------------------
  await db.$executeRawUnsafe(
    'TRUNCATE app.play_event, app.favorite, app.progress, app.setting, app.child, app.family, app.account, app.banner, app.audit_log CASCADE',
  );
  // Restore all stories to published, then re-mark a small set below.
  await db.$executeRawUnsafe("UPDATE public.story_main SET status='published', featured=false, cover_url=NULL, audio_url=NULL");

  // --- accounts ------------------------------------------------------------
  const admin = await db.account.create({
    data: {
      phone: '13900000001',
      nickname: '林知远',
      role: 'admin',
      family: { create: { name: '林家' } },
      setting: { create: {} },
    },
  });
  const editor = await db.account.create({
    data: {
      phone: '13900000002',
      nickname: '编辑小周',
      role: 'editor',
      family: { create: { name: '周家' } },
      setting: { create: {} },
    },
  });
  // A plain parent account, to prove the UI does not grant admin to everyone.
  const parent = await db.account.create({
    data: { phone: '13800000001', nickname: '朵朵妈', role: 'parent', family: { create: { name: '朵朵家' } }, setting: { create: {} } },
  });

  // --- children ------------------------------------------------------------
  const childSpecs = [
    { accountId: parent.id, nickname: '朵朵', ageBand: '3-6', birthday: new Date('2021-05-01') },
    { accountId: parent.id, nickname: '小满', ageBand: '6-9', birthday: new Date('2018-09-12') },
    { accountId: admin.id, nickname: '林小树', ageBand: '3-6', birthday: new Date('2022-02-20') },
    { accountId: editor.id, nickname: '周团团', ageBand: '6-9', birthday: new Date('2019-07-03') },
  ];
  for (const spec of childSpecs) await db.child.create({ data: spec });

  // --- stories: put a realistic slice into the review queue ----------------
  const total = await db.story.count();
  const reviewIds = await db.$queryRaw`
    SELECT id FROM public.story_main ORDER BY id DESC LIMIT 12`;
  const draftIds = await db.$queryRaw`
    SELECT id FROM public.story_main ORDER BY id ASC LIMIT 5`;
  const featuredIds = await db.$queryRaw`
    SELECT id FROM public.story_main WHERE age_band = '3-6' ORDER BY id DESC LIMIT 6`;

  for (const r of reviewIds) await db.story.update({ where: { id: r.id }, data: { status: 'review' } });
  for (const r of draftIds) await db.story.update({ where: { id: r.id }, data: { status: 'draft' } });
  for (const r of featuredIds) await db.story.update({ where: { id: r.id }, data: { featured: true } });

  // --- play events: 14 days, weighted to the bedtime window ----------------
  const storyIds = (await db.story.findMany({ where: { status: 'published' }, select: { id: true }, take: 400 })).map((s) => s.id);
  const events = [];
  const accounts = [parent.id, admin.id, editor.id];

  // Deterministic-ish pseudo random so reruns look similar.
  let seed = 20261109;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let day = 13; day >= 0; day--) {
    const perDay = 90 + Math.floor(rnd() * 70);
    for (let i = 0; i < perDay; i++) {
      // 62% of plays land in 20:00-23:00 (01-product-brief §6 bedtime target).
      const bedtime = rnd() < 0.62;
      const hour = bedtime ? 20 + Math.floor(rnd() * 3) : Math.floor(rnd() * 24);
      const at = new Date();
      at.setDate(at.getDate() - day);
      at.setHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
      if (at.getTime() > Date.now()) continue;

      const acct = accounts[Math.floor(rnd() * accounts.length)];
      const storyId = storyIds[Math.floor(rnd() * storyIds.length)];
      const started = rnd() < 0.85;
      if (!started) continue;

      events.push({ id: rid('pe'), accountId: acct, childId: null, storyId, event: 'start', positionSec: 0, at });
      // ~62% completion rate, so 完播率 has a realistic value once an endpoint exists.
      if (rnd() < 0.62) {
        events.push({ id: rid('pe'), accountId: acct, childId: null, storyId, event: 'complete', positionSec: 240, at: new Date(at.getTime() + 200_000) });
      }
    }
  }
  for (let i = 0; i < events.length; i += 500) {
    await db.playEvent.createMany({ data: events.slice(i, i + 500) });
  }

  // --- banners (推荐位) ----------------------------------------------------
  await db.banner.createMany({
    data: [
      { title: '今晚听什么 · 睡前精选', imageUrl: '/img/banner-bedtime.svg', targetType: 'story', targetId: String(featuredIds[0]?.id ?? ''), sort: 1, status: 'active' },
      { title: '成语故事 · 一天一个', imageUrl: '/img/banner-idiom.svg', targetType: 'category', targetId: '11', sort: 2, status: 'active' },
      { title: '经典故事合集', imageUrl: '/img/banner-classic.svg', targetType: 'category', targetId: '10', sort: 3, status: 'hidden' },
    ],
  });

  // --- progress + favorites, so 家庭档案 has something to show -------------
  for (const acct of accounts) {
    for (let i = 0; i < 6; i++) {
      const storyId = storyIds[Math.floor(rnd() * storyIds.length)];
      await db.progress.upsert({
        where: { accountId_storyId: { accountId: acct, storyId } },
        create: { accountId: acct, storyId, positionSec: Math.floor(rnd() * 300) },
        update: {},
      });
    }
  }

  // --- audit log so 管理员与日志 is not empty ------------------------------
  await db.auditLog.createMany({
    data: [
      { id: rid('audit'), actorId: admin.id, action: 'login', target: 'admin', at: new Date(Date.now() - 3600_000) },
      { id: rid('audit'), actorId: admin.id, action: 'story.approve', target: String(reviewIds[0]?.id ?? 1), detail: { note: '内容与年龄档匹配' }, at: new Date(Date.now() - 3000_000) },
      { id: rid('audit'), actorId: editor.id, action: 'story.submit', target: String(reviewIds[1]?.id ?? 2), at: new Date(Date.now() - 2400_000) },
      { id: rid('audit'), actorId: admin.id, action: 'banner.update', target: '3', detail: { status: 'hidden' }, at: new Date(Date.now() - 1800_000) },
    ],
  });

  console.log('done:');
  console.log(`  stories total      ${total}`);
  console.log(`  review queue       ${reviewIds.length}`);
  console.log(`  draft              ${draftIds.length}`);
  console.log(`  featured           ${featuredIds.length}`);
  console.log(`  play events        ${events.length}`);
  console.log(`  admin login        13900000001 (verify code from FIXED_SMS_CODE)`);
  console.log(`  editor login       13900000002`);
}

main()
  .catch((err) => {
    console.error('seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
