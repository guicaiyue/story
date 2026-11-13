import { z } from 'zod';

/**
 * Single source of truth for M1 config.
 *
 * DATABASE_URL has no default: this project reads the real production `story`
 * database (03-decisions D1), so a misconfigured env must fail loudly rather
 * than silently target the wrong host.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see README)'),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-32chars'),
  // 03-decisions D4: fixed code placeholder, no real SMS in M1.
  FIXED_SMS_CODE: z.string().min(4).default('123456'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${detail}`);
  }
  return parsed.data;
}
