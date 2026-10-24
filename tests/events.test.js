'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sampleEvent = extra => ({
  id: 'test', type: 'office', title: 'Test', description: 'Description', weight: 40,
  choices: [{ id: 'apply', label: 'Apply', effects: { money: -5, rep: 200, product: -200, employeeMood: 200, employeeEnergy: -200 } }],
  ...extra
});
const gameState = (employees = 1) => ({
  money: 100, rep: 10, product: 10, day: 1,
  employees: Array.from({ length: employees }, (_, id) => ({ id, mood: 50, energy: 50 }))
});

function fixture(events = [sampleEvent()], { delayed = false, paused = false, random = 0 } = {}) {
  class Element {
    constructor() { this.children = []; this.listeners = new Map(); this.style = {}; this.hidden = true; }
    replaceChildren(...children) { this.children = children; }
    appendChild(child) { this.children.push(child); }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    click() { if (!this.disabled) this.listeners.get('click')?.(); }
  }
  const elements = new Map();
  const document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: () => new Element(), body: { classList: { remove() {} } }
  };
  let now = 0, nextId = 0, current = gameState(), previousPause, fetchResolve;
  const timers = new Map(), pauses = [], applied = [], errors = [];
  const math = Object.create(Math); math.random = () => random;
  const response = { ok: true, json: async () => events };
  const context = vm.createContext({
    document, Math: math, console: { error: (...args) => errors.push(args) },
    fetch: delayed ? () => new Promise(resolve => { fetchResolve = resolve; }) : async () => response,
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'force-majeure.js'), 'utf8'), context);
  const callbacks = {
    getState: () => current,
    getFrequency: () => 1,
    pause: value => { pauses.push(value); if (value) { previousPause = paused; paused = true; } else paused = previousPause; },
    render: () => {}, onApplied: (event, choice) => applied.push([event.id, choice.id])
  };
  return {
    api: context.ForceMajeureSystem, callbacks, pauses, applied, errors, timers,
    state: () => current, setState: value => { current = value; }, paused: () => paused,
    modal: () => document.getElementById('forceMajeureModal'),
    button: index => document.getElementById('fmChoices').children[index],
    releaseFetch: () => fetchResolve(response),
    advance: duration => {
      const end = now + duration;
      while (true) {
        const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry; timers.delete(id); now = timer.at; timer.callback();
      }
      now = end;
    }
  };
}

test('no force majeure without employees, and only the first hire gets the initial attempt', async () => {
  const f = fixture(); await f.api.init();
  f.state().employees = [];
  f.api.onTick(f.state(), f.callbacks); f.api.onHire(f.state(), f.callbacks);
  assert.equal(f.api.pending, 0);
  f.state().employees.push({ id: 1, mood: 50, energy: 50 });
  f.api.onHire(f.state(), f.callbacks);
  assert.equal(f.modal().hidden, false);
  f.button(2).click();
  f.api.onHire(f.state(), f.callbacks);
  assert.equal(f.api.pending, 0);
  f.state().employees.push({ id: 2, mood: 50, energy: 50 });
  f.api.onHire(f.state(), f.callbacks);
  assert.equal(f.api.pending, 0);
});

test('first hire waits for configuration loading and still opens an event', async () => {
  const f = fixture(undefined, { delayed: true });
  f.api.onHire(f.state(), f.callbacks);
  const loading = f.api.init();
  f.releaseFetch(); await loading;
  assert.equal(f.modal().hidden, false);
  assert.equal(f.api.pending, 1);
});

test('choice effects are bounded and a resolved choice cannot be applied twice', async () => {
  const f = fixture(); await f.api.init(); f.api.onHire(f.state(), f.callbacks);
  const button = f.button(0); button.click(); button.click();
  assert.equal(f.state().money, 95);
  assert.equal(f.state().rep, 100);
  assert.equal(f.state().product, 0);
  assert.equal(f.state().employees[0].mood, 100);
  assert.equal(f.state().employees[0].energy, 0);
  assert.deepEqual(f.applied, [['test', 'apply']]);
  assert.deepEqual(f.pauses, [true, false]);
});

test('insufficient funds disable the choice and are rechecked when selecting it', async () => {
  const f = fixture(); await f.api.init();
  f.state().money = 0; f.api.onHire(f.state(), f.callbacks);
  assert.equal(f.button(0).disabled, true); f.button(0).click();
  assert.equal(f.applied.length, 0);
  f.api.reset(); f.state().money = 100;
  f.api.onHire(f.state(), f.callbacks); const button = f.button(0);
  f.state().money = 0; button.click();
  assert.equal(f.applied.length, 0); assert.equal(f.state().money, 0);
});

test('an event with pause:false never changes the caller pause state', async () => {
  const f = fixture([sampleEvent({ pause: false })], { paused: true });
  await f.api.init(); f.api.onHire(f.state(), f.callbacks); f.button(2).click();
  assert.deepEqual(f.pauses, []); assert.equal(f.paused(), true);
});

test('a modal restores an already paused game to its previous pause state', async () => {
  const f = fixture(undefined, { paused: true });
  await f.api.init(); f.api.onHire(f.state(), f.callbacks); f.button(2).click();
  assert.deepEqual(f.pauses, [true, false]); assert.equal(f.paused(), true);
});

test('deferring a once event does not consume it, while resolving it does', async () => {
  const f = fixture([sampleEvent({ once: true })]); await f.api.init();
  f.api.onHire(f.state(), f.callbacks); f.button(1).click();
  assert.equal(f.modal().hidden, true); assert.equal(f.api.pending, 1);
  f.advance(30000);
  assert.equal(f.modal().hidden, false); f.button(0).click();
  for (let i = 0; i < 16; i++) f.api.onTick(f.state(), f.callbacks);
  assert.equal(f.api.pending, 0); assert.deepEqual(f.pauses, [true, false, true, false]);
});

test('reset cancels deferred callbacks without resuming the old game timer', async () => {
  const f = fixture(); await f.api.init();
  f.api.onHire(f.state(), f.callbacks); f.button(1).click();
  assert.equal(f.timers.size, 1);
  f.api.reset(); f.advance(30000);
  assert.equal(f.api.pending, 0); assert.equal(f.modal().hidden, true);
  assert.equal(f.timers.size, 0); assert.deepEqual(f.pauses, [true, false]);
  f.api.onHire(f.state(), f.callbacks); f.api.reset();
  assert.deepEqual(f.pauses, [true, false, true]);
});

test('old event buttons and deferred events cannot affect a new player state', async () => {
  const f = fixture(); await f.api.init();
  f.api.onHire(f.state(), f.callbacks); const oldButton = f.button(0);
  f.button(1).click();
  f.setState(gameState()); f.api.onHire(f.state(), f.callbacks);
  oldButton.click(); f.advance(30000);
  assert.equal(f.state().money, 100); assert.equal(f.applied.length, 0);
  assert.equal(f.api.pending, 1);
});

test('deferred events are discarded if the last employee has left', async () => {
  const f = fixture(); await f.api.init();
  f.api.onHire(f.state(), f.callbacks); f.button(1).click();
  f.state().employees = []; f.advance(30000);
  assert.equal(f.api.pending, 0); assert.equal(f.modal().hidden, true);
});

test('difficulty changes event frequency and periodic checks retain their eight-tick gap', async () => {
  for (const [frequency, random, opens] of [[0.5, 0.1, false], [1, 0.1, true], [1, 0.2, false], [2, 0.2, true], [0, 0, false]]) {
    const f = fixture(undefined, { random }); await f.api.init();
    f.callbacks.getFrequency = () => frequency; f.api.onTick(f.state(), f.callbacks);
    assert.equal(f.api.pending > 0, opens, `frequency=${frequency}, random=${random}`);
    if (opens) {
      f.button(2).click();
      for (let i = 0; i < 7; i++) f.api.onTick(f.state(), f.callbacks);
      assert.equal(f.api.pending, 0);
      f.api.onTick(f.state(), f.callbacks); assert.equal(f.api.pending, 1);
    }
  }
});
