'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Names = require('../name-generator');
const { normalizeState } = require('../gamestate');

const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function browserModules(client = false) {
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  context.window = context;
  for (const file of ['employee-config.js', 'crisis.js', 'crisis-flow.js', 'decision-dialog.js', 'name-generator.js', 'office-dialogue.js', 'speech-system.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  if (client) {
    const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
    const startListeners = source.indexOf("document.addEventListener('pointerup'");
    assert.ok(startListeners > 0, 'client entrypoint must be found');
    vm.runInContext(source.slice(0, startListeners)
      + '\nglobalThis.client = { sanitize, cleanPerson, getDirty: () => API.dirty };', context);
  }
  return context;
}
const person = (extra = {}) => ({
  id: 1, name: 'Аня', role: 'dev', spec: 'Backend', skill: 2, salary: 130,
  speed: 1, energy: 83, mood: 70, task: 'code', progress: 9, status: 'work', desk: 0, ...extra
});
const state = (extra = {}) => ({
  v: 1, money: 5000, rep: 2, product: 3, customers: 4, day: 3, hour: 12,
  speed: 1, desks: 4, nextId: 3, won: false, selected: 1,
  employees: [person()], candidates: [person({ id: 2, name: 'Паша', desk: -1, task: null, status: 'idle' })],
  log: [{ t: 'День 3, 12:00', text: 'Исходная запись', type: 'info' }], ...extra
});

test('merged dictionaries retain 82 gender-indexed names, 60 surnames per gender and 16 nicknames', () => {
  const c = Names.CONFIG;
  assert.equal(c.masculineNames.length, 35);
  assert.equal(c.feminineNames.length, 47);
  assert.equal(new Set([...c.masculineNames, ...c.feminineNames]).size, 82);
  for (const surnames of Object.values(c.surnames)) {
    assert.equal(surnames.length, 60);
    assert.equal(new Set(surnames).size, 60);
  }
  assert.equal(c.nicknames.length, 16);
  for (const name of c.masculineNames) assert.equal(Names.genderForName(` ${name} Шляпин «Кофе» `), 'male');
  for (const name of c.feminineNames) assert.equal(Names.genderForName(`${name} Шляпина`), 'female');
  assert.equal(Names.genderForName('АРТЕМ'), 'male');
  assert.equal(Names.genderForName('Неизвестное имя'), null);
});

test('generated names match the requested gender, agree with surnames and stay unique within 32 characters', () => {
  const used = new Set(), bases = new Set();
  for (const gender of ['male', 'female']) {
    const surnames = Names.CONFIG.surnames[gender === 'male' ? 'masculine' : 'feminine'];
    for (let i = 0; i < 250; i++) {
      const name = Names.generate(used, gender);
      const base = name.replace(/\s+«[^»]*»$/u, '');
      assert.equal(Names.genderForName(name), gender);
      assert.ok(surnames.includes(base.split(' ')[1]));
      assert.ok(name.length <= 32);
      assert.ok(!bases.has(Names.normalize(base)), 'nicknames must not hide duplicate base names');
      used.add(name); bases.add(Names.normalize(base));
    }
  }
  assert.equal(used.size, 500);
  assert.equal(typeof Names.generate(used), 'string', 'legacy callers still receive a string');
});

test('name generation escapes collisions even if randomness always chooses the same taken combination', () => {
  const context = browserModules();
  vm.runInContext('Math.random = () => 0', context);
  const generator = context.StartupNameGenerator;
  const first = generator.generate([], 'male');
  const second = generator.generate([first], 'male');
  assert.notEqual(first, second);
  assert.equal(generator.genderForName(second), 'male');
});

test('legacy identity follows explicit gender, known first name, saved sprite, then stable ID', () => {
  assert.equal(Names.resolveIdentity({ id: 1, name: 'Аня', gender: 'male' }).gender, 'male');
  assert.equal(Names.resolveIdentity({ id: 1, name: 'Анна Багова', appearance: { sprite: 3 } }).gender, 'female');
  assert.equal(Names.resolveIdentity({ id: 1, name: 'Unknown', appearance: { sprite: 18 } }).gender, 'female');
  assert.equal(Names.resolveIdentity({ id: 7, name: 'Unknown' }).gender, 'male');
  assert.deepEqual(Names.resolveIdentity({ id: 7 }), Names.resolveIdentity({ id: 7 }));
});

test('all 20 compatible sprites survive normalization and mismatches stay on the same character sheet', () => {
  for (let sprite = 0; sprite < 20; sprite++) {
    const gender = sprite % 2 ? 'male' : 'female';
    const appearance = { hair: 20, cloth: 3, sprite };
    const input = { id: sprite, gender, appearance: { ...appearance } };
    assert.deepEqual(Names.resolveIdentity(input), { gender, appearance });
    assert.deepEqual(input.appearance, appearance, 'normalization must not mutate its input');
  }
  const mismatch = Names.resolveIdentity({ id: 1, name: 'Анна', appearance: { hair: 2, cloth: 1, sprite: 13 } });
  assert.ok(Names.SPRITE_INDICES.female.includes(mismatch.appearance.sprite));
  assert.ok(mismatch.appearance.sprite >= 10);
});

test('combined v1 saves round-trip gender, appearance, difficulty, task progress and speech history', () => {
  const input = state({ difficulty: 'hardcore', flavor: { lastTick: 52, cooldowns: { hire: 50 }, recent: ['say:hire:1'] } });
  input.employees[0] = { ...input.employees[0], ...Names.resolveIdentity(input.employees[0]) };
  const before = plain(input);
  const normalized = normalizeState(input);
  assert.equal(normalized.v, 1);
  assert.equal(normalized.employees[0].name, input.employees[0].name);
  assert.deepEqual(normalized.employees[0].appearance, input.employees[0].appearance);
  assert.equal(normalized.employees[0].gender, 'female');
  assert.equal(normalized.employees[0].progress, 9);
  assert.equal(normalized.employees[0].tier, 2);
  assert.deepEqual(normalized.employees[0].skills, { backend: 2 });
  assert.equal(normalized.difficulty, 'hardcore');
  assert.deepEqual(normalized.flavor, input.flavor);
  assert.deepEqual(normalizeState(normalized), normalized);
  assert.deepEqual(input, before);
});

test('both legacy variants migrate without losing names, progress or compatible appearance', () => {
  const oldGraphics = state();
  oldGraphics.employees[0].appearance = { hair: 2, cloth: 1, sprite: 6 };
  const graphics = normalizeState(oldGraphics);
  assert.equal(graphics.difficulty, 'medium');
  assert.deepEqual(graphics.employees[0].appearance, oldGraphics.employees[0].appearance);
  assert.deepEqual(graphics.flavor, { lastTick: -1000, cooldowns: {}, recent: [] });
  const oldDialogue = state({ difficulty: 'easy', flavor: { lastTick: 42, cooldowns: {}, recent: ['hire:0'] } });
  oldDialogue.employees[0].name = 'Анна Понедельникова «Кофе»';
  const dialogue = normalizeState(oldDialogue);
  assert.equal(dialogue.employees[0].name, oldDialogue.employees[0].name);
  assert.equal(dialogue.employees[0].gender, 'female');
  assert.equal(dialogue.money, oldDialogue.money);
  assert.equal(dialogue.day, oldDialogue.day);
  assert.equal(dialogue.employees[0].progress, oldDialogue.employees[0].progress);
  assert.deepEqual(dialogue.flavor, oldDialogue.flavor);
});

test('server rejects malformed identities and retains 32-character names', () => {
  for (const extra of [{ gender: 'unknown' }, { appearance: [] },
    { appearance: { hair: 64, cloth: 0 } }, { appearance: { hair: 0, cloth: 4 } },
    { appearance: { hair: 0, cloth: 0, sprite: 20 } }]) {
    assert.throws(() => normalizeState(state({ employees: [person(extra)] })), /invalid state/);
  }
  const name = 'Я'.repeat(32);
  assert.equal(normalizeState(state({ employees: [person({ name })] })).employees[0].name, name);
});

test('client migration keeps existing names, fills blank names and stabilizes server round-trips', () => {
  const context = browserModules(true);
  const input = state({ employees: [person({ name: 'Анна Техдолгова «Кофе»' }), person({ id: 3, name: '', desk: 1 })] });
  const migrated = plain(context.client.sanitize(input));
  assert.equal(migrated.employees[0].name, input.employees[0].name);
  assert.ok(migrated.employees[1].name);
  for (const p of [...migrated.employees, ...migrated.candidates]) {
    assert.equal(p.gender, Names.genderForName(p.name));
    assert.ok(Names.SPRITE_INDICES[p.gender].includes(p.appearance.sprite));
  }
  assert.equal(context.client.getDirty(), true);
  assert.equal(migrated.money, input.money);
  assert.equal(migrated.employees[0].progress, input.employees[0].progress);
  assert.equal(migrated.employees[0].tier, 2);
  assert.deepEqual(migrated.employees[0].skills, { backend: 2 });
  const again = plain(context.client.sanitize(normalizeState(migrated)));
  assert.deepEqual(again.employees, migrated.employees);
});
