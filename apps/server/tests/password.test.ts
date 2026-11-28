import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { hashPassword, verifyPassword, isPasswordHash } from '../src/services/password.js';

describe('运营后台密码哈希（scrypt）', () => {
  it('哈希后能用同一口令校验通过', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(isPasswordHash(stored)).toBe(true);
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
  });

  it('不把明文放进哈希', async () => {
    const stored = await hashPassword('do-not-leak-me');
    expect(stored).not.toContain('do-not-leak-me');
    expect(stored.startsWith('scrypt$')).toBe(true);
  });

  it('错误口令返回 false', async () => {
    const stored = await hashPassword('right-password');
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false);
  });

  it('每次用不同 salt，同一口令的哈希不同', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    await expect(verifyPassword('same-password', a)).resolves.toBe(true);
    await expect(verifyPassword('same-password', b)).resolves.toBe(true);
  });

  it('坏格式返回 false，不抛异常', async () => {
    for (const bad of ['', 'plain-text', 'scrypt$1$2$3', 'bcrypt$1$2$3$4$5', 'scrypt$0$8$1$c2FsdA$aGFzaA']) {
      await expect(verifyPassword('whatever', bad)).resolves.toBe(false);
    }
  });

  it('脚本生成的哈希与 TS 校验器兼容（防两边格式漂移）', async () => {
    const script = join(import.meta.dirname, '..', 'scripts', 'hash-password.mjs');
    const stored = execFileSync(process.execPath, [script, 'script-generated-password'], { encoding: 'utf8' }).trim();
    expect(isPasswordHash(stored)).toBe(true);
    await expect(verifyPassword('script-generated-password', stored)).resolves.toBe(true);
    await expect(verifyPassword('not-it', stored)).resolves.toBe(false);
  });
});
