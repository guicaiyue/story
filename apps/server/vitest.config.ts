import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export default defineConfig({
  // Source files import each other with `.js` specifiers, which is correct for
  // Node ESM output but would not resolve to the .ts sources under Vitest.
  // This plugin rewrites the extension before Vite's resolver sees it.
  plugins: [
    {
      name: 'resolve-ts-from-js-specifier',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;

        const abs = resolve(dirname(importer), source);
        const candidates = [abs.replace(/\.js$/, '.ts'), resolve(abs, 'index.ts')];
        const hit = candidates.find((c) => existsSync(c));
        return hit ? { id: hit } : null;
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests share one Postgres database and truncate it between
    // files, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
