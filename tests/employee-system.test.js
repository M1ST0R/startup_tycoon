'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EmployeeConfig = require('../employee-config');

const root = path.join(__dirname, '..');

function browserEmployeeApi() {
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  context.window = context;
  for (const file of ['employee-config.js', 'name-generator.js', 'character-art.js', 'office-dialogue.js', 'speech-system.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
  const listenerStart = source.indexOf("document.addEventListener('pointerup'");
  assert.ok(listenerStart > 0);
  vm.runInContext(source.slice(0, listenerStart) + `
globalThis.employeeTestApi = {
  genCandidate, efficiency, cleanPerson, sanitize,
  setState: value => { S = value; },
  getState: () => S
};`, context);
  return context.employeeTestApi;
}

test('tier balance is configurable and hiring chances sum to 100%', () => {
  assert.deepEqual(EmployeeConfig.TIERS.map(tier => tier.id), [1, 2, 3, 4, 5]);
  assert.equal(EmployeeConfig.TIERS.reduce((sum, tier) => sum + tier.chance, 0), 100);
  assert.deepEqual(EmployeeConfig.TASK_SKILLS, {
    code: ['backend', 'frontend'], ui: ['ui'], marketing: ['marketing']
  });
  assert.equal(EmployeeConfig.pickTier(() => 0), 1);
  assert.equal(EmployeeConfig.pickTier(() => 0.42), 2);
  assert.equal(EmployeeConfig.pickTier(() => 0.70), 3);
  assert.equal(EmployeeConfig.pickTier(() => 0.87), 4);
  assert.equal(EmployeeConfig.pickTier(() => 0.96), 5);
});

test('generated candidate salary, skill count and skill levels obey the selected tier', () => {
  const api = browserEmployeeApi();
  api.setState({ rep: 0, nextId: 1, employees: [], candidates: [], difficulty: 'medium' });
  for (let i = 0; i < 250; i++) {
    const person = api.genCandidate();
    const tier = EmployeeConfig.tierConfig(person.tier);
    const levels = Object.values(person.skills);
    assert.ok(person.tier >= 1 && person.tier <= 5);
    assert.ok(person.salary >= tier.salary.min && person.salary <= tier.salary.max);
    assert.ok(levels.length >= tier.skillCount.min && levels.length <= tier.skillCount.max);
    assert.ok(levels.every(level => Number.isInteger(level) && level >= tier.skillLevel.min && level <= tier.skillLevel.max));
    assert.ok(Object.keys(person.skills).every(key => Object.hasOwn(EmployeeConfig.SKILLS, key)));
    const expectedSpecSkills = EmployeeConfig.SPEC_SKILLS[person.spec];
    assert.ok(expectedSpecSkills.some(key => Object.hasOwn(person.skills, key)), 'candidate should have the skill associated with their displayed spec');
  }
});

test('matching skills improve task speed, unrelated skills do not provide the same bonus', () => {
  const api = browserEmployeeApi();
  api.setState({ difficulty: 'medium' });
  const person = { role: 'dev', tier: 3, skill: 5, speed: 1, energy: 100, mood: 100,
    skills: { backend: 5 }, task: 'code' };
  const backendFive = api.efficiency(person, 'code');
  const unrelatedTen = api.efficiency({ ...person, skills: { ui: 10 } }, 'code');
  const backendTen = api.efficiency({ ...person, skills: { backend: 7 } }, 'code');
  const uiTask = api.efficiency({ ...person, role: 'designer', skills: { ui: 5 } }, 'ui');
  assert.ok(backendFive > unrelatedTen);
  assert.ok(backendTen > backendFive);
  assert.ok(uiTask > 0);
});


test('tier caps skill growth and a capped skill does not block another matching skill', () => {
  const staff = { tier: 3, skills: { backend: 7, frontend: 5 } };
  assert.deepEqual(EmployeeConfig.improveTaskSkill(staff, 'code'), { key: 'frontend', previous: 5, next: 6, improved: true });
  assert.deepEqual(staff.skills, { backend: 7, frontend: 6 });
  assert.equal(EmployeeConfig.improveTaskSkill({ tier: 3, skills: { backend: 7, frontend: 7 } }, 'code'), null);
});

test('old employee data migrates without losing pay or general progress', () => {
  const api = browserEmployeeApi();
  const old = { id: 1, name: 'Аня', role: 'dev', spec: 'Backend', skill: 2, salary: 130,
    speed: 1, energy: 83, mood: 70, task: 'code', progress: 9, status: 'work', desk: 0 };
  const migrated = api.cleanPerson(old);
  assert.equal(migrated.tier, 2);
  assert.deepEqual({ ...migrated.skills }, { backend: 2 });
  assert.equal(migrated.salary, 130);
  assert.equal(migrated.progress, 9);
  const seniorLegacy = api.cleanPerson({ ...old, salary: 250, skill: 8, spec: 'Backend' });
  assert.equal(seniorLegacy.tier, 4);
  assert.ok(Object.keys(seniorLegacy.skills).length >= EmployeeConfig.tierConfig(4).skillCount.min);
  assert.ok(Object.values(seniorLegacy.skills).every(level => level >= 4 && level <= 9));

  const clamped = api.cleanPerson({ ...old, tier: 1, skills: { backend: 99, frontend: -5, ui: 3, marketing: 10 } });
  assert.equal(clamped.tier, 1);
  assert.ok(Object.keys(clamped.skills).length <= EmployeeConfig.tierConfig(1).skillCount.max);
  assert.ok(Object.values(clamped.skills).every(level => level >= 1 && level <= 4));
});

