#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const timers = [];
const window = {
  setInterval(callback) {
    timers.push(callback);
    return timers.length;
  },
  clearInterval() {},
};
const context = {
  window,
  console,
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, 'js/story-analytics.js'), 'utf8'),
  context,
  { filename: 'story-analytics.js' },
);

const analytics = context.window.StoryAnalytics;
assert.ok(analytics, 'StoryAnalytics must be exported');

const story = { id: 42, title: '测试故事', category_name: '童话' };
assert.equal(analytics.trackStory('story_open', story, 'card', { ignored: undefined }), false);
assert.equal(analytics._pending.length, 1, 'event must queue before Umami SDK is ready');
assert.equal(timers.length, 1, 'queue must schedule one retry timer');

const calls = [];
context.window.umami = {
  track(name, data) {
    calls.push({ name, data: { ...data } });
  },
};
timers.shift()();
assert.deepEqual(calls, [{
  name: 'story_open',
  data: {
    story_id: '42',
    title: '测试故事',
    category: '童话',
    source: 'card',
  },
}]);
assert.equal(analytics._pending.length, 0, 'queue must drain after SDK becomes ready');

analytics.trackStory('tts_paragraph', story, 'detail', {
  paragraph_index: 3,
  empty: '',
  nil: null,
});
assert.deepEqual(calls[1], {
  name: 'tts_paragraph',
  data: {
    story_id: '42',
    title: '测试故事',
    category: '童话',
    source: 'detail',
    paragraph_index: 3,
  },
});
assert.equal(analytics.trackStory('tts_play', null, 'detail'), false);
assert.equal(analytics.trackStory('tts_play', {}, 'detail'), false);
assert.equal(calls.length, 2, 'invalid stories must not emit events');

console.log('PASS: StoryAnalytics queue and story event contract');
