#!/usr/bin/env node
/**
 * 生成运营后台密码哈希（与 src/services/password.ts 完全同一格式）。
 *
 * 为什么单独一个 .mjs：seed-dev-admin.mjs / set-admin-password.mjs 都是
 * 直接 `node` 跑的脚本，不能 import TypeScript。格式只有这一份，
 * tests/password.test.ts 会拿 CLI 输出交给 TS 侧的 verifyPassword 校验，
 * 防止两边漂移。
 *
 * 用法：node scripts/hash-password.mjs 'plain-password'
 */
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const N = 16384;
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

function derive(password, salt, keylen) {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** @param {string} plain @returns {Promise<string>} */
export async function hashPassword(plain) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(plain, salt, KEY_BYTES);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plain = process.argv[2];
  if (!plain) {
    console.error("usage: node scripts/hash-password.mjs 'plain-password'");
    process.exit(2);
  }
  console.log(await hashPassword(plain));
}
