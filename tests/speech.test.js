'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(t, multiplier = 1) {
  const context = vm.createContext({ setTimeout, clearTimeout });
  for (const file of ['office-dialogue.js', 'speech-system.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  const person = (id, desk) => ({ id, desk, name: 'Анна', role: 'dev', skill: 1, energy: 100, mood: 70, progress: 0, status: 'work', task: 'code' });
  const state = { money: 10000, product: 0, rep: 0, employees: [person(1, 0), person(2, 1)], flavor: { lastTick: -1000, cooldowns: {}, recent: [] } };
  let room = 0, tick = 0; const calls = [];
  const speech = context.StartupSpeechSystem.create({
    getState: () => state, getConfig: () => ({ tasks: { code: { id: 'code', name: 'Code', work: 30 } }, roles: { dev: { name: 'Dev' } } }),
    getSelected: () => state.employees[0], getTaskWork: task => Math.ceil(task.work * multiplier),
    isEmployeeVisible: employee => Math.floor(employee.desk / 4) === room,
    gameTickIndex: () => tick, dailyCosts: () => 100, formatMoney: String, pick: array => array[0],
    dialogue: { ...context.StartupOfficeDialogue, renderSpeech: (category, values) => {
      calls.push({ category, values }); return { id: category, text: category };
    } }, log: () => {}, markDirty: () => {}, isVisible: () => true, renderOffice: () => {}
  });
  t.after(() => speech.clear());
  return { speech, state, calls, person, advance: () => { tick += 6; }, setRoom: value => { room = value; speech.syncVisibility(); } };
}

test('removing the active speaker starts the next queued message', t => {
  const { speech, state } = fixture(t);
  speech.showCharacterLine(state.employees[0], 'idle', {}, { force: true });
  speech.showCharacterLine(state.employees[1], 'rest', {}, { force: true });
  const fired = state.employees.shift();
  assert.doesNotThrow(() => speech.removeEmployee(fired.id));
  assert.equal(speech.getBubble(fired.id), null);
  assert.equal(speech.getBubble(2).text, 'rest');
});

test('room switches remove hidden messages and only visible employees can speak', t => {
  const { speech, state, setRoom, person } = fixture(t);
  speech.showCharacterLine(state.employees[0], 'idle', {}, { force: true });
  speech.showCharacterLine(state.employees[1], 'rest', {}, { force: true });
  setRoom(1);
  assert.equal(speech.getBubble(1), null); assert.equal(speech.speakerForPriority(), null);
  assert.equal(speech.showCharacterLine(state.employees[1], 'idle', {}, { force: true }), false);
  state.employees.push(person(3, 4));
  assert.equal(speech.speakerForPriority().id, 3);
  assert.equal(speech.showCharacterLine(state.employees[2], 'idle', {}, { force: true }), true);
  setRoom(0); assert.equal(speech.getBubble(3), null); assert.equal(speech.getBubble(2), null);
});

for (const [difficulty, multiplier] of [['easy', 0.8], ['medium', 1], ['hardcore', 1.5]]) {
  test(`${difficulty}: progress reactions use the actual task work`, t => {
    const { speech, state, calls, advance } = fixture(t, multiplier);
    state.employees = [state.employees[0]]; speech.seed();
    for (const percent of [25, 50, 75]) {
      advance(); state.employees[0].progress = Math.ceil(30 * multiplier) * percent / 100;
      speech.evaluateReactions();
      assert.ok(calls.some(call => call.category === `progress${percent}` && call.values.progress === percent));
    }
  });
}
