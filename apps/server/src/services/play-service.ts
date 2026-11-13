import type { Db } from '../db.js';
import { AppError } from '../contract.js';

/** 02-architecture §3.3 progress reporting / resume playback. */
export async function upsertProgress(
  db: Db,
  input: { accountId: string; storyId: number; positionSec: number },
): Promise<{ storyId: number; positionSec: number; updatedAt: Date }> {
  const story = await db.story.findUnique({ where: { id: input.storyId }, select: { id: true } });
  if (!story) throw AppError.notFound('故事不存在');

  const positionSec = Math.max(0, Math.trunc(input.positionSec));
  const row = await db.progress.upsert({
    where: { accountId_storyId: { accountId: input.accountId, storyId: input.storyId } },
    create: { accountId: input.accountId, storyId: input.storyId, positionSec },
    update: { positionSec },
    select: { storyId: true, positionSec: true, updatedAt: true },
  });
  return row;
}

/** Resume list ("继续听"), newest first, joined with story metadata. */
export async function listProgress(db: Db, accountId: string, take = 20) {
  const rows = await db.progress.findMany({
    where: { accountId },
    orderBy: { updatedAt: 'desc' },
    take,
    select: {
      storyId: true,
      positionSec: true,
      updatedAt: true,
      story: {
        select: { id: true, title: true, coverUrl: true, durationSec: true, ageBand: true },
      },
    },
  });
  return rows;
}

/** 02-architecture §3.3 favorites. */
export async function addFavorite(db: Db, accountId: string, storyId: number) {
  const story = await db.story.findUnique({ where: { id: storyId }, select: { id: true } });
  if (!story) throw AppError.notFound('故事不存在');

  await db.favorite.upsert({
    where: { accountId_storyId: { accountId, storyId } },
    create: { accountId, storyId },
    update: {},
  });
  return { storyId, favorited: true };
}

export async function removeFavorite(db: Db, accountId: string, storyId: number) {
  await db.favorite.deleteMany({ where: { accountId, storyId } });
  return { storyId, favorited: false };
}

export async function listFavorites(db: Db, accountId: string, take = 50) {
  return db.favorite.findMany({
    where: { accountId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      storyId: true,
      createdAt: true,
      story: { select: { id: true, title: true, coverUrl: true, durationSec: true, ageBand: true } },
    },
  });
}

/** 02-architecture §3.3 play events — the data source for 「今晚听什么」. */
export async function recordPlayEvent(
  db: Db,
  input: {
    accountId: string | null;
    childId?: string | null;
    storyId: number;
    event: 'start' | 'pause' | 'complete' | 'stop';
    positionSec?: number;
  },
) {
  const story = await db.story.findUnique({ where: { id: input.storyId }, select: { id: true } });
  if (!story) throw AppError.notFound('故事不存在');

  return db.playEvent.create({
    data: {
      accountId: input.accountId,
      childId: input.childId ?? null,
      storyId: input.storyId,
      event: input.event,
      positionSec: Math.max(0, Math.trunc(input.positionSec ?? 0)),
    },
    select: { id: true, storyId: true, event: true, at: true },
  });
}
