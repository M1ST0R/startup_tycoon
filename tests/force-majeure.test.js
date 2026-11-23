'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EmployeeConfig = require('../employee-config');
global.EmployeeConfig = EmployeeConfig;
const ForceMajeure = require('../force-majeure');
const events = require('../force-majeure.json');

test('force majeure event identifiers are unique and all effects use supported numeric fields', () => {
  const ids = events.map(event => event.id);
  assert.equal(new Set(ids).size, ids.length);
  const types = new Set(['investor', 'employees', 'office', 'product']);
  const effects = new Set(['money', 'rep', 'product', 'customers', 'employeeMood', 'employeeEnergy']);

  for (const event of events) {
    assert.ok(types.has(event.type), `unsupported event type: ${event.type}`);
    assert.ok(Array.isArray(event.choices) && event.choices.length > 0, event.id);
    for (const choice of event.choices) {
      for (const [key, value] of Object.entries(choice.effects || {})) {
        assert.ok(effects.has(key), `unsupported effect ${key} in ${event.id}`);
        assert.equal(typeof value, 'number', `${event.id}/${choice.id}/${key}`);
        assert.ok(Number.isFinite(value), `${event.id}/${choice.id}/${key}`);
      }
    }
  }
});

test('customer effects are clamped to the configured population range', () => {
  const max = EmployeeConfig.BASE.maxCustomers;
  const state = { money: 0, rep: 50, product: 50, customers: max - 2, employees: [] };

  ForceMajeure.applyEffects(state, { customers: 20 });
  assert.equal(state.customers, max);

  ForceMajeure.applyEffects(state, { customers: -max * 2 });
  assert.equal(state.customers, 0);
});

test('product, reputation and employee effects remain bounded', () => {
  const state = {
    money: 100,
    rep: 98,
    product: 99,
    customers: 10,
    employees: [{ mood: 98, energy: 2 }]
  };

  ForceMajeure.applyEffects(state, {
    rep: 20, product: 20, employeeMood: 20, employeeEnergy: -20
  });
  assert.equal(state.rep, 100);
  assert.equal(state.product, 100);
  assert.equal(state.employees[0].mood, 100);
  assert.equal(state.employees[0].energy, 0);
});
