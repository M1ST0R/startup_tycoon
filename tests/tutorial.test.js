'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeState } = require('../gamestate');
const StartupSystem = require('../startup-system');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const compactUI = fs.readFileSync(path.join(root, 'compact-ui.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

function baseSave(overrides = {}) {
  return {
    v: 1, difficulty: 'medium', startupType: 'webService', startupStage: 0, startupProgress: 0,
    money: 5000, rep: 0, product: 4, customers: 2,
    day: 1, hour: 9, speed: 1, desks: 4, nextId: 1, won: false, selected: null,
    employees: [], candidates: [], log: [], tutorialSeen: false, ...overrides
  };
}

test('tutorial modal exposes navigation, skip, finish, progress and adaptive spotlight', () => {
  assert.match(html, /id="tutorialCard"[^>]*role="dialog"[^>]*aria-modal="true"/);
  for (const id of ['tutorialBack', 'tutorialNext', 'tutorialSkip', 'tutorialFinish', 'tutorialStepCount', 'tutorialSpotlight']) {
    assert.ok(html.includes(`id="${id}"`), `missing tutorial element: ${id}`);
  }
  assert.match(css, /\.tutorial-shade-rect\s*\{[^}]*position:fixed/s);
  assert.match(css, /\.tutorial-card\.at-top/);
  assert.match(css, /@media\(max-width:650px\)[\s\S]*?\.tutorial-actions/);
});

test('the only tutorial explains startup type, internal work, stages, product revenue, and expenses', () => {
  const steps = script.match(/const TUTORIAL_STEPS = Object\.freeze\(\[([\s\S]*?)\n\]\);/);
  assert.ok(steps, 'existing tutorial step list exists');
  assert.equal((steps[1].match(/title:/g) || []).length, 6, 'tutorial stays short');
  for (const topic of ['тип стартапа', 'внутреннюю задачу', 'этап', 'доход', 'зарплаты']) {
    assert.ok(steps[1].toLowerCase().includes(topic), `tutorial should explain ${topic}`);
  }
  assert.doesNotMatch(steps[1], /оплата за заказ|создай первый проект|дедлайн|выплату за завершение всех этапов/i);
  assert.match(steps[1], /data-value=\\?"startup/);
});

test('a new profile auto-opens once; replay is available in Menu without starting a new campaign', () => {
  assert.match(script, /if \(!S\.tutorialSeen\) requestAnimationFrame\(\(\) => startTutorial\(\)\)/);
  assert.match(script, /if \(r === 'ok' && S && !S\.tutorialSeen\) requestAnimationFrame\(\(\) => startTutorial\(\)\)/, 'unfinished tutorial resumes after reloading a saved profile');
  assert.match(compactUI, /control\('Обучение', 'tutorial', ''\)/);
  assert.match(compactUI, /case 'tutorial': d\.startTutorial\(\); return;/);
  assert.match(script, /const tutorialAlreadySeen = !!\(S && S\.tutorialSeen\)/);
  assert.match(script, /S\.tutorialSeen = tutorialAlreadySeen/);
  assert.match(script, /S\.tutorialSeen = true;[\s\S]*?API\.dirty = true;[\s\S]*?scheduleSave\(\)/);
  assert.match(script, /dialogPause\(true\)/);
  assert.match(script, /closeTutorial\(true\)/);
  assert.doesNotMatch(compactUI, /case 'tutorial':[\s\S]{0,120}fresh\(/);
});

test('completion flag and startup type persist; old profiles safely receive defaults', () => {
  const newProfile = normalizeState(baseSave({ tutorialSeen: false }));
  const completedProfile = normalizeState(baseSave({ tutorialSeen: true, startupType: 'saas', startupStage: 2 }));
  const legacyProfile = normalizeState(baseSave({ startupType: undefined, startupStage: undefined, startupProgress: undefined, tutorialSeen: undefined, money: 4200, day: 12 }));
  assert.equal(newProfile.tutorialSeen, false);
  assert.equal(completedProfile.tutorialSeen, true);
  assert.equal(completedProfile.startupType, 'saas');
  assert.equal(completedProfile.startupStage, 2);
  assert.equal(legacyProfile.tutorialSeen, true);
  assert.equal(legacyProfile.startupType, StartupSystem.BALANCE.defaultType);
  assert.equal(legacyProfile.money, 4200, 'migration must not reset saved cash');
  assert.equal(legacyProfile.day, 12, 'migration must not reset campaign time');
});

test('README explains once-per-account tutorial behavior and replay path', () => {
  assert.match(readme, /Первое обучение/);
  assert.match(readme, /Меню → Обучение/);
  assert.match(readme, /tutorialSeen/);
  assert.match(readme, /Старые сохранения без поля `tutorialSeen`/);
});
