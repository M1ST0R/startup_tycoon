'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createFakeDocument, createFakeTimers } = require('./helpers/fake-dom');

function fixture() {
  const document = createFakeDocument(), clock = createFakeTimers(), pauses = [];
  const context = vm.createContext({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'decision-dialog.js'), 'utf8'), context);
  let changes = 0;
  const dialogs = context.DecisionDialog.create({ document, pause: value => pauses.push(value), onChange: () => { changes++; } });
  return {
    dialogs, pauses, clock, changes: () => changes,
    modal: () => document.getElementById('decisionModal'),
    title: () => document.getElementById('dlgTitle').textContent,
    description: () => document.getElementById('dlgDescription').textContent,
    button: index => document.getElementById('dlgChoices').children[index],
    labels: () => document.getElementById('dlgChoices').children.map(button => button.textContent)
  };
}
const spec = (id, extra = {}) => ({ id, title: id, description: `desc ${id}`, choices: [{ label: 'ok' }], ...extra });

test('a dialog pauses the game on show and resumes it on close', () => {
  const f = fixture();
  assert.equal(f.dialogs.enqueue(spec('a')), true);
  assert.equal(f.modal().hidden, false); assert.equal(f.dialogs.isOpen(), true);
  assert.deepEqual(f.pauses, [true]);
  f.button(0).click();
  assert.equal(f.modal().hidden, true); assert.equal(f.dialogs.isOpen(), false);
  assert.deepEqual(f.pauses, [true, false]); assert.ok(f.changes() > 0);
});

test('only one dialog is open at a time; higher priority goes first, equal priority keeps order', () => {
  const f = fixture();
  f.dialogs.enqueue(spec('first'));
  f.dialogs.enqueue(spec('low'));
  f.dialogs.enqueue(spec('urgent', { priority: 50 }));
  f.dialogs.enqueue(spec('low2'));
  assert.equal(f.title(), 'first'); assert.equal(f.dialogs.pending, 4);
  const seen = [];
  for (let i = 0; i < 3; i++) { f.button(0).click(); f.clock.advance(0); seen.push(f.title()); }
  assert.deepEqual(seen, ['urgent', 'low', 'low2']);
  f.button(0).click();
  assert.equal(f.modal().hidden, true); assert.equal(f.dialogs.pending, 0);
});

test('duplicate ids and malformed specs are rejected', () => {
  const f = fixture();
  assert.equal(f.dialogs.enqueue(spec('a')), true);
  assert.equal(f.dialogs.enqueue(spec('a')), false);
  assert.equal(f.dialogs.has('a'), true);
  assert.equal(f.dialogs.enqueue({ id: 'b' }), false);
  assert.equal(f.dialogs.enqueue(null), false);
  assert.equal(f.dialogs.enqueue({ choices: [] }), false);
});

test('a choice returning false keeps the dialog open; a throwing choice never leaves the game paused', () => {
  const f = fixture();
  let applied = false;
  f.dialogs.enqueue(spec('a', { choices: [{ label: 'try', run: () => (applied ? undefined : false) }] }));
  f.button(0).click();
  assert.equal(f.dialogs.isOpen(), true); assert.deepEqual(f.pauses, [true]);
  applied = true; f.button(0).click();
  assert.equal(f.dialogs.isOpen(), false);

  f.dialogs.enqueue(spec('boom', { choices: [{ label: 'x', run: () => { throw new Error('boom'); } }] }));
  assert.throws(() => f.button(0).click(), /boom/);
  assert.equal(f.dialogs.isOpen(), false); assert.equal(f.pauses.at(-1), false);
});

test('disabled choices render disabled and cannot be activated', () => {
  const f = fixture(); let ran = 0;
  f.dialogs.enqueue(spec('a', { choices: [{ label: 'paid', disabled: true, run: () => { ran++; } }, { label: 'free', secondary: true }] }));
  assert.equal(f.button(0).disabled, true); f.button(0).click();
  assert.equal(ran, 0); assert.equal(f.dialogs.isOpen(), true);
  assert.equal(f.button(0).className, 'btn'); assert.equal(f.button(1).className, 'btn sec');
});

test('description and choices can be computed lazily when the dialog is finally shown', () => {
  const f = fixture(); let money = 10;
  f.dialogs.enqueue(spec('first'));
  f.dialogs.enqueue(spec('lazy', {
    description: () => `money ${money}`, choices: () => [{ label: `pay ${money}` }]
  }));
  money = 99; f.button(0).click(); f.clock.advance(0);
  assert.equal(f.description(), 'money 99'); assert.deepEqual(f.labels(), ['pay 99']);
});

test('dialogs that lose their meaning are dropped silently before being shown', () => {
  const f = fixture(); let valid = true, dropped = 0;
  f.dialogs.enqueue(spec('first'));
  f.dialogs.enqueue(spec('stale', { isValid: () => valid, onDrop: () => { dropped++; } }));
  f.dialogs.enqueue(spec('last'));
  valid = false; f.button(0).click(); f.clock.advance(0);
  assert.equal(f.title(), 'last'); assert.equal(dropped, 1);
});

test('clear() by owner removes only that owner, never resumes the game and invalidates old buttons', () => {
  const f = fixture(); let ran = 0;
  f.dialogs.enqueue(spec('mine', { owner: 'a', choices: [{ label: 'x', run: () => { ran++; } }] }));
  f.dialogs.enqueue(spec('theirs', { owner: 'b' }));
  const oldButton = f.button(0);
  f.dialogs.clear('a');
  assert.equal(f.modal().hidden, true); assert.deepEqual(f.pauses, [true]);
  oldButton.click(); assert.equal(ran, 0);
  f.clock.advance(0);                       // чужое окно подхватывается следующим
  assert.equal(f.title(), 'theirs'); assert.equal(f.dialogs.has('mine'), false);
  f.dialogs.clear();
  assert.equal(f.dialogs.pending, 0); assert.equal(f.modal().hidden, true);
  f.clock.advance(1000); assert.equal(f.clock.size(), 0);
});
