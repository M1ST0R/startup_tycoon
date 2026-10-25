'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Crisis = require('../crisis');
const { CRISIS: C, BASE } = require('../employee-config');

const worker = (tier = 1, extra = {}) => ({ id: tier, name: `W${tier}`, tier, salary: 100, ...extra });
const game = (extra = {}) => ({
  difficulty: 'medium', money: 1000, rep: 0, product: 0, day: 5, customers: 0,
  employees: [worker(1)], crisis: Crisis.defaultState(), ...extra
});
/** Игра в серии без денег: days — сколько дней уже идёт кризис. */
const broke = (days, extra = {}) => game({ money: -500, crisis: { ...Crisis.defaultState(), days }, ...extra });
const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≠ ${expected}`);

test('daily costs are always charged and can push the balance into debt', () => {
  const s = game({ money: 100, employees: [worker(1, { salary: 90 }), worker(2, { salary: 120 })] });
  const charge = Crisis.chargeDailyCosts(s, 80);
  assert.deepEqual({ rent: charge.rent, salaries: charge.salaries, total: charge.total }, { rent: 80, salaries: 210, total: 290 });
  assert.equal(s.money, -190); assert.equal(charge.inDebt, true);
  const rich = game({ money: 5000 });
  assert.equal(Crisis.chargeDailyCosts(rich, 100).inDebt, false); assert.equal(rich.money, 4800);
  const bottom = game({ money: BASE.minMoney + 10 });
  Crisis.chargeDailyCosts(bottom, 500); assert.equal(bottom.money, BASE.minMoney);
});

test('mood debuff depends only on the amount of debt: none up to $200, then grows and is capped', () => {
  for (const money of [5000, 1, 0, -1, -200]) assert.equal(Crisis.moodDrainPerTick(game({ money })), 0, `money=${money}`);
  const drains = [-201, -450, -1000, -2000, -3000, -100000].map(money => Crisis.moodDrainPerTick(game({ money })));
  assert.ok(drains[0] > 0);
  for (let i = 1; i < drains.length; i++) assert.ok(drains[i] >= drains[i - 1], 'monotonic');
  near(Crisis.moodDrainPerTick(game({ money: -450 })), C.moodDrainPerStep);
  assert.equal(drains.at(-1), C.maxMoodDrain);
});

test('speed debuff depends only on days without money: nothing on day 1, starts on day 2, deepens and is capped', () => {
  assert.equal(Crisis.speedMultiplier(game()), 1);
  assert.equal(Crisis.speedMultiplier(broke(0)), 1);
  assert.equal(Crisis.speedMultiplier(broke(1)), 1, 'one day without money costs nothing');
  near(Crisis.speedMultiplier(broke(2)), 1 - C.speedPenaltyBase);
  near(Crisis.speedMultiplier(broke(3)), 1 - C.speedPenaltyBase - C.speedPenaltyPerDay);
  near(Crisis.speedMultiplier(broke(100)), 1 - C.maxSpeedPenalty);
  // Дебафф скорости не зависит от размера долга: -1 доллар и -5000 одинаковы.
  assert.equal(Crisis.speedMultiplier(broke(2, { money: -1 })), Crisis.speedMultiplier(broke(2, { money: -5000 })));
  // Как только баланс стал положительным, дебафф исчезает сразу, не дожидаясь следующего тика.
  assert.equal(Crisis.speedMultiplier(broke(4, { money: 10 })), 1);
});

test('quit chance: starts on day 3, tier sets the base, +10 points per extra day, difficulty scales it', () => {
  for (const days of [0, 1, 2]) assert.equal(Crisis.quitChance(broke(days), worker(5)), 0, `day ${days}`);
  const base = tier => Crisis.quitChance(broke(3), worker(tier));
  assert.equal(base(5), 0.6, 'tier 5 leaves with 60% right away');
  for (let tier = 2; tier <= 5; tier++) assert.ok(base(tier) > base(tier - 1), `tier ${tier} > tier ${tier - 1}`);
  near(Crisis.quitChance(broke(4), worker(1)), C.quitChanceByTier[1] + 0.1);
  near(Crisis.quitChance(broke(6), worker(3)), C.quitChanceByTier[3] + 0.3);
  assert.equal(Crisis.quitChance(broke(30), worker(5)), C.maxQuitChance);
  const at = difficulty => Crisis.quitChance(broke(3, { difficulty }), worker(4));
  assert.ok(at('easy') < at('medium') && at('medium') < at('hardcore'));
  near(at('easy'), C.quitChanceByTier[4] * 0.7); near(at('hardcore'), C.quitChanceByTier[4] * 1.35);
  assert.equal(Crisis.quitChance(broke(3), worker(99)), C.quitChanceByTier[1], 'unknown tier is treated as tier 1');
  assert.equal(Crisis.quitChance(broke(3, { money: 50 }), worker(5)), 0, 'positive balance: nobody quits');
});

test('rollQuits asks the random source once per employee, in order', () => {
  const s = broke(3, { employees: [worker(5), worker(5), worker(1)] });   // 60%, 60%, 8%
  const rolls = [0.59, 0.61, 0.07];
  assert.deepEqual(Crisis.rollQuits(s, () => rolls.shift()).map(e => e.id), [5, 1]);
  assert.deepEqual(Crisis.rollQuits(s, () => 0.999), []);
  assert.equal(Crisis.rollQuits(broke(2, { employees: [worker(5)] }), () => 0).length, 0);
});

test('streak automaton: entering, daily counting, recovery', () => {
  const s = game({ money: -50 });
  assert.deepEqual(Crisis.advance(s), { entered: true, recovered: false, rollQuits: false });
  assert.equal(s.crisis.days, 1);
  assert.deepEqual(Crisis.advance(s), { entered: false, recovered: false, rollQuits: false });
  assert.equal(s.crisis.days, 1, 'hours do not add days');
  Crisis.advance(s, { newDay: true }); assert.equal(s.crisis.days, 2);
  Crisis.advance(s, { newDay: true }); assert.equal(s.crisis.days, 3);
  s.crisis.stage = 'concealed'; s.money = 1;
  assert.deepEqual(Crisis.advance(s), { entered: false, recovered: true, rollQuits: false });
  assert.deepEqual(s.crisis, { days: 0, stage: 'none', sinceQuitRoll: 0, bailouts: 0 });
  assert.equal(Crisis.advance(s).recovered, false);
  s.money = 0;                                                   // ровно ноль — тоже «нет денег»
  assert.equal(Crisis.advance(s).entered, true);
});

test('layoff checks start six hours after day 3 begins and then repeat every six hours', () => {
  const s = game({ money: -300 });
  Crisis.advance(s); Crisis.advance(s, { newDay: true });         // день 2
  const rolls = [];
  Crisis.advance(s, { newDay: true });                            // полночь, начался день 3
  assert.equal(s.crisis.days, 3);
  for (let hour = 1; hour <= 30; hour++) if (Crisis.advance(s, { newDay: false }).rollQuits) rolls.push(hour);
  assert.deepEqual(rolls, [6, 12, 18, 24, 30]);
  s.money = 100; Crisis.advance(s); s.money = -1;
  Crisis.advance(s);                                               // новая серия: счётчик начат заново
  assert.equal(s.crisis.sinceQuitRoll, 0);
});

test('investor confession: chance grows with reputation and product readiness, within bounds', () => {
  const at = (rep, product, extra) => Crisis.confessionChance(broke(1, { rep, product, ...extra }));
  near(at(0, 0), C.investor.trustBase);
  assert.ok(at(50, 0) > at(0, 0) && at(0, 50) > at(0, 0));
  assert.ok(at(80, 80) > at(40, 40) && at(40, 40) > at(10, 10));
  assert.equal(at(100, 100), C.investor.trustMax);
  assert.ok(at(100, 100, { difficulty: 'easy' }) <= C.investor.trustMax);
  assert.ok(at(30, 30, { difficulty: 'easy' }) > at(30, 30) && at(30, 30) > at(30, 30, { difficulty: 'hardcore' }));
  assert.equal(at(0, 0, { difficulty: 'hardcore' }), C.investor.trustMin);
  const repeated = broke(1, { rep: 60, product: 60 }); const first = Crisis.confessionChance(repeated);
  repeated.crisis.bailouts = 2;
  near(Crisis.confessionChance(repeated), first - 2 * C.investor.repeatPenalty);
  repeated.crisis.bailouts = 50; assert.equal(Crisis.confessionChance(repeated), C.investor.trustMin);
});

test('investor aid closes the debt and leaves a runway, rounded up', () => {
  const s = broke(1, { money: -1234 });
  const amount = Crisis.aidAmount(s, 400);
  assert.ok(amount - 1234 >= 400 * C.investor.aidRunwayDays, 'at least the runway remains after paying the debt');
  assert.equal(amount % C.investor.aidRounding, 0);
  assert.equal(Crisis.aidAmount(game({ money: 0 }), 10), C.investor.aidMinimum, 'never less than the minimum');
});

test('concealing: detection chance grows each day, is lowered by reputation and bounded', () => {
  const at = (days, rep = 0) => Crisis.detectionChance(broke(days, { rep }));
  near(at(1), C.investor.detectBase);
  near(at(3), C.investor.detectBase + 2 * C.investor.detectPerDay);
  assert.ok(at(2) > at(1) && at(5) > at(2));
  assert.ok(at(3, 100) < at(3, 0));
  assert.equal(at(100), C.investor.detectMax);
  assert.ok(at(1, 100) >= C.investor.detectMin);
  const hiding = broke(2); hiding.crisis.stage = 'concealed';
  assert.equal(Crisis.isConcealing(hiding), true); assert.equal(Crisis.auditWeightMultiplier(hiding), C.investor.auditWeightMultiplier);
  hiding.money = 10;
  assert.equal(Crisis.isConcealing(hiding), false); assert.equal(Crisis.auditWeightMultiplier(hiding), 1);
  assert.equal(Crisis.auditWeightMultiplier(broke(2)), 1, 'not concealing: events are not boosted');
});

test('bankruptcy: no employees left while layoffs are active', () => {
  assert.equal(Crisis.isBankrupt(broke(3, { employees: [] })), true);
  assert.equal(Crisis.isBankrupt(broke(2, { employees: [] })), false);
  assert.equal(Crisis.isBankrupt(broke(3)), false);
  assert.equal(Crisis.isBankrupt(broke(5, { employees: [], money: 10 })), false);
});

test('summary and employee warning describe the active debuffs for the interface', () => {
  const info = Crisis.summary(broke(3, { money: -2000 }));
  assert.equal(info.broke, true); assert.equal(info.debt, 2000); assert.equal(info.days, 3);
  assert.ok(info.moodDrain > 0 && info.speedMultiplier < 1 && info.quitPhase);
  assert.equal(info.hoursToQuitRoll, C.quitRollHours);
  assert.equal(Crisis.summary(game()).broke, false); assert.equal(Crisis.summary(game()).hoursToQuitRoll, null);
  assert.match(Crisis.employeeWarning(broke(3), worker(5)), /60%/);
  assert.equal(Crisis.employeeWarning(game(), worker(5)), null);
});

test('state normalization tolerates garbage and old saves', () => {
  assert.deepEqual(Crisis.normalizeState(undefined), Crisis.defaultState());
  assert.deepEqual(Crisis.normalizeState([]), Crisis.defaultState());
  assert.deepEqual(Crisis.normalizeState({ days: -3, stage: 'hack', sinceQuitRoll: 99, bailouts: 1.5 }),
    { days: 0, stage: 'none', sinceQuitRoll: C.quitRollHours, bailouts: 0 });
  assert.deepEqual(Crisis.normalizeState({ days: 4, stage: 'concealed', sinceQuitRoll: 2, bailouts: 1 }),
    { days: 4, stage: 'concealed', sinceQuitRoll: 2, bailouts: 1 });
  assert.equal(Crisis.normalizeGameOver(null), null);
  assert.equal(Crisis.normalizeGameOver({ reason: 'constructor' }), null);
  assert.equal(Crisis.normalizeGameOver({ reason: 'nope' }), null);
  assert.deepEqual(Crisis.normalizeGameOver({ reason: 'team_quit', day: 12, customers: 5, rep: 40, product: 70, extra: 1 }),
    { reason: 'team_quit', day: 12, customers: 5, rep: 40, product: 70 });
  for (const reason of Object.keys(Crisis.GAME_OVER_REASONS)) assert.ok(Crisis.createGameOver(reason, game({ rep: 12.7, product: 55.9 })).rep === 12);
});
