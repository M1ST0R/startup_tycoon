const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('campaign setup has a centered Start button that remains outside the scroll area', () => {
  const html = read('index.html');
  const overlay = read('overlay-ui.js');
  const script = read('script.js');
  assert.match(html, /data-act="start-difficulty">Начать<\/button>/);
  assert.match(script, /textContent = difficultyResetMode \? 'Начать новую кампанию' : 'Начать'/);
  assert.match(overlay, /const actions = difficulty\.querySelector\('\.difficulty-actions'\)/);
  assert.match(overlay, /if \(child !== actions\) difficultyBody\.append\(child\)/);
  assert.match(overlay, /difficulty\.insertBefore\(difficultyBody, actions\)/);
  assert.doesNotMatch(overlay, /createPager\(detailsBody, \(\) => \[details\]/);
  assert.match(overlay, /\.difficulty-card>\.difficulty-actions\{[^}]*justify-content:center/);
  assert.match(overlay, /\.cu-difficulty-scroll\{[^}]*overflow-y:auto/);
});

test('cache versions are bumped for the start-screen fix', () => {
  const html = read('index.html');
  assert.match(html, /overlay-ui\.js\?v=campaign-start-1/);
  assert.match(html, /script\.js\?v=campaign-start-1/);
});
