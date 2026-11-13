import type { Db } from '../db.js';
import { AppError } from '../contract.js';

/** 02-architecture §3.2 child profiles. */
export async function listChildren(db: Db, accountId: string) {
  return db.child.findMany({
    where: { accountId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, nickname: true, birthday: true, ageBand: true, avatar: true, createdAt: true },
  });
}

export async function createChild(
  db: Db,
  accountId: string,
  input: { nickname: string; birthday?: Date | null; ageBand?: string; avatar?: string | null },
) {
  return db.child.create({
    data: {
      accountId,
      nickname: input.nickname,
      birthday: input.birthday ?? null,
      ageBand: input.ageBand ?? '3-6',
      avatar: input.avatar ?? null,
    },
    select: { id: true, nickname: true, birthday: true, ageBand: true, avatar: true, createdAt: true },
  });
}

export async function updateChild(
  db: Db,
  accountId: string,
  childId: string,
  input: { nickname?: string; birthday?: Date | null; ageBand?: string; avatar?: string | null },
) {
  // Scoped by accountId so one family can never touch another family's child.
  const existing = await db.child.findFirst({
    where: { id: childId, accountId },
    select: { id: true },
  });
  if (!existing) throw AppError.notFound('儿童档案不存在');

  return db.child.update({
    where: { id: childId },
    data: {
      ...(input.nickname === undefined ? {} : { nickname: input.nickname }),
      ...(input.birthday === undefined ? {} : { birthday: input.birthday }),
      ...(input.ageBand === undefined ? {} : { ageBand: input.ageBand }),
      ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
    },
    select: { id: true, nickname: true, birthday: true, ageBand: true, avatar: true, createdAt: true },
  });
}

/** 02-architecture §3.3 settings: sleep timer, daily limit, parent gate. */
export async function getSetting(db: Db, accountId: string) {
  return db.setting.upsert({
    where: { accountId },
    create: { accountId },
    update: {},
    select: {
      dailyLimitMin: true,
      sleepTimerMin: true,
      ageFilter: true,
      parentGate: true,
    },
  });
}

export async function updateSetting(
  db: Db,
  accountId: string,
  input: { dailyLimitMin?: number; sleepTimerMin?: number; ageFilter?: string; parentGate?: boolean },
) {
  return db.setting.upsert({
    where: { accountId },
    create: { accountId, ...input },
    update: input,
    select: {
      dailyLimitMin: true,
      sleepTimerMin: true,
      ageFilter: true,
      parentGate: true,
    },
  });
}

/** 02-architecture §4.1 `GET/PUT /api/me`. */
export async function getMe(db: Db, accountId: string) {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      phone: true,
      nickname: true,
      role: true,
      createdAt: true,
      family: { select: { id: true, name: true } },
      children: { select: { id: true, nickname: true, ageBand: true } },
    },
  });
  if (!account) throw AppError.notFound('账号不存在');
  return account;
}
