#!/usr/bin/env node
/**
 * 批量回填音频（所有者决策 c-mw99xnkq-2ehou：先 3 条验证，再批量回填）。
 *
 * 做法：对每条已上架且有正文的故事调用 getOrCreateAudio —— 与线上接口
 * **走同一条代码路径**，因此回填出来的东西和用户点击时得到的完全一致
 * （不会出现「脚本能生成、接口不能」的偏差）。
 *
 * 特性：
 *  - 断点续跑：进度记在 app.audio_job，中断后重跑不会重复合成。
 *  - 限速：每次合成之间 sleep，避免把 edge-tts 打到限流。
 *  - 失败隔离：单条失败不影响整体，状态与原因落库，最后汇总。
 *
 * 用法：
 *   node scripts/tts-backfill.mjs                 # 回填全部（已缓存的跳过）
 *   node scripts/tts-backfill.mjs --limit=50      # 只跑 50 条（先试水）
 *   node scripts/tts-backfill.mjs --ids=8,24,1260 # 只跑指定 id
 *   node scripts/tts-backfill.mjs --retry-failed  # 重试上次失败的
 */
import { PrismaClient } from '@prisma/client';
import {
  getOrCreateAudio,
  backfillStory,
  AudioSynthesisError,
  DEFAULT_VOICE,
} from '../src/services/tts-service.ts';
import { loadDotEnv } from '../src/load-env.mjs';

loadDotEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (see apps/server/.env)');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const has = (name) => args.includes(`--${name}`);

const limit = flag('limit') ? Number(flag('limit')) : undefined;
const ids = flag('ids') ? flag('ids').split(',').map(Number) : undefined;
const retryFailed = has('retry-failed');
/**
 * 默认**从短到长**处理。
 *
 * 全量耗时主要由长故事决定（1,500 字要分 1 块、5,000 字要 4 块，还要块间隔与
 * 退避），而中位数只有 769 字。按 id 顺序跑会把长故事均匀散布在整段时间里，
 * 于是「大部分内容多久可用」被最慢的那几条拖住；从短到长则让绝大多数内容
 * （p90 以内）在前半程就绪，长尾在最后处理。
 */
const longestFirst = has('longest-first');
/** 每次合成之间的间隔，避免触发上游限流。 */
const delayMs = flag('delay') ? Number(flag('delay')) : 350;

const db = new PrismaClient({ datasources: { db: { url } } });

/** 开发库保护：拒绝在生产库上批量合成（03-decisions D7）。 */
function assertNotProduction() {
  const m = /[/]([^/?]+)(\?|$)/.exec(url);
  const dbName = m?.[1] ?? '';
  if (/^story$/.test(dbName)) {
    console.error(`REFUSING TO RUN: DATABASE_URL points at production database "${dbName}".`);
    console.error('Batch synthesis must target the dev database (03-decisions D7).');
    process.exit(1);
  }
}
assertNotProduction();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 0) 先对账：把「已缓存但 story_main 没更新时间/地址」的条目补齐。
  //
  // 这一步让脚本自我修复 —— 中途被打断、或早期版本漏写 story_main 时，
  // 重跑一次就能把状态收敛，不需要人工介入。
  const drift = await db.$queryRaw`
    SELECT a.story_id AS id, a.duration_sec AS duration
    FROM app.audio_cache a
    JOIN public.story_main s ON s.id = a.story_id
    WHERE s.duration_sec IS DISTINCT FROM a.duration_sec
       OR s.audio_url IS DISTINCT FROM ('/api/stories/' || a.story_id || '/audio')
  `;
  if (drift.length > 0) {
    for (const row of drift) {
      await backfillStory(db, Number(row.id), Number(row.duration));
    }
    console.log(`reconciled ${drift.length} cached row(s) into story_main`);
  }

  // 1) 选出待处理的故事：已上架 + 有正文。
  const stories = await db.story.findMany({
    where: {
      status: 'published',
      ...(ids ? { id: { in: ids } } : {}),
      content: { is: { content: { not: '' } } },
    },
    select: { id: true, title: true, content: { select: { content: true } } },
    orderBy: { id: 'asc' },
  });

  // 按正文字数排序（默认短到长，见 longestFirst 的说明）。
  // 排序放在 JS 里做：Prisma 无法按关联字段的长度排序。
  stories.sort((a, b) => {
    const la = a.content?.content?.length ?? 0;
    const lb = b.content?.content?.length ?? 0;
    return longestFirst ? lb - la : la - lb;
  });
  if (limit) stories.splice(limit);

  if (stories.length === 0) {
    console.log('no stories matched');
    process.exit(0);
  }

  // 2) 跳过已缓存（除非 --retry-failed 指定重试失败项）。
  const cached = new Set(
    (await db.audioCache.findMany({ where: { voice: DEFAULT_VOICE }, select: { storyId: true } })).map((r) => r.storyId),
  );

  const failedBefore = new Set(
    retryFailed
      ? (await db.audioJob.findMany({ where: { state: 'failed' }, select: { storyId: true } })).map((r) => r.storyId)
      : [],
  );

  const todo = stories.filter((s) => {
    if (failedBefore.has(s.id)) return true;
    return !cached.has(s.id);
  });

  console.log(`voice=${DEFAULT_VOICE}  candidates=${stories.length}  cached=${cached.size}  todo=${todo.length}`);
  if (todo.length === 0) {
    console.log('nothing to do — all cached');
    process.exit(0);
  }

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  const startedAt = Date.now();

  for (const [i, story] of todo.entries()) {
    const label = `[${i + 1}/${todo.length}] #${story.id} ${story.title.slice(0, 24)}`;
    const job = await db.audioJob.create({
      data: { storyId: story.id, state: 'running', attempts: 1 },
    });

    try {
      const asset = await getOrCreateAudio(db, story.id, story.content?.content ?? '');
      await db.audioJob.update({
        where: { id: job.id },
        data: { state: asset.cached ? 'skipped' : 'done', updatedAt: new Date() },
      });
      if (asset.cached) skipped++;
      else ok++;
      const mb = (asset.byteSize / 1024 / 1024).toFixed(2);
      console.log(`${label}  ${asset.durationSec}s  ${mb}MB  ${asset.cached ? 'cached' : 'new'}`);
    } catch (e) {
      failed++;
      const message = e instanceof AudioSynthesisError ? e.message : String(e?.message ?? e);
      await db.audioJob.update({
        where: { id: job.id },
        data: { state: 'failed', error: message.slice(0, 500), updatedAt: new Date() },
      });
      console.error(`${label}  FAILED: ${message}`);
    }

    if (i < todo.length - 1) await sleep(delayMs);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\ndone in ${elapsed}s — new=${ok} cached=${skipped} failed=${failed}`);
  if (failed > 0) {
    console.log('re-run with --retry-failed to retry the failures');
  }
} finally {
  await db.$disconnect();
}
