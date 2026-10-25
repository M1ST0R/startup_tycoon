'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeState } = require('../gamestate');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const compactUI = fs.readFileSync(path.join(root, 'compact-ui.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

function baseSave(overrides = {}) {
  return {
    v: 1, difficulty: 'medium', money: 5000, rep: 0, product: 0, customers: 0,
    day: 1, hour: 9, speed: 1, desks: 4, nextId: 1, won: false, selected: null,
    employees: [], candidates: [], log: [], ...overrides
  };
}

test('tutorial modal exposes navigation, skip, finish, progress and an adaptive spotlight', () => {
  assert.match(html, /id="tutorialCard"[^>]*role="dialog"[^>]*aria-modal="true"/);
  for (const id of ['tutorialBack', 'tutorialNext', 'tutorialSkip', 'tutorialFinish', 'tutorialStepCount', 'tutorialSpotlight']) {
    assert.ok(html.includes(`id="${id}"`), `missing tutorial element: ${id}`);
  }
  assert.match(css, /\.tutorial-shade-rect\s*\{[^}]*position:fixed/s);
  assert.match(css, /\.tutorial-card\.at-top/);
  assert.match(css, /@media\(max-width:650px\)[\s\S]*?\.tutorial-actions/);
});

test('new campaigns can auto-open the tutorial; menu button allows replay without resetting state', () => {
  assert.match(script, /if \(!S\.tutorialSeen\) requestAnimationFrame\(\(\) => startTutorial\(\)\)/);
  assert.match(compactUI, /control\('Обучение', 'tutorial', ''\)/);
  assert.match(compactUI, /case 'tutorial': d\.startTutorial\(\); return;/);
  assert.match(script, /S\.tutorialSeen = true;[\s\S]*?API\.dirty = true;[\s\S]*?scheduleSave\(\)/);
  assert.match(script, /dialogPause\(true\)/);
  assert.match(script, /closeTutorial\(true\)/);
  assert.doesNotMatch(script, /closeTutorial\([^)]*\)[\s\S]{0,160}fresh\(/);
});

test('tutorial completion flag is retained per save and legacy saves default to already seen', () => {
  const newProfile = normalizeState(baseSave({ tutorialSeen: false }));
  const completedProfile = normalizeState(baseSave({ tutorialSeen: true }));
  const legacyProfile = normalizeState(baseSave());
  assert.equal(newProfile.tutorialSeen, false);
  assert.equal(completedProfile.tutorialSeen, true);
  assert.equal(legacyProfile.tutorialSeen, true);
  assert.equal(legacyProfile.money, 5000, 'migration must not reset saved cash');
  assert.equal(legacyProfile.day, 1, 'migration must not reset campaign time');
});

test('README documents auto tutorial, replay path, old-save behavior and account persistence', () => {
  assert.match(readme, /Первое обучение/);
  assert.match(readme, /Меню → Обучение/);
  assert.match(readme, /tutorialSeen/);
  assert.match(readme, /старых кампаний/);
});
