import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { parseRange } from '../src/routes/audio-routes.js';
import { backfillStory, chunkText } from '../src/services/tts-service.js';
import { migrateTestDb, seedTestDb, testPrisma } from './helpers/test-db.js';

const db = testPrisma();
let app: FastifyInstance;

beforeAll(async () => {
  await migrateTestDb(db);
  await seedTestDb(db);
  app = await buildApp({ db, jwtSecret: 'test-secret-value-at-least-16', fixedSmsCode: '123456' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

/** Range 解析是纯函数 —— 这里把它钉死，因为播放器 seek 依赖它。 */
describe('parseRange', () => {
  it('returns null when there is no Range header', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('', 1000)).toBeNull();
  });

  it('parses an explicit start-end', () => {
    expect(parseRange('bytes=0-1023', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=100-200', 1000)).toEqual({ start: 100, end: 200 });
  });

  it('treats an open-ended range as "to the end"', () => {
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('parses a suffix range as "last N bytes"', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    // 请求的尾部比文件还大 -> 从头开始。
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('reports unsatisfiable when the start is past the end', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=5000-6000', 1000)).toBe('unsatisfiable');
  });

  it('reports unsatisfiable for a reversed or empty suffix range', () => {
    expect(parseRange('bytes=500-100', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });

  it('ignores malformed headers rather than throwing', () => {
    expect(parseRange('bytes=abc-def', 1000)).toBeNull();
    expect(parseRange('items=0-10', 1000)).toBeNull();
    expect(parseRange('bytes=', 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
  });
});

/**
 * 分块是长故事能否合成的前提：edge-tts 单次请求约 3.6MB（≈2,700 字）就截断，
 * 而 dev 库 2181 条已发布故事里 12.4% 超过这个量。不分块这些故事全部失败。
 */
describe('chunkText', () => {
  it('keeps short text in a single chunk', () => {
    const text = '小兔子找月亮。它抬头看了很久。';
    expect(chunkText(text)).toHaveLength(1);
  });

  it('splits at sentence boundaries, not mid-sentence', () => {
    const text = '第一句话。第二句话。第三句话。第四句话。';
    const chunks = chunkText(text, 12);
    // 每块都应以句末标点收尾（不把句子读成两半）。
    for (const c of chunks) {
      expect(c.endsWith('。')).toBe(true);
    }
    expect(chunks.join('')).toBe(text);
  });

  it('never loses or duplicates characters', () => {
    const text = '甲。乙！丙？丁；戊。'.repeat(50);
    const chunks = chunkText(text, 37);
    expect(chunks.join('')).toBe(text);
  });

  it('hard-splits a single sentence longer than the limit', () => {
    const long = '啊'.repeat(100);
    const chunks = chunkText(long, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(30);
    expect(chunks.join('')).toBe(long);
  });

  it('handles a realistic long story (previously failed at ~2,875 chars)', () => {
    const story = '在地球的某一个角落，孤零零地开着一朵美丽的小花。'.repeat(80); // 约 2400 字
    const chunks = chunkText(story);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(story);
    // 每块都要明显低于上游上限。
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1500);
  });

  it('returns an empty array for empty input', () => {
    expect(chunkText('')).toHaveLength(0);
  });
});

describe('GET /api/stories/:id/audio', () => {
  it('404s for an unknown story', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories/99999999/audio' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('refuses to serve audio for a draft (content-safety gate)', async () => {
    // 音频是正文的完整朗读版；如果匿名能取草稿音频，就等于绕过了
    // status='published' 这道闸，既泄露未审内容，也让 00-research P1 的
    // 「怪谈/恐怖不下发给孩子」失效。
    const draft = await db.story.create({
      data: { title: '未发布的草稿', status: 'draft' },
    });
    await db.storyContent.create({ data: { storyId: draft.id, content: '这段内容不该被合成。' } });

    const res = await app.inject({ method: 'GET', url: `/api/stories/${draft.id}/audio` });
    expect(res.statusCode).toBe(404);
    // 并且不能留下缓存索引（否则后续直接读到文件）。
    expect(await db.audioCache.findUnique({ where: { storyId: draft.id } })).toBeNull();
  });

  it('refuses to serve audio while a story is in review', async () => {
    const review = await db.story.create({
      data: { title: '待审核的故事', status: 'review' },
    });
    await db.storyContent.create({ data: { storyId: review.id, content: '待审内容。' } });

    const res = await app.inject({ method: 'GET', url: `/api/stories/${review.id}/audio` });
    expect(res.statusCode).toBe(404);
    expect(await db.audioCache.findUnique({ where: { storyId: review.id } })).toBeNull();
  });

  it('backfills duration_sec so the list API can show a real duration', async () => {
    // 这条覆盖一个真实出现过的偏差：批量回填脚本一度只写 app.audio_cache、
    // 没有回填 story_main，于是缓存里全有、列表页却仍显示「音频生成中」。
    // 回填逻辑现在下沉在 getOrCreateAudio 里，接口和脚本共用。
    const story = await db.story.create({
      data: { title: '待回填时长的故事', status: 'published' },
    });
    await db.storyContent.create({ data: { storyId: story.id, content: '一段用来合成的话。' } });
    expect((await db.story.findUnique({ where: { id: story.id } }))?.durationSec).toBe(0);

    await backfillStory(db, story.id, 123);

    const after = await db.story.findUnique({ where: { id: story.id } });
    expect(after?.durationSec).toBe(123);
    expect(after?.audioUrl).toBe(`/api/stories/${story.id}/audio`);
  });

  it('backfillStory ignores a non-positive duration instead of zeroing a good value', async () => {
    const story = await db.story.create({
      data: { title: '时长已知的故事', status: 'published', durationSec: 200 },
    });
    await backfillStory(db, story.id, 0);
    expect((await db.story.findUnique({ where: { id: story.id } }))?.durationSec).toBe(200);
  });

  it('never synthesises for a story with no body text', async () => {
    const blank = await db.story.create({
      data: { title: '没有正文的故事', status: 'published' },
    });
    await db.storyContent.create({ data: { storyId: blank.id, content: '' } });

    const res = await app.inject({ method: 'GET', url: `/api/stories/${blank.id}/audio` });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('TTS_UNAVAILABLE');
    expect(res.json().error.message).toContain('没有正文');
  });
});
