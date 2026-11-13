import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { parseBuffer } from 'music-metadata';
import type { Db } from '../db.js';

/**
 * 服务端 TTS 合成 + 缓存（所有者决策 c-mw99xnkq-2ehou）。
 *
 * 设计要点：
 *  - 音频**不落 Postgres**：MP3 存磁盘（AUDIO_CACHE_DIR），库里只存索引与
 *    真实时长。理由是这个库还要给 pREST 读，不该塞大 blob。
 *  - 时长从**合成出来的 MP3 本身**量，不用正文字数估算 ——
 *    `length` 是字数，不是时长（02-architecture §3.1 明确区分过）。
 *  - 合成结果先写临时文件再 rename，避免并发请求读到半个文件。
 */

/** 默认音色。中文儿童向，语速略慢（见 VOICE_RATE）。 */
export const DEFAULT_VOICE = process.env.TTS_VOICE ?? 'zh-CN-YunxiNeural';

/** 24kHz 48kbps 单声道 MP3：体积小，移动端解码无压力。 */
export const OUTPUT_MIME = 'audio/mpeg';

/**
 * 语速。默认 -10%：睡前内容需要比正常播报更慢。
 * edge-tts 的 rate 用百分比字符串。
 */
const VOICE_RATE = process.env.TTS_RATE ?? '-10%';

const OUTPUT_FORMAT_MP3 = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

/** 缓存目录。相对路径按 apps/server 解析。 */
export function audioCacheDir(): string {
  const dir = process.env.AUDIO_CACHE_DIR ?? '.audio-cache';
  return resolve(process.cwd(), dir);
}

export interface AudioAsset {
  storyId: number;
  /** 相对缓存目录的路径，便于整体搬迁。 */
  filePath: string;
  /** 绝对路径，供读取字节用。 */
  absolutePath: string;
  mimeType: string;
  byteSize: number;
  durationSec: number;
  voice: string;
  charCount: number;
  /** true = 命中缓存，false = 本次新合成。 */
  cached: boolean;
}

/**
 * edge-tts 单次请求的硬上限。
 *
 * 实测：一次请求约 3.6MB（≈600 秒 ≈2,700 字）后上游会截断连接，
 * 报 `Stream closed before the synthesis completed`。
 * 2181 条已发布故事里有 12.4%（270 条）超过这个量，所以必须分块。
 */
const UPSTREAM_BYTE_CAP = 3_600_000;

/** 按实测语速（4.6 字/秒）反推出的安全单块字数，留足余量。 */
const MAX_CHUNK_CHARS = 1_500;

/** 整条故事的正文字数上限，防止一次请求把内存打满。 */
const MAX_CHARS = 60_000;

/**
 * 按句子边界分块。
 *
 * 在句末标点后切，避免把一句话读成两半（音频拼接处会听起来断裂）。
 * 单句超长时退化为按字数硬切，保证不会死循环。
 */
export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const sentences = text.split(/(?<=[。！？!?；;\n])/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (!sentence) continue;
    if (sentence.length > maxChars) {
      // 超长单句：先冲掉已累积的，再按字数硬切。
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if ((current + sentence).length > maxChars && current) {
      chunks.push(current);
      current = '';
    }
    current += sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * 取一条故事的音频，命中缓存则直接用，否则合成并落盘。
 *
 * @param content 故事正文。为空时抛错 —— 没有正文就没有可合成的音频。
 */
export async function getOrCreateAudio(
  db: Db,
  storyId: number,
  content: string,
  opts: { voice?: string; force?: boolean } = {},
): Promise<AudioAsset> {
  const voice = opts.voice ?? DEFAULT_VOICE;
  const text = content.trim();
  if (!text) {
    throw new AudioSynthesisError('该故事没有正文，无法合成音频');
  }
  if (text.length > MAX_CHARS) {
    throw new AudioSynthesisError(`正文过长（${text.length} 字），超过 ${MAX_CHARS} 字上限`);
  }

  // 1) 缓存命中：同一音色且文件还在。
  if (!opts.force) {
    const hit = await db.audioCache.findUnique({ where: { storyId } });
    if (hit && hit.voice === voice) {
      const abs = join(audioCacheDir(), hit.filePath);
      if (await exists(abs)) {
        await db.audioCache.update({
          where: { storyId },
          data: { lastHitAt: new Date(), hitCount: { increment: 1 } },
        });
        // 命中缓存也确保 story_main 已回填（首次合成时可能因故没写成功）。
        await backfillStory(db, storyId, hit.durationSec);
        return {
          storyId,
          filePath: hit.filePath,
          absolutePath: abs,
          mimeType: hit.mimeType,
          byteSize: hit.byteSize,
          durationSec: hit.durationSec,
          voice: hit.voice,
          charCount: hit.charCount,
          cached: true,
        };
      }
      // 索引在但文件丢了（清理/迁移）：删掉索引重新合成。
      await db.audioCache.delete({ where: { storyId } });
    }
  }

  // 2) 合成。
  const dir = audioCacheDir();
  const relDir = join('stories', String(Math.floor(storyId / 1000)));
  const fileName = `${storyId}.mp3`;
  const relPath = join(relDir, fileName);
  const absDir = join(dir, relDir);
  const absPath = join(absDir, fileName);

  await mkdir(absDir, { recursive: true });

  const bytes = await synthesize(text, voice);

  // 先写临时文件再 rename：并发请求不会读到半个文件。
  const tmpPath = `${absPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, absPath);

  const durationSec = await measureDuration(bytes);

  const asset = await db.audioCache.upsert({
    where: { storyId },
    create: {
      storyId,
      filePath: relPath,
      mimeType: OUTPUT_MIME,
      byteSize: bytes.length,
      durationSec,
      voice,
      charCount: text.length,
    },
    update: {
      filePath: relPath,
      mimeType: OUTPUT_MIME,
      byteSize: bytes.length,
      durationSec,
      voice,
      charCount: text.length,
      lastHitAt: new Date(),
      hitCount: 0,
    },
  });

  await backfillStory(db, storyId, asset.durationSec);

  return {
    storyId,
    filePath: asset.filePath,
    absolutePath: absPath,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    durationSec: asset.durationSec,
    voice: asset.voice,
    charCount: asset.charCount,
    cached: false,
  };
}

/**
 * 把真实时长与音频地址回填到 `story_main`，让列表页也能显示时长。
 *
 * 放在这里而不是路由里：接口和批量回填脚本都走 [getOrCreateAudio]，
 * 回填逻辑只写一份，就不会出现「脚本写了缓存但列表仍显示无音频」的偏差。
 */
export async function backfillStory(db: Db, storyId: number, durationSec: number): Promise<void> {
  if (durationSec <= 0) return;
  await db.story.updateMany({
    where: { id: storyId, OR: [{ durationSec: 0 }, { durationSec: { not: durationSec } }] },
    data: { durationSec, audioUrl: `/api/stories/${storyId}/audio` },
  });
}

/**
 * 调 edge-tts 合成，返回完整 MP3 字节。
 *
 * 长文本会分块合成再拼接：上游单次请求约 3.6MB（≈2,700 字）就会截断。
 * MP3 是帧序列，同参数（同采样率/比特率/单声道）的帧直接拼接即可连续播放，
 * 因此这里用 Buffer.concat 而不是转码 —— 也避免了引入 ffmpeg 依赖。
 */
async function synthesize(text: string, voice: string): Promise<Buffer> {
  const parts = chunkText(text);
  const buffers: Buffer[] = [];

  for (const [i, part] of parts.entries()) {
    const chunk = await synthesizeChunk(part, voice);
    // 上限是**单次请求**的上限：块一旦顶到上限就说明它被截断了，
    // 不能悄悄拼接（否则用户会听到突然断掉的音频）。宁可整条失败并说明原因。
    if (chunk.length >= UPSTREAM_BYTE_CAP) {
      throw new AudioSynthesisError(
        `第 ${i + 1}/${parts.length} 段（${part.length} 字）达到上游上限，音频可能被截断`,
      );
    }
    buffers.push(chunk);
    // 块间留一点间隔：连续快速请求会被上游限流，表现为
    // "Stream closed before the synthesis completed"。
    if (i < parts.length - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const buf = Buffer.concat(buffers);
  if (buf.length === 0) {
    throw new AudioSynthesisError('语音合成返回空音频');
  }
  return buf;
}

/**
 * 合成单个分块；上游偶发截断或限流（503）时重试。
 *
 * 503 通常是连续快速请求触发的限流，指数退避后一般能过。
 */
async function synthesizeChunk(text: string, voice: string, attempt = 1): Promise<Buffer> {
  try {
    return await synthesizeChunkOnce(text, voice);
  } catch (e) {
    const attempts = Number(process.env.TTS_CHUNK_RETRIES ?? 4);
    if (attempt >= attempts || !(e instanceof AudioSynthesisError)) throw e;
    // 指数退避：0.8s, 1.6s, 3.2s …
    await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)));
    return synthesizeChunk(text, voice, attempt + 1);
  }
}

/** 合成单个分块（单次尝试）。 */
async function synthesizeChunkOnce(text: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT_MP3);
    const { audioStream } = tts.toStream(text, { rate: VOICE_RATE });

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      // 兜底超时：edge-tts 是外网 WebSocket，不能无限等。
      // 单块上限 1500 字，实测约 30 秒内完成，90 秒足够宽松。
      const timer = setTimeout(
        () => reject(new AudioSynthesisError('语音合成超时（120 秒无响应）')),
        120_000,
      );
      audioStream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      audioStream.on('end', () => {
        clearTimeout(timer);
        resolve();
      });
      audioStream.on('error', (e: Error) => {
        clearTimeout(timer);
        reject(new AudioSynthesisError(`语音合成失败：${e.message}`));
      });
    });

    const buf = Buffer.concat(chunks);
    if (buf.length === 0) {
      throw new AudioSynthesisError('语音合成返回空音频');
    }
    return buf;
  } finally {
    // 释放 WebSocket，否则进程不会退出。
    tts.close();
  }
}

/**
 * 从 MP3 字节量出真实时长。
 *
 * 用 music-metadata 而不是手写帧头解析：手写版在 MPEG2 Layer3 上会把
 * 48kbps 误读成 80kbps（比特率表不同），导致时长偏差 20%。
 */
async function measureDuration(bytes: Buffer): Promise<number> {
  try {
    const md = await parseBuffer(new Uint8Array(bytes), { mimeType: OUTPUT_MIME });
    const seconds = md.format.duration ?? 0;
    // 至少 1 秒，避免下游把它当作「无音频」（durationSec=0 是 M1 的哨兵值）。
    return Math.max(1, Math.round(seconds));
  } catch {
    return 0;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

/** 合成相关的可预期失败（转成 4xx/5xx 由路由决定）。 */
export class AudioSynthesisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioSynthesisError';
  }
}
