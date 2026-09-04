#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, 'js/edge-tts.js'), 'utf8');

function createHarness() {
  const audios = [];
  let objectUrlId = 0;

  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
      this.paused = true;
      this.onended = null;
      this.onerror = null;
      audios.push(this);
    }
    async play() {
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
  }

  const document = {
    readyState: 'loading',
    body: { appendChild() {} },
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    createElement() {
      return { firstElementChild: null, innerHTML: '', className: '', addEventListener() {} };
    },
  };

  const context = {
    window: {},
    document,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: async url => {
      if (String(url).includes('/apps/endpoint')) {
        return { ok: true, status: 200, json: async () => ({ t: 'test-token', r: 'test-region' }) };
      }
      return { ok: true, status: 200, blob: async () => new Blob(['fake-mp3']) };
    },
    Audio: FakeAudio,
    URL: {
      createObjectURL() { objectUrlId += 1; return `blob:test-${objectUrlId}`; },
      revokeObjectURL() {},
    },
    Blob,
    TextEncoder,
    crypto: webcrypto,
    atob,
    btoa,
    showToast() {},
    console,
    setTimeout,
    clearTimeout,
    setInterval() { return 1; },
    clearInterval() {},
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'edge-tts.js' });
  return { edge: context.window.EdgeTTS, audios };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function testNaturalCompletion() {
  const { edge } = createHarness();
  let started = 0;
  let completed = 0;
  edge.start('自然完成', {
    onStarted: () => { started += 1; },
    onComplete: () => { completed += 1; },
  });
  await waitFor(() => edge._state.playing, 'full playback must start');
  assert.equal(started, 1, 'full playback must emit started once after audio.play resolves');
  edge._state.currentAudio.onended();
  await waitFor(() => !edge._state.playing, 'full playback must finish');
  assert.equal(completed, 1, 'natural error-free full playback must emit complete once');
}

async function testStopDoesNotComplete() {
  const { edge } = createHarness();
  let started = 0;
  let completed = 0;
  edge.start('主动停止', {
    onStarted: () => { started += 1; },
    onComplete: () => { completed += 1; },
  });
  await waitFor(() => edge._state.playing, 'stoppable playback must start');
  const oldAudio = edge._state.currentAudio;
  edge.stop();
  if (oldAudio.onended) oldAudio.onended();
  assert.equal(started, 1);
  assert.equal(completed, 0, 'stop must not emit complete');
}

async function testParagraphDoesNotComplete() {
  const { edge } = createHarness();
  let started = 0;
  let completed = 0;
  edge._state.segments = ['单段播放'];
  await edge.playParagraph(0, {
    onStarted: () => { started += 1; },
    onComplete: () => { completed += 1; },
  });
  assert.equal(started, 1, 'paragraph playback must emit started after audio.play resolves');
  edge._state.currentAudio.onended();
  assert.equal(completed, 0, 'paragraph playback must never emit full-text complete');
}

async function testMediaErrorDoesNotComplete() {
  const { edge } = createHarness();
  let started = 0;
  let completed = 0;
  edge.start('媒体错误', {
    onStarted: () => { started += 1; },
    onComplete: () => { completed += 1; },
  });
  await waitFor(() => edge._state.playing, 'error scenario playback must start');
  edge._state.currentAudio.onerror(new Error('decode failed'));
  await waitFor(() => !edge._state.playing, 'error scenario must terminate');
  assert.equal(started, 1);
  assert.equal(completed, 0, 'media errors must disqualify complete');
}

(async () => {
  await testNaturalCompletion();
  await testStopDoesNotComplete();
  await testParagraphDoesNotComplete();
  await testMediaErrorDoesNotComplete();
  console.log('PASS: EdgeTTS analytics lifecycle contract');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
