/**
 * Minimal `.env` loader, in plain JS so both the TypeScript entry points and the
 * plain-node migration script can use it without a build step.
 *
 * Node's `--env-file` flag is not used because tsx/vitest/prisma are shell
 * wrappers, not JS entry points. Existing environment variables always win, so
 * `DATABASE_URL=... pnpm test` still overrides the file (as CI expects).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

export function loadDotEnv(file = '.env') {
  if (loaded) return;
  loaded = true;

  let raw;
  try {
    raw = readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch {
    return; // No .env is fine: CI and containers pass real env vars.
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}
