'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

test('every local script referenced by index.html exists and is allowed by the static server', () => {
  const htmlScripts = [...html.matchAll(/<script\s+[^>]*src=["']([^"']+)["']/gi)]
    .map(match => match[1].split('?')[0])
    .filter(src => !/^(?:https?:)?\/\//i.test(src) && !src.startsWith('/api/'));

  const routeBlock = server.match(/for\s*\(const\s+file\s+of\s*\[([\s\S]*?)\]\)\s*\{\s*app\.get/s);
  assert.ok(routeBlock, 'Could not locate the explicit static JavaScript route list in index.js');
  const served = new Set([...routeBlock[1].matchAll(/["']([^"']+\.(?:js|json|css))["']/g)].map(match => match[1]));

  assert.ok(htmlScripts.length > 0, 'No local script tags were found');
  for (const src of htmlScripts) {
    assert.ok(fs.existsSync(path.join(root, src)), `Referenced script is missing from the project: ${src}`);
    assert.ok(served.has(src), `Script is referenced by index.html but not served by index.js: ${src}`);
  }
});
