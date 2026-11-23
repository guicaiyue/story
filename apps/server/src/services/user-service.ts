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

/**
 * 把手机号绑到当前账号（外部端「补充账号信息」）。
 *
 * 只做「空号 → 绑定」这一种情形：手机号已被别的账号占用时返回 409，让用户
 * 改用手机号登录。游客数据合并的规则（03-decisions D6）仍未定，这一步不引入
 * 合并语义，避免出现「绑完之后进度归谁」的模糊地带。
 *
 * 游客账号没有 family / setting（`loginAsGuest` 不建），绑定成功后顺手补齐，
 * 否则后台的「家庭 / 儿童」统计永远是 0。
 */
export async function bindPhone(
  db: Db,
  accountId: string,
  input: { phone: string; code: string },
  expectedCode: string,
) {
  if (input.code !== expectedCode) throw AppError.unauthorized('验证码错误');

  const owner = await db.account.findUnique({
    where: { phone: input.phone },
    select: { id: true },
  });
  if (owner && owner.id !== accountId) {
    throw AppError.conflict('该手机号已绑定其他账号，请改用手机号登录');
  }

  try {
    await db.account.update({ where: { id: accountId }, data: { phone: input.phone } });
  } catch (error) {
    // 并发绑定同一手机号时唯一索引会先于上面的检查抛 P2002，这里统一成 409，
    // 不要让客户端看到 500。
    if ((error as { code?: string }).code === 'P2002') {
      throw AppError.conflict('该手机号已绑定其他账号，请改用手机号登录');
    }
    throw error;
  }

  const family = await db.family.findUnique({ where: { accountId }, select: { id: true } });
  if (!family) await db.family.create({ data: { accountId } });
  const setting = await db.setting.findUnique({ where: { accountId }, select: { id: true } });
  if (!setting) await db.setting.create({ data: { accountId } });

  return getMe(db, accountId);
}
