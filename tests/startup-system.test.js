'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EmployeeConfig = require('../employee-config');
const StartupSystem = require('../startup-system');
const { normalizeState } = require('../gamestate');

function makeState(overrides = {}) {
  return {
    v: 1, difficulty: 'medium', startupType: 'webService', startupStage: 0,
    startupProgress: 0, money: 7000, rep: 0, product: 4, customers: 2,
    day: 1, hour: 9, speed: 1, desks: 4, nextId: 1, won: false,
    selected: null, rescueUsed: false, tutorialSeen: false,
    employees: [], candidates: [], log: [], ...overrides
  };
}

function simulateReferenceCampaign(difficulty, startupType, days = 45) {
  const mode = EmployeeConfig.DIFFICULTIES[difficulty];
  const makeWorker = (role, task, skillKey) => {
    const salary = EmployeeConfig.salaryForTier(1, () => 0.25, difficulty);
    const skills = { [skillKey]: 3 };
    if (role === 'dev') skills.frontend = 2;
    return { role, task, tier: 1, skills, speed: 1, energy: 100, mood: 70, progress: 0,
      salary, status: 'work', skill: 3 };
  };
  const team = [makeWorker('dev', 'backend', 'backend'), makeWorker('marketer', 'marketing', 'marketing')];
  const state = makeState({
    difficulty, startupType, startupStage: 0, startupProgress: 0,
    money: mode.startingMoney - team.reduce((sum, person) => sum + EmployeeConfig.hireCost(person.salary, difficulty), 0)
  });
  let hour = 9;
  let minimumBalance = state.money;

  const rate = (person, taskId) => {
    const level = EmployeeConfig.taskSkillLevel(person, taskId);
    const skillFactor = level > 0 ? 0.4 + level * 0.12 : 0.4;
    return EmployeeConfig.BASE.baseSpeed * mode.employeeSpeed
      * StartupSystem.taskMultiplier(state, taskId)
      * person.speed * EmployeeConfig.tierConfig(person.tier).workSpeedMultiplier
      * EmployeeConfig.BASE.roles[person.role].fit[taskId] * skillFactor
      * (0.4 + 0.6 * person.energy / 100) * (0.5 + 0.5 * person.mood / 100);
  };

  for (let tick = 0; tick < days * 24; tick++) {
    hour++;
    if (hour >= 24) {
      hour = 0;
      state.money -= EmployeeConfig.rentForDesks(4, difficulty) + team.reduce((sum, person) => sum + person.salary, 0);
    }
    for (const person of team) {
      const beforeEnergy = person.energy;
      const beforeMood = person.mood;
      if (person.status === 'rest') {
        person.energy = Math.min(100, person.energy + EmployeeConfig.BASE.restEnergy);
        person.mood = Math.min(100, person.mood + 0.4);
        if (person.energy >= EmployeeConfig.BASE.resumeAt) person.status = person.task ? 'work' : 'idle';
      } else if (!person.task) {
        person.status = 'idle';
        person.energy = Math.min(100, person.energy + EmployeeConfig.BASE.idleEnergy);
        person.mood = Math.max(0, person.mood - 0.25);
      } else {
        const task = EmployeeConfig.BASE.tasks[person.task];
        person.status = 'work';
        person.energy = Math.max(0, person.energy - EmployeeConfig.BASE.workEnergy);
        person.mood = person.energy < 25 ? Math.max(0, person.mood - 0.6) : Math.min(100, person.mood + 0.05);
        if (person.energy <= EmployeeConfig.BASE.autoRestBelow) person.status = 'rest';
        else {
          const required = Math.ceil(task.work * mode.taskWorkMultiplier);
          const accepted = Math.min(rate(person, task.id), Math.max(0, required - person.progress));
          person.progress += accepted;
          StartupSystem.applyWork(state, accepted);
          if (person.progress >= required - 1e-7) {
            person.progress = Math.max(0, person.progress - required);
            EmployeeConfig.improveTaskSkill(person, task.id);
            const skill = EmployeeConfig.taskSkillLevel(person, task.id);
            person.skill = Math.min(10, person.skill + 0.12);
            StartupSystem.completeTask(state, task.id, skill);
            person.mood = Math.min(100, person.mood + 3);
          }
        }
      }
      person.mood = Math.max(0, person.mood);
      assert.ok(Number.isFinite(person.energy) && person.energy >= 0 && person.energy <= 100);
      assert.ok(Number.isFinite(person.mood) && person.mood >= 0 && person.mood <= 100);
      assert.ok(Number.isFinite(beforeEnergy) && Number.isFinite(beforeMood));
    }
    state.money += EmployeeConfig.incomePerTick(state.customers, state.product, difficulty,
      startupType, state.startupStage, state.rep);
    minimumBalance = Math.min(minimumBalance, state.money);
  }
  return { state, minimumBalance };
}

test('four startup types are data-driven and distinguish task strengths, audience, and revenue', () => {
  assert.deepEqual(StartupSystem.TYPE_IDS, ['webService', 'mobileApp', 'gameStudio', 'saas']);
  assert.ok(StartupSystem.TYPE_IDS.every(id => StartupSystem.BALANCE.types[id].description.length > 20));
  assert.notEqual(StartupSystem.BALANCE.types.webService.taskMultipliers.backend,
    StartupSystem.BALANCE.types.saas.taskMultipliers.backend);
  assert.notEqual(StartupSystem.BALANCE.types.mobileApp.productMultipliers.ui,
    StartupSystem.BALANCE.types.webService.productMultipliers.ui);
  assert.notEqual(StartupSystem.BALANCE.types.gameStudio.customerMultiplier,
    StartupSystem.BALANCE.types.saas.customerMultiplier);
});

test('internal tasks develop the same product, customer base or reputation without changing money', () => {
  const state = makeState({ money: 1234 });
  const cash = state.money;
  const result = StartupSystem.completeTask(state, 'backend', 5);
  assert.ok(result.product > 0);
  assert.equal(state.money, cash);
  const marketing = StartupSystem.completeTask(state, 'marketing', 5);
  assert.ok(marketing.customers > 0);
  assert.equal(state.money, cash);
  const ui = StartupSystem.completeTask(state, 'ui', 5);
  assert.ok(ui.reputation > 0);
  assert.equal(state.money, cash);
});

test('stage thresholds apply bonuses, remain monotonic, and scaling never ends the game', () => {
  const state = makeState({ product: 22, customers: 8, rep: 4 });
  assert.deepEqual(StartupSystem.updateStage(state).map(stage => stage.id), ['firstVersion']);
  state.product = 45; state.customers = 30; state.rep = 14;
  assert.deepEqual(StartupSystem.updateStage(state).map(stage => stage.id), ['growth']);
  state.product = 68; state.customers = 75; state.rep = 28;
  assert.deepEqual(StartupSystem.updateStage(state).map(stage => stage.id), ['scaling']);
  state.product = 10; state.customers = 2; state.rep = 0;
  assert.deepEqual(StartupSystem.updateStage(state), []);
  assert.equal(state.startupStage, 3, 'stage never rolls back when indicators move');
  assert.equal(StartupSystem.stageProgress(state), 100);
  assert.equal(state.money, 7000, 'milestones do not award cash');
  assert.equal(state.gameOver, undefined, 'reaching scaling creates no game-over flag');
});

test('hourly revenue follows product, customers, reputation, type, stage and difficulty with a soft client cap', () => {
  const low = EmployeeConfig.incomePerTick(20, 10, 'medium', 'webService', 0, 0);
  const highProduct = EmployeeConfig.incomePerTick(20, 80, 'medium', 'webService', 0, 0);
  const highRep = EmployeeConfig.incomePerTick(20, 80, 'medium', 'webService', 0, 80);
  const laterStage = EmployeeConfig.incomePerTick(20, 80, 'medium', 'webService', 3, 80);
  const saas = EmployeeConfig.incomePerTick(20, 80, 'medium', 'saas', 3, 80);
  assert.ok(highProduct > low);
  assert.ok(highRep > highProduct);
  assert.ok(laterStage > highRep);
  assert.ok(saas > laterStage);
  const incomeAt250 = EmployeeConfig.incomePerTick(250, 100, 'medium', 'webService', 3, 100);
  const incomeAt1000 = EmployeeConfig.incomePerTick(1000, 100, 'medium', 'webService', 3, 100);
  assert.ok(incomeAt1000 > incomeAt250, 'new customers keep increasing income after the soft-cap threshold');
  assert.ok(incomeAt1000 < incomeAt250 * 4, 'additional customers have diminishing returns rather than linear, explosive growth');
  assert.ok(EmployeeConfig.incomePerTick(250, 100, 'easy', 'webService', 3, 100)
    > EmployeeConfig.incomePerTick(250, 100, 'hardcore', 'webService', 3, 100));
});

test('each type has a viable deterministic 45-day starter economy across all three difficulties', () => {
  for (const difficulty of Object.keys(EmployeeConfig.DIFFICULTIES)) {
    for (const type of StartupSystem.TYPE_IDS) {
      const result = simulateReferenceCampaign(difficulty, type);
      assert.ok(result.minimumBalance > 0, `${difficulty}/${type} should remain solvent in the reference run`);
      assert.ok(result.state.product > 50, `${difficulty}/${type} should materially develop the product`);
      assert.ok(result.state.customers >= 100, `${difficulty}/${type} should grow the audience`);
      assert.equal(result.state.money > 0, true, `${difficulty}/${type} should recover financially`);
    }
  }
});

test('old saves keep money, staff and task progress while legacy project work migrates without a payout', () => {
  const oldSave = makeState({
    startupType: undefined, startupStage: undefined, startupProgress: undefined,
    money: 4200, product: 48, customers: 36, rep: 16, day: 12, hour: 7,
    activeProject: { workDone: { backend: 14, frontend: 7, marketing: 4 } },
    completedProjects: [{ payout: 4000 }], projectsCompleted: 1, nextProjectId: 2,
    tutorialSeen: undefined
  });
  const normalized = normalizeState(oldSave);
  assert.equal(normalized.money, 4200, 'historic completed-project rewards already reflected in balance are not replayed');
  assert.equal(normalized.product, 48);
  assert.equal(normalized.customers, 36);
  assert.equal(normalized.rep, 16);
  assert.equal(normalized.day, 12);
  assert.equal(normalized.startupType, StartupSystem.BALANCE.defaultType);
  assert.equal(normalized.startupProgress, 25);
  assert.equal(normalized.startupStage, 2, 'stage is inferred from saved product, customer, and reputation values');
  assert.equal(normalized.tutorialSeen, true);
  assert.equal(Object.hasOwn(normalized, 'activeProject'), false);
  assert.equal(Object.hasOwn(normalized, 'completedProjects'), false);
});

test('saved startup type, stage, work, and tutorial flag survive server normalization', () => {
  const normalized = normalizeState(makeState({
    startupType: 'saas', startupStage: 2, startupProgress: 1234,
    product: 55, customers: 40, rep: 18, tutorialSeen: true
  }));
  assert.equal(normalized.startupType, 'saas');
  assert.equal(normalized.startupStage, 2);
  assert.equal(normalized.startupProgress, 1234);
  assert.equal(normalized.tutorialSeen, true);
});
