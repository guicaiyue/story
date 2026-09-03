#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const calls = [];
const context = {
  window: { STORY_API_URL: 'http://test/story/public/' },
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  console,
  fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => [{ id: 3 }] };
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/prest-client.js', 'utf8'), context);

(async () => {
  const result = await context.window.prestClient.fetchData('story_main', {
    columns: 'id,title',
    filter: { category_id: 1 },
    filterLike: { title: '老鼠' },
    orderBy: { column: 'id', ascending: false },
    pagination: { page: 2, pageSize: 50 }
  });
  assert.deepEqual(result.data, [{ id: 3 }]);
  assert.equal(result.error, null);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/story/public/story_main');
  assert.equal(url.searchParams.get('_select'), 'id,title');
  assert.equal(url.searchParams.get('category_id'), '1');
  assert.equal(url.searchParams.get('title'), '$ilike.%老鼠%');
  assert.equal(url.searchParams.get('_order'), '-id');
  assert.equal(url.searchParams.get('_page'), '2');
  assert.equal(url.searchParams.get('_page_size'), '50');
  assert.equal(calls[0].options.headers.Accept, 'application/json');
  console.log('PASS: pREST client parameter contract');
})().catch(error => { console.error(error); process.exit(1); });
