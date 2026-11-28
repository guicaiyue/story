import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/**
 * 运营后台密码哈希（scrypt，node:crypto，无第三方依赖）。
 *
 * 存储格式：`scrypt$N$r$p$<salt base64url>$<hash base64url>`。
 * 参数写进字符串里，将来调参不会让旧口令全部失效 —— verify 用存储里的参数。
 *
 * 为什么不用 bcrypt/argon2：这两个都要额外原生依赖，alpine 镜像里编译/下载
 * 二进制会多一层风险；scrypt 是 Node 标准库自带、足够慢的密码 KDF。
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** 上限防止一条被篡改的哈希把进程拖死（正常路径只会有上面那组参数）。 */
const MAX_N = 1 << 20;
const MAX_R = 16;
const MAX_P = 16;

function derive(password: string, salt: Buffer, keylen: number, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(plain, salt, KEY_BYTES, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/**
 * 校验口令。哈希格式坏掉/参数越界时返回 false，不抛异常 —— 调用方统一按
 * 「账号或密码错误」处理，避免把内部格式问题泄露成 500。
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0) return false;
  if (!Number.isInteger(r) || r < 1 || r > MAX_R) return false;
  if (!Number.isInteger(p) || p < 1 || p > MAX_P) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? '', 'base64url');
    expected = Buffer.from(parts[5] ?? '', 'base64url');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await derive(plain, salt, expected.length, N, r, p);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * 账号不存在时也跑一次同参数的哈希校验，避免靠响应时间区分账号是否存在。
 * 这是固定盐 + 固定假口令的哈希，不对应任何真实账号。
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** 判断一个哈希是不是本模块接受的格式（运维脚本/测试用，不参与鉴权）。 */
export function isPasswordHash(value: string): boolean {
  return /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(value);
}
