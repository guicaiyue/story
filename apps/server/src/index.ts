import { loadDotEnv } from './load-env.mjs';
import { loadEnv } from './env.js';
import { createPrisma } from './db.js';
import { buildApp } from './app.js';

// Must run before loadEnv() reads process.env.
loadDotEnv();

const env = loadEnv();
const db = createPrisma(env.DATABASE_URL);

const app = await buildApp({
  db,
  jwtSecret: env.JWT_SECRET,
  fixedSmsCode: env.FIXED_SMS_CODE,
  logger: { level: env.LOG_LEVEL },
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info(`小故事铺 M1 API listening on http://${env.HOST}:${env.PORT} (health: /api/health)`);
} catch (err) {
  app.log.error({ err }, 'failed to start');
  await db.$disconnect();
  process.exit(1);
}
