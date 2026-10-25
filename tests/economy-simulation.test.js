'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Balance = require('../employee-config');

const { BASE: C, DIFFICULTIES: D } = Balance;

function worker(role, difficulty, specSkills) {
  const tier = 1;
  const salary = Balance.salaryForTier(tier, () => 0, difficulty);
  const skills = { ...specSkills };
  return {
    role, tier, skills, salary, speed: 1, energy: 100, mood: 75,
    task: role === 'dev' ? 'code' : role === 'marketer' ? 'marketing' : 'ui',
    progress: 0, status: 'work'
  };
}

/*
 * Deterministic scenario model for the production formulas: hourly work and income,
 * rest/energy/mood, task rewards, hire fees, rent and payroll. Random force-majeure
 * events are intentionally excluded so every run is reproducible.
 */
function simulate(difficulty, days, roles, { subtractHireFees = true, rescueAfterFiring = false, startingMoney = null } = {}) {
  const cfg = D[difficulty];
  const state = {
    difficulty, money: startingMoney === null ? cfg.startingMoney : startingMoney, product: 0, rep: 0, customers: 0,
    day: 1, hour: 9, rescueUsed: false, employees: roles
  };
  let missedPayments = 0, rescueCount = 0, goalDay = null;

  if (subtractHireFees) {
    const fees = roles.reduce((sum, employee) => sum + Balance.hireCost(employee.salary, difficulty), 0);
    state.money = Math.max(0, state.money - fees);
  }

  // Расходы списываются всегда; «пропущенный платёж» теперь означает уход баланса в долг.
  function payDay() {
    const rent = Balance.rentForDesks(C.startDesks, difficulty);
    state.money -= rent + state.employees.reduce((sum, employee) => sum + employee.salary, 0);
    if (state.money < 0) missedPayments++;
    if (!state.rescueUsed && state.employees.length === 0 && state.money < C.rescueThreshold) {
      state.money = Math.min(C.maxMoney, state.money + C.rescueGrant);
      state.rescueUsed = true;
      rescueCount++;
    }
  }

  function chooseTask(employee) {
    let next = employee.task;
    if (employee.role === 'dev') {
      next = state.product >= 60 && state.rep < cfg.goal.reputation ? 'ui' : 'code';
    } else if (employee.role === 'marketer') next = 'marketing';
    else if (employee.role === 'designer') next = 'ui';
    if (next !== employee.task) {
      employee.task = next;
      employee.progress = 0; // Match assign(): changing tasks loses partial task progress.
    }
  }

  function completeTask(employee, taskId) {
    const productBefore = state.product;
    const repBefore = state.rep;
    Balance.improveTaskSkill(employee, taskId);
    const level = Balance.taskSkillLevel(employee, taskId);
    if (taskId === 'code') {
      state.product = Math.min(100, state.product + 4 + level * 0.4);
      if (productBefore >= 100) state.rep = Math.min(100, state.rep + 0.3);
    } else if (taskId === 'ui') {
      state.rep = Math.min(100, state.rep + 1 + level * 0.15);
      state.product = Math.min(100, state.product + 1);
    } else {
      const gained = Math.max(1, Math.round((3 + level * 1.2)
        * (0.25 + state.product / 100) * (1 + state.rep / 100)));
      state.customers = Math.min(C.maxCustomers, state.customers + gained);
    }
    employee.mood = Math.min(100, employee.mood + 3);
  }

  function employeeTick(employee) {
    chooseTask(employee);
    if (employee.status === 'rest') {
      employee.energy = Math.min(100, employee.energy + C.restEnergy);
      employee.mood = Math.min(100, employee.mood + 0.4);
      if (employee.energy >= C.resumeAt) employee.status = employee.task ? 'work' : 'idle';
      return;
    }
    employee.energy = Math.max(0, employee.energy - C.workEnergy);
    employee.mood = employee.energy < 25
      ? Math.max(0, employee.mood - 0.6)
      : Math.min(100, employee.mood + 0.05);
    if (employee.energy <= C.autoRestBelow) {
      employee.status = 'rest';
      return;
    }
    employee.status = 'work';
    const level = Balance.taskSkillLevel(employee, employee.task);
    const skillFactor = level > 0 ? 0.4 + level * 0.12 : 0.4;
    const task = C.tasks[employee.task];
    employee.progress += C.baseSpeed * cfg.employeeSpeed * employee.speed
      * C.roles[employee.role].fit[employee.task] * skillFactor
      * (0.4 + 0.6 * employee.energy / 100)
      * (0.5 + 0.5 * employee.mood / 100);
    const required = Math.ceil(task.work * cfg.projectComplexity);
    if (employee.progress >= required) {
      employee.progress -= required;
      completeTask(employee, employee.task);
    }
  }

  function tick() {
    state.hour++;
    if (state.hour >= 24) {
      state.hour = 0;
      state.day++;
      payDay();
    }
    state.employees.forEach(employeeTick);
    state.money = Math.min(C.maxMoney, Math.max(C.minMoney,
      state.money + Balance.incomePerTick(state.customers, state.product, difficulty)));
    if (goalDay === null && state.customers >= cfg.goal.customers && state.rep >= cfg.goal.reputation) {
      goalDay = state.day;
    }
  }

  for (let i = 0; i < days * 24; i++) tick();
  if (rescueAfterFiring) {
    state.employees.length = 0;
    for (let i = 0; i < 24; i++) tick();
  }
  return { state, missedPayments, rescueCount, goalDay };
}

const lowTierTeam = difficulty => [
  worker('dev', difficulty, { backend: 3, ui: 3 }),
  worker('marketer', difficulty, { marketing: 3 }),
  worker('designer', difficulty, { ui: 3 })
];

test('difficulty settings change several sides of the economy and retain a finite income ceiling', () => {
  assert.deepEqual(Object.keys(D), ['easy', 'medium', 'hardcore']);
  assert.ok(D.easy.startingMoney > D.medium.startingMoney && D.medium.startingMoney > D.hardcore.startingMoney);
  assert.ok(D.easy.rentMultiplier < D.medium.rentMultiplier && D.hardcore.rentMultiplier > D.medium.rentMultiplier);
  assert.ok(D.easy.projectComplexity < D.medium.projectComplexity && D.hardcore.projectComplexity > D.medium.projectComplexity);
  assert.ok(D.easy.forceMajeureFrequency < D.medium.forceMajeureFrequency && D.hardcore.forceMajeureFrequency > D.medium.forceMajeureFrequency);
  const ceiling = Balance.incomePerTick(1e9, 100, 'medium');
  assert.equal(ceiling, Balance.incomePerTick(C.customerIncomeCap, 100, 'medium'));
  assert.equal(Balance.incomePerTick(-5, 100, 'medium'), 0);
  assert.ok(Balance.rentForDesks(4, 'hardcore') > Balance.rentForDesks(4, 'medium'));
});

test('no-hire opening and a single low-tier hire survive the first several days on every difficulty', () => {
  for (const difficulty of Object.keys(D)) {
    const noHire = simulate(difficulty, 7, [], { subtractHireFees: false });
    assert.ok(noHire.state.money > 0, `${difficulty}: office rent must not bankrupt the player immediately`);

    const soloDev = simulate(difficulty, 10, [worker('dev', difficulty, { backend: 3, ui: 3 })]);
    assert.ok(soloDev.state.money > 0, `${difficulty}: low-tier first hire should have runway`);
    assert.ok(soloDev.state.product > 0, `${difficulty}: employee should complete product work`);
    assert.equal(soloDev.missedPayments, 0, `${difficulty}: first 10 days should remain payable`);
  }
});

test('a team of only tier-1 employees can reach each campaign goal without missing payments', () => {
  const expectedMaxDays = { easy: 25, medium: 30, hardcore: 40 };
  for (const difficulty of Object.keys(D)) {
    const result = simulate(difficulty, 45, lowTierTeam(difficulty));
    assert.ok(result.goalDay !== null, `${difficulty}: goal must be reachable with low-tier staff`);
    assert.ok(result.goalDay <= expectedMaxDays[difficulty], `${difficulty}: completed on day ${result.goalDay}`);
    assert.ok(result.state.money > 0, `${difficulty}: should retain cash after a successful run`);
    assert.equal(result.missedPayments, 0, `${difficulty}: no rent/payroll payment should be missed`);
  }
});

test('one poor staffing choice is recoverable through the one-time rescue contract', () => {
  const badStart = simulate('medium', 45, [worker('dev', 'medium', { backend: 3, ui: 3 })]);
  assert.equal(badStart.state.customers, 0, 'a developer alone cannot monetize product work');
  assert.equal(badStart.state.rescueUsed, false, 'rescue is not triggered while an employee remains');
  badStart.state.employees.length = 0;
  // Continue the deterministic scenario to the following pay day after firing the employee.
  const state = badStart.state;
  for (let i = 0; i < 24; i++) {
    state.hour++;
    if (state.hour >= 24) {
      state.hour = 0;
      state.day++;
      const rent = Balance.rentForDesks(C.startDesks, state.difficulty);
      if (state.money >= rent) state.money -= rent;
      if (!state.rescueUsed && state.employees.length === 0 && state.money < C.rescueThreshold) {
        state.money = Math.min(C.maxMoney, state.money + C.rescueGrant);
        state.rescueUsed = true;
      }
    }
    state.money = Math.min(C.maxMoney, Math.max(0,
      state.money + Balance.incomePerTick(state.customers, state.product, state.difficulty)));
  }
  assert.equal(state.rescueUsed, true);
  assert.ok(state.money >= C.rescueGrant);
});

test('the one-time rescue provides a 15-day runway for a developer and marketer on every difficulty', () => {
  for (const difficulty of Object.keys(D)) {
    const team = [
      worker('dev', difficulty, { backend: 3, ui: 3 }),
      worker('marketer', difficulty, { marketing: 3 })
    ];
    const result = simulate(difficulty, 15, team, { startingMoney: C.rescueGrant });
    assert.equal(result.missedPayments, 0, `${difficulty}: starter team should cover rent and payroll while revenue starts`);
    assert.ok(result.state.product > 0, `${difficulty}: product work should continue`);
    assert.ok(result.state.customers > 0, `${difficulty}: marketing should begin bringing in customers`);
    assert.ok(result.state.money > 0, `${difficulty}: some cash should remain after 15 days`);
  }
});
