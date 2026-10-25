'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeState } = require('../gamestate');
const { BASE } = require('../employee-config');

const base = (extra = {}) => ({
  v: 1, money: 5000, rep: 2, product: 3, customers: 4, day: 3, hour: 12, speed: 1, desks: 4, nextId: 3,
  won: false, selected: null, employees: [], candidates: [], log: [], ...extra
});

test('server accepts a negative balance (company debt) but not an absurd one', () => {
  assert.equal(normalizeState(base({ money: -350.5 })).money, -350.5);
  assert.equal(normalizeState(base({ money: BASE.minMoney })).money, BASE.minMoney);
  for (const money of [BASE.minMoney - 1, -Infinity, NaN, '5', null]) {
    assert.throws(() => normalizeState(base({ money })), /invalid state/, String(money));
  }
});

test('old saves without crisis fields get safe defaults', () => {
  const clean = normalizeState(base());
  assert.deepEqual(clean.crisis, { days: 0, stage: 'none', sinceQuitRoll: 0, bailouts: 0 });
  assert.equal(clean.gameOver, null);
});

test('crisis progress and the game over record survive a save round-trip', () => {
  const input = base({
    money: -900, crisis: { days: 4, stage: 'concealed', sinceQuitRoll: 3, bailouts: 1 },
    gameOver: { reason: 'investor_discovered', day: 21, customers: 40, rep: 33, product: 61 }
  });
  const once = normalizeState(input);
  assert.deepEqual(once.crisis, input.crisis); assert.deepEqual(once.gameOver, input.gameOver);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(once))), once);
});

test('tampered crisis data is sanitized instead of being stored', () => {
  const clean = normalizeState(base({
    crisis: { days: -5, stage: '<script>', sinceQuitRoll: 1e9, bailouts: 'many', admin: true },
    gameOver: { reason: '__proto__', day: 5 }
  }));
  assert.deepEqual(Object.keys(clean.crisis).sort(), ['bailouts', 'days', 'sinceQuitRoll', 'stage']);
  assert.equal(clean.crisis.days, 0); assert.equal(clean.crisis.stage, 'none'); assert.equal(clean.crisis.bailouts, 0);
  assert.ok(clean.crisis.sinceQuitRoll <= 6);
  assert.equal(clean.gameOver, null);
  assert.equal(normalizeState(base({ gameOver: 'yes' })).gameOver, null);
});
