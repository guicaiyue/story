import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { fail } from '../contract.js';
import { getStoryContentForAudio } from '../services/content-service.js';
import { getOrCreateAudio, AudioSynthesisError, DEFAULT_VOICE } from '../services/tts-service.js';

const IdParam = z.object({ id: z.coerce.number().int().positive() });

interface RangeSpec {
  start: number;
  end: number;
}

/**
 * 解析 `Range: bytes=start-end`。
 *
 * just_audio 等播放器会用它做定位与断线续传；不支持 Range 会导致拖动进度条后
 * 从头开始。返回 null 表示「无 Range 或语法不可解析」，按整文件返回。
 */
export function parseRange(header: string | undefined, size: number): RangeSpec | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;

  const [, rawStart, rawEnd] = m;
  let start: number;
  let end: number;

  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // `bytes=-N`：最后 N 字节。
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    // 起点越界 -> 416；终点超出则夹到文件末尾（RFC 9110 允许）。
    if (start >= size) return 'unsatisfiable';
    end = Math.min(end, size - 1);
    if (end < start) return 'unsatisfiable';
  }

  return { start, end };
}

/**
 * 故事音频：按需 TTS 合成 + 磁盘缓存（所有者决策 c-mw99xnkq-2ehou）。
 *
 * 第一次请求合成并缓存，之后直接读文件。支持 Range，以便播放器 seek。
 */
export function registerAudioRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/stories/:id/audio', async (req, reply) => {
    const { id } = IdParam.parse(req.params);

    const found = await getStoryContentForAudio(db, id);
    if (found.kind !== 'ok') {
      // 草稿/待审与不存在返回同样的响应，避免探测未发布内容。
      return reply.code(404).send(fail('NOT_FOUND', '故事不存在或未发布'));
    }
    const content = found.content;

    let asset;
    try {
      asset = await getOrCreateAudio(db, id, content);
    } catch (e) {
      if (e instanceof AudioSynthesisError) {
        // 合成失败是上游/内容问题，不是请求问题。
        req.log.error({ err: e, storyId: id }, 'tts synthesis failed');
        return reply.code(503).send(fail('TTS_UNAVAILABLE', e.message));
      }
      throw e;
    }

    const size = (await stat(asset.absolutePath)).size;
    const range = parseRange(req.headers.range, size);

    if (range === 'unsatisfiable') {
      return reply
        .code(416)
        .header('Content-Range', `bytes */${size}`)
        .send(fail('RANGE_NOT_SATISFIABLE', '请求的字节范围无效'));
    }

    const headers: Record<string, string> = {
      'Content-Type': asset.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
      // 便于排查合成来源与是否命中缓存。
      'X-Audio-Voice': asset.voice || DEFAULT_VOICE,
      'X-Audio-Duration': String(asset.durationSec),
      'X-Audio-Cache': asset.cached ? 'hit' : 'miss',
    };

    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      headers['Content-Length'] = String(range.end - range.start + 1);
      reply.code(206).headers(headers);
      return reply.send(createReadStream(asset.absolutePath, { start: range.start, end: range.end }));
    }

    headers['Content-Length'] = String(size);
    reply.code(200).headers(headers);
    return reply.send(createReadStream(asset.absolutePath));
  });
}
