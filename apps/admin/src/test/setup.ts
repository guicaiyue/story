import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Ant Design 依赖 matchMedia / ResizeObserver，jsdom 未实现。
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

// jsdom 没有实现 getComputedStyle 的部分用法，Ant Design 的 Table 会用到。
window.scrollTo = vi.fn();

// Node ≥ 24 自带一个 `globalThis.localStorage` 全局：没给 `--localstorage-file`
// 时它的值是 `undefined`。vitest 的 jsdom 环境建好后把全局当 window 用，而这个键
// 已经存在（值 undefined），jsdom 的 Storage 实现被丢掉 —— `window.localStorage`
// 和裸 `localStorage` 一起变成 undefined。Node 22（CI 与 preflight 用的版本）
// 没有这个键，所以只有本机 node 24/26 上 63 个用例全红，报
// `Cannot read properties of undefined (reading 'setItem')`。
// 用 NODE_OPTIONS / execArgv 传 `--localstorage-file` 也救不了：vitest 起 worker
// 时会重置 execArgv。所以这里兜一个内存版 Storage（jsdom 正常提供时不生效）。
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get length(): number {
      return this.store.size;
    }
    clear(): void {
      this.store.clear();
    }
    getItem(key: string): string | null {
      return this.store.has(key) ? (this.store.get(key) as string) : null;
    }
    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null;
    }
    removeItem(key: string): void {
      this.store.delete(key);
    }
    setItem(key: string, value: string): void {
      this.store.set(key, String(value));
    }
  }
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: new MemoryStorage(),
    });
  }
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
