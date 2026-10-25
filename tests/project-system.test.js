'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EmployeeConfig = require('../employee-config');
const ProjectSystem = require('../project-system');
const { normalizeState } = require('../gamestate');

test('employee tier adds a small bounded work-speed multiplier without making tier 1 nonviable', () => {
  const multipliers = EmployeeConfig.TIERS.map(tier => tier.workSpeedMultiplier);
  assert.deepEqual(multipliers, [1, 1.05, 1.1, 1.15, 1.2]);
  assert.ok(multipliers.every((value, index) => Number.isFinite(value) && value >= 1 && (index === 0 || value >= multipliers[index - 1])));
});

function makeProject(overrides = {}) {
  return ProjectSystem.create({
    id: 1,
    templateId: 'website',
    name: 'Atlas Workspace',
    deadlineId: 'standard',
    startTick: 9,
    difficultyKey: 'medium',
    ...overrides
  });
}

function makeTeam(difficulty) {
  const employees = [
    { id: 1, role: 'dev', tier: 1, salary: EmployeeConfig.salaryForTier(1, () => 0, difficulty), skills: { backend: 3, frontend: 3 }, speed: 1, energy: 100, mood: 80, task: null, status: 'work', progress: 0 },
    { id: 2, role: 'designer', tier: 1, salary: EmployeeConfig.salaryForTier(1, () => 0, difficulty), skills: { ui: 3, frontend: 3 }, speed: 1, energy: 100, mood: 80, task: null, status: 'work', progress: 0 },
    { id: 3, role: 'marketer', tier: 1, salary: EmployeeConfig.salaryForTier(1, () => 0, difficulty), skills: { marketing: 3, ui: 3 }, speed: 1, energy: 100, mood: 80, task: null, status: 'work', progress: 0 }
  ];
  return employees;
}

/** Deterministic approximation of the production hourly tick: energy, mood, skill growth,
 * daily payroll/rent, passive customer income and one project payout. Random events are excluded. */
function simulateFirstContract(difficulty, templateId, deadlineId = 'relaxed') {
  const employees = makeTeam(difficulty);
  const dailySalaries = employees.reduce((sum, person) => sum + person.salary, 0);
  const dailyRent = EmployeeConfig.rentForDesks(EmployeeConfig.BASE.startDesks, difficulty);
  const hireFees = employees.reduce((sum, person) => sum + EmployeeConfig.hireCost(person.salary, difficulty), 0);
  let money = EmployeeConfig.DIFFICULTIES[difficulty].startingMoney - hireFees;
  let minBalance = money;
  let cashBeforePayout = null;
  let dayCharges = 0;
  let tick = 9;
  const project = ProjectSystem.create({ id: 1, templateId, name: 'Balance check', deadlineId, startTick: tick, difficultyKey: difficulty });
  employees.forEach(person => { person.task = ProjectSystem.bestWorkFor(project, person); });
  let settlement = null;
  let product = 0, reputation = 0, customers = 0;

  for (let guard = 0; guard < 24 * 30 && !settlement; guard++) {
    tick++;
    if (tick % 24 === 0) {
      dayCharges++;
      money -= dailySalaries + dailyRent;
      minBalance = Math.min(minBalance, money);
    }
    for (const person of employees) {
      if (person.status === 'rest') {
        person.energy = Math.min(100, person.energy + EmployeeConfig.BASE.restEnergy);
        person.mood = Math.min(100, person.mood + 0.4);
        if (person.energy >= EmployeeConfig.BASE.resumeAt) person.status = person.task ? 'work' : 'idle';
        continue;
      }
      if (!person.task) {
        person.status = 'idle';
        person.energy = Math.min(100, person.energy + EmployeeConfig.BASE.idleEnergy);
        person.mood = Math.max(0, person.mood - 0.25);
        continue;
      }
      person.energy = Math.max(0, person.energy - EmployeeConfig.BASE.workEnergy);
      person.mood = person.energy < 25 ? Math.max(0, person.mood - 0.6) : Math.min(100, person.mood + 0.05);
      if (person.energy <= EmployeeConfig.BASE.autoRestBelow) { person.status = 'rest'; continue; }
      const taskId = person.task;
      const skillLevel = EmployeeConfig.taskSkillLevel(person, taskId);
      const skillFactor = skillLevel > 0 ? 0.4 + skillLevel * 0.12 : 0.4;
      const work = EmployeeConfig.BASE.baseSpeed * EmployeeConfig.DIFFICULTIES[difficulty].employeeSpeed
        * person.speed * EmployeeConfig.tierConfig(person.tier).workSpeedMultiplier * EmployeeConfig.BASE.roles[person.role].fit[taskId] * skillFactor
        * (0.4 + 0.6 * person.energy / 100) * (0.5 + 0.5 * person.mood / 100);
      const accepted = ProjectSystem.addWork(project, taskId, work, skillLevel);
      if (accepted > 0) {
        person.progress += accepted;
        const workPackage = Math.max(12, EmployeeConfig.BASE.tasks[taskId].work || 24);
        while (person.progress >= workPackage) {
          person.progress -= workPackage;
          EmployeeConfig.improveTaskSkill(person, taskId);
        }
      }
      if (ProjectSystem.isWorkComplete(project, taskId)) {
        person.task = ProjectSystem.bestWorkFor(project, person);
        person.progress = 0;
        person.status = person.task ? 'work' : 'idle';
      }
    }
    if (ProjectSystem.isComplete(project)) {
      cashBeforePayout = money;
      settlement = ProjectSystem.finalize(project, tick);
      assert.ok(settlement, 'completed project should settle');
      money += settlement.reward.payout;
      product = Math.min(100, product + settlement.outcomes.product);
      reputation = Math.min(100, reputation + settlement.outcomes.reputation);
      customers = Math.min(EmployeeConfig.BASE.maxCustomers, customers + settlement.outcomes.customers);
    }
    money += EmployeeConfig.incomePerTick(customers, product, difficulty);
    minBalance = Math.min(minBalance, money);
  }
  return { employees, project, settlement, tick, dayCharges, hireFees, dailySalaries, dailyRent, cashBeforePayout, minBalance, money, product, reputation, customers };
}

test('project names and template IDs are validated and safely bounded', () => {
  assert.equal(ProjectSystem.create({ ...{ id: 1, templateId: 'website', name: '  A  ', deadlineId: 'standard', startTick: 0, difficultyKey: 'medium' } }), null);
  assert.equal(ProjectSystem.create({ id: 1, templateId: 'not-real', name: 'Valid Name', deadlineId: 'standard', startTick: 0, difficultyKey: 'medium' }), null);
  assert.equal(ProjectSystem.safeName('  Atlas\n Workspace  '), 'Atlas Workspace');
  assert.equal(ProjectSystem.safeName('x'.repeat(80)).length, EmployeeConfig.PROJECT_BALANCE.nameMaxLength);
});

test('template work streams sum exactly to project workload and percentages stay bounded', () => {
  for (const mode of Object.keys(EmployeeConfig.DIFFICULTIES)) {
    for (const templateId of Object.keys(EmployeeConfig.PROJECT_BALANCE.templates)) {
      const p = makeProject({ templateId, difficultyKey: mode });
      assert.ok(p);
      assert.equal(Object.values(p.streamTargets).reduce((sum, n) => sum + n, 0), p.totalWork);
      assert.equal(Object.keys(p.streamTargets).length, 4);
      assert.ok(ProjectSystem.progress(p) >= 0 && ProjectSystem.progress(p) <= 100);
    }
  }
});

test('weighted skill levels change quality more for the project’s main specialization', () => {
  const weak = makeProject({ templateId: 'webService' });
  const strong = makeProject({ templateId: 'webService' });
  for (const key of weak.allowedWork) {
    ProjectSystem.addWork(weak, key, weak.streamTargets[key], key === 'backend' ? 2 : 3);
    ProjectSystem.addWork(strong, key, strong.streamTargets[key], key === 'backend' ? 10 : 3);
  }
  assert.ok(ProjectSystem.quality(strong) > ProjectSystem.quality(weak));
  const web = makeProject({ templateId: 'website' });
  for (const key of web.allowedWork) ProjectSystem.addWork(web, key, web.streamTargets[key], key === 'backend' ? 10 : 3);
  assert.ok(ProjectSystem.quality(strong) > ProjectSystem.quality(web), 'Backend has higher configured weight in a web service than in a website');
});

test('a payout is available only on full completion and can be claimed once', () => {
  const p = makeProject();
  const first = p.allowedWork[0];
  ProjectSystem.addWork(p, first, p.streamTargets[first], 5);
  assert.equal(ProjectSystem.finalize(p, p.deadlineTick), null);
  for (const key of p.allowedWork) ProjectSystem.addWork(p, key, p.streamTargets[key], 5);
  assert.ok(ProjectSystem.isComplete(p));
  const result = ProjectSystem.finalize(p, p.deadlineTick);
  assert.ok(result);
  assert.ok(result.reward.payout >= 0 && result.reward.payout <= EmployeeConfig.PROJECT_BALANCE.maxPayout);
  assert.equal(ProjectSystem.finalize(p, p.deadlineTick + 100), null);
});

test('deadline options change both workload and payout with explicit capped formulas', () => {
  const rush = makeProject({ deadlineId: 'rush' });
  const standard = makeProject({ deadlineId: 'standard' });
  const relaxed = makeProject({ deadlineId: 'relaxed' });
  assert.ok(rush.totalWork > standard.totalWork);
  assert.ok(standard.totalWork > relaxed.totalWork);
  const rushPayout = ProjectSystem.rewardBreakdown(rush, 80, false).payout;
  const standardPayout = ProjectSystem.rewardBreakdown(standard, 80, false).payout;
  const relaxedPayout = ProjectSystem.rewardBreakdown(relaxed, 80, false).payout;
  assert.ok(rushPayout > standardPayout && standardPayout > relaxedPayout);
  assert.equal(ProjectSystem.rewardBreakdown(relaxed, 100, true).late, true);
});

test('relaxed contracts are completable on time by a modest first-tier team on all difficulties', () => {
  for (const mode of Object.keys(EmployeeConfig.DIFFICULTIES)) {
    for (const templateId of Object.keys(EmployeeConfig.PROJECT_BALANCE.templates)) {
      const result = simulateFirstContract(mode, templateId, 'relaxed');
      assert.ok(result.settlement, `${mode}/${templateId} should finish`);
      assert.equal(result.settlement.late, false, `${mode}/${templateId} should fit relaxed deadline`);
      assert.ok(result.minBalance > 0, `${mode}/${templateId} should not hit negative cash before payout`);
      assert.ok(result.settlement.reward.payout > 0);
      assert.ok(result.money > 0, `${mode}/${templateId} should keep a positive balance after first payout`);
    }
  }
});

test('normal difficulty fits a standard deadline for every template with the reference team', () => {
  for (const templateId of Object.keys(EmployeeConfig.PROJECT_BALANCE.templates)) {
    const result = simulateFirstContract('medium', templateId, 'standard');
    assert.ok(result.settlement, `${templateId} should finish`);
    assert.equal(result.settlement.late, false, `${templateId} should fit normal standard deadline`);
  }
});

test('old saves without project fields keep company progress and receive safe project defaults', () => {
  const old = {
    v: 1, difficulty: 'easy', money: 4200, rep: 17, product: 35, customers: 28,
    day: 12, hour: 7, speed: 2, desks: 4, nextId: 1, won: false, selected: null,
    employees: [], candidates: [], log: []
  };
  const migrated = normalizeState(old);
  assert.equal(migrated.money, 4200);
  assert.equal(migrated.rep, 17);
  assert.equal(migrated.product, 35);
  assert.equal(migrated.customers, 28);
  assert.equal(migrated.day, 12);
  assert.equal(migrated.difficulty, 'easy');
  assert.equal(migrated.activeProject, null);
  assert.equal(migrated.projectsCompleted, 0);
  assert.equal(migrated.nextProjectId, 1);
});

test('server normalization preserves a saved project and caps damaged stream progress', () => {
  const active = makeProject({ templateId: 'mobileApp', deadlineId: 'relaxed' });
  const partialStream = active.allowedWork[0];
  active.workDone[partialStream] = active.streamTargets[partialStream] * 0.4;
  const save = {
    v: 1, difficulty: 'medium', money: 3900, rep: 14, product: 42, customers: 21,
    day: 4, hour: 11, speed: 1, desks: 4, nextId: 1, won: false, selected: null,
    activeProject: active, completedProjects: [], projectsCompleted: 0, nextProjectId: 2,
    employees: [], candidates: [], log: []
  };
  const normalized = normalizeState(save);
  assert.equal(normalized.money, 3900);
  assert.equal(normalized.activeProject.name, active.name);
  assert.equal(normalized.activeProject.workDone[partialStream], active.workDone[partialStream]);
  assert.equal(normalized.nextProjectId, 2);

  const damaged = { ...save, activeProject: { ...active, totalWork: 1, deadlineTick: 1e8, workDone: { ...active.workDone, [partialStream]: 1e12 } } };
  const repaired = normalizeState(damaged);
  assert.equal(repaired.activeProject.workDone[partialStream], active.streamTargets[partialStream]);
  assert.equal(repaired.activeProject.totalWork, active.totalWork, 'normalization preserves the saved stage workload');
  assert.equal(repaired.activeProject.deadlineTick, active.startedTick + active.deadlineDays * 24, 'malformed deadline timestamps are repaired from the saved duration');
});

test('top product indicator tracks active startup creation and stays complete after delivery', () => {
  const project = makeProject();
  assert.equal(ProjectSystem.creationProgress({ activeProject: null, completedProjects: [], product: 0 }), 0);
  assert.equal(ProjectSystem.creationProgress({ activeProject: null, completedProjects: [], product: 27 }), 27);
  assert.equal(ProjectSystem.creationProgress({ activeProject: project, completedProjects: [], product: 27 }), 0,
    'starting a project should show its actual completion rather than the old product score');

  const firstStream = project.allowedWork[0];
  ProjectSystem.addWork(project, firstStream, project.streamTargets[firstStream] / 2, 5);
  assert.equal(ProjectSystem.creationProgress({ activeProject: project, completedProjects: [], product: 27 }), ProjectSystem.progress(project));
  assert.ok(ProjectSystem.creationProgress({ activeProject: project, completedProjects: [], product: 27 }) > 0);

  for (const workId of project.allowedWork) ProjectSystem.addWork(project, workId, project.streamTargets[workId], 5);
  assert.equal(ProjectSystem.creationProgress({ activeProject: project, completedProjects: [], product: 27 }), 100);
  assert.equal(ProjectSystem.creationProgress({ activeProject: null, completedProjects: [{ id: project.id }], product: 34 }), 100,
    'a delivered product stays at 100% until the next project starts');
});


