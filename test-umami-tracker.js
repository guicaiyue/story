#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const expectedSrc = 'https://umami.xirizhi.cn/script.js';
const expectedWebsiteId = '811252f0-0559-4036-b8a7-911c516e0f73';

const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
const umamiTags = scriptTags.filter(tag => /umami/i.test(tag));

assert.equal(umamiTags.length, 1, 'index.html must contain exactly one Umami tracker');
const tracker = umamiTags[0];
assert.match(tracker, /\bdefer\b/i, 'Umami tracker must not block page rendering');
assert.match(
  tracker,
  new RegExp(`\\bsrc=["']${expectedSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i'),
  'tracker must load from the self-hosted Umami instance',
);
assert.match(
  tracker,
  new RegExp(`\\bdata-website-id=["']${expectedWebsiteId}["']`, 'i'),
  'tracker must use the registered Story website ID',
);
assert.doesNotMatch(html, /cloud\.umami\.is/i, 'legacy Umami Cloud tracker must be removed');
assert.doesNotMatch(html, /9ff3dec1-fc8a-41cd-8de1-84e40212d86b/i, 'legacy website ID must be removed');

console.log('PASS: self-hosted Umami tracker contract');
