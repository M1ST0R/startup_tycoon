'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createFakeDocument } = require('./helpers/fake-dom');

const root = path.join(__dirname, '..');

/** Загружает script.js без обработчиков запуска и открывает функции игры, не зависящие от DOM. */
function game() {
  const context = vm.createContext({ console, setTimeout, clearTimeout, document: createFakeDocument() });
  context.window = context;
  const files = ['employee-config.js', 'crisis.js', 'crisis-flow.js', 'decision-dialog.js', 'name-generator.js',
    'character-art.js', 'office-dialogue.js', 'speech-system.js'];
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf("document.addEventListener('pointerup'")) + `
globalThis.api = { newState, payDay, efficiency, workEmployee, warnings, fmt, rentCost, salaries,
  setState: value => { S = value; }, getState: () => S, hire, sanitize };`, context);
  return context.api;
}

const employee = (id, extra = {}) => ({
  id, name: `Сотрудник ${id}`, role: 'dev', spec: 'Backend', tier: 1, skills: { backend: 5 }, skill: 5, salary: 100,
  speed: 1, energy: 80, mood: 80, task: 'code', progress: 0, status: 'work', desk: id - 1, ...extra
});

function started(money, employees = [employee(1), employee(2)]) {
  const api = game(); const s = api.newState();
  Object.assign(s, { money, employees, flavor: { lastTick: -1000, cooldowns: {}, recent: [] } });
  api.setState(s); return { api, s };
}

test('end of day always charges rent and salaries, even into debt', () => {
  const { api, s } = started(120);
  const costs = api.rentCost() + api.salaries();
  api.payDay();
  assert.equal(s.money, 120 - costs); assert.ok(s.money < 0, 'balance is negative: a common debt');
  assert.ok(s.log.some(entry => /долг/.test(entry.text)));
  const before = s.money; api.payDay();
  assert.equal(s.money, before - costs, 'the debt keeps growing day after day');
});

test('a solvent company simply pays; no debt message', () => {
  const { api, s } = started(10000);
  api.payDay();
  assert.equal(s.money, 10000 - api.rentCost() - api.salaries());
  assert.ok(!s.log.some(l => /долг/.test(l.text)));
});

test('the rescue contract still works for an empty office and can lift the company out of debt', () => {
  const { api, s } = started(-100, []);
  api.payDay();
  assert.equal(s.rescueUsed, true); assert.ok(s.money > 4000);
});

test('debt debuffs reach employees: mood drains with the size of the debt, speed drops after the second day', () => {
  const run = (money, days) => {
    const { api, s } = started(money, [employee(1, { mood: 80, energy: 100 })]);
    s.crisis.days = days;
    const e = s.employees[0], eff = api.efficiency(e, 'code'); api.workEmployee(e);
    return { mood: e.mood, eff };
  };
  const healthy = run(1000, 0), smallDebt = run(-150, 1), bigDebt = run(-1500, 1), long = run(-150, 3);
  assert.ok(smallDebt.mood >= healthy.mood - 1e-9, 'a debt up to $200 does not hurt mood');
  assert.ok(bigDebt.mood < smallDebt.mood - 0.2, 'a large debt does');
  assert.ok(Math.abs(smallDebt.eff - healthy.eff) < 1e-9, 'one day without money does not slow anyone down');
  assert.ok(long.eff < healthy.eff * 0.85, 'several days without money do');
});

test('the employee card warns about a possible resignation once layoffs are active', () => {
  const { api, s } = started(-1000, [employee(1, { tier: 5 })]);
  assert.ok(!api.warnings(s.employees[0]).some(w => /уволиться/.test(w)));
  s.crisis.days = 3;
  assert.ok(api.warnings(s.employees[0]).some(w => /уволиться.*60%/.test(w)));
});

test('money formatting shows debt with a minus sign', () => {
  const api = game();
  assert.equal(api.fmt(1500).replace(/\s/g, ''), '$1500');
  assert.equal(api.fmt(-1500).replace(/\s/g, ''), '−$1500');
  assert.equal(api.fmt(-0.4), '$0'); assert.equal(api.fmt(0), '$0');
});

test('saves keep the debt and the crisis state when loaded by the client', () => {
  const { api } = started(0);
  const loaded = api.sanitize({ money: -777, crisis: { days: 3, stage: 'concealed', sinceQuitRoll: 2, bailouts: 0 },
    gameOver: { reason: 'team_quit', day: 9, customers: 1, rep: 2, product: 3 }, employees: [], candidates: [] });
  assert.equal(loaded.money, -777); assert.equal(loaded.crisis.days, 3); assert.equal(loaded.gameOver.reason, 'team_quit');
  const old = api.sanitize({ money: 100, employees: [], candidates: [] });
  assert.equal(old.crisis.days, 0); assert.equal(old.gameOver, null);
});
