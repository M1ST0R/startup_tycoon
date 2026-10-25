'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Crisis = require('../crisis');
const CrisisFlow = require('../crisis-flow');
const { CRISIS: C } = require('../employee-config');
const { createFakeDocument, createFakeTimers } = require('./helpers/fake-dom');

const worker = (id, tier = 1) => ({ id, name: `Сотрудник ${id}`, tier, salary: 100 });

/**
 * Сценарий целиком: настоящие правила и настоящая очередь окон, но управляемые случайные числа,
 * ручные таймеры и записывающие заглушки вместо журнала и игры.
 */
function fixture({ money = -300, days = 0, employees = [worker(1)], rep = 20, product = 30, random = 0.5 } = {}) {
  const document = createFakeDocument(), clock = createFakeTimers(), pauses = [], logs = [], gameOvers = [];
  const context = vm.createContext({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'decision-dialog.js'), 'utf8'), context);
  const dialogs = context.DecisionDialog.create({ document, pause: value => pauses.push(value) });
  const s = { difficulty: 'medium', money, rep, product, day: 7, customers: 12, employees,
    crisis: { ...Crisis.defaultState(), days }, gameOver: null };
  const rolls = { next: random, queue: [] };
  const flow = CrisisFlow.create({
    getState: () => s, dialogs, random: () => (rolls.queue.length ? rolls.queue.shift() : rolls.next),
    log: (text, type) => logs.push({ text, type }), formatMoney: n => `$${Math.round(n)}`, dailyCosts: () => 400,
    dismissEmployee: person => { s.employees = s.employees.filter(x => x !== person); },
    onGameOver: over => { gameOvers.push(over); dialogs.clear(); },
    onChanged: () => {}
  });
  return {
    s, flow, dialogs, pauses, logs, gameOvers, clock, rolls,
    title: () => document.getElementById('dlgTitle').textContent,
    description: () => document.getElementById('dlgDescription').textContent,
    labels: () => document.getElementById('dlgChoices').children.map(b => b.textContent),
    choose: index => document.getElementById('dlgChoices').children[index].click(),
    modalOpen: () => !document.getElementById('decisionModal').hidden,
    lastLog: () => logs.at(-1)
  };
}

test('when the balance reaches zero the investor dialog opens, pauses the game and cannot be dismissed', () => {
  const f = fixture({ money: 0 });
  f.flow.afterTick();
  assert.equal(f.modalOpen(), true); assert.deepEqual(f.pauses, [true]);
  assert.equal(f.title(), 'Деньги закончились');
  assert.equal(f.labels().length, 2, 'only the two real answers, no postpone/ignore');
  assert.match(f.labels()[0], /Признаться/); assert.match(f.labels()[1], /Промолчать/);
  assert.match(f.labels()[0], /\d+%/, 'the player sees the odds');
  assert.match(f.logs[0].text, /Деньги закончились/);
});

test('no dialog while the company has money, and the dialog is not repeated during the same streak', () => {
  const f = fixture({ money: 500 });
  f.flow.afterTick({ newDay: true }); assert.equal(f.modalOpen(), false);
  f.s.money = -10; f.flow.afterTick(); assert.equal(f.dialogs.pending, 1);
  f.flow.afterTick(); f.flow.afterTick(); assert.equal(f.dialogs.pending, 1, 'not queued twice');
  f.choose(1);                                               // промолчать
  for (let i = 0; i < 5; i++) f.flow.afterTick();
  f.clock.advance(0); assert.equal(f.dialogs.pending, 0, 'concealed: not asked again');
  f.s.money = 50; f.flow.afterTick();                        // выбрались
  assert.match(f.lastLog().text, /кризис позади/);
  f.s.money = -1; f.flow.afterTick();                        // новая серия — снова спрашиваем
  assert.equal(f.modalOpen(), true);
});

test('a dialog that became pointless (money came back before it was shown) is dropped', () => {
  const f = fixture({ money: -10 });
  f.dialogs.enqueue({ id: 'blocker', title: 'x', choices: [{ label: 'ok' }] });
  f.flow.afterTick();
  assert.equal(f.dialogs.has('crisis_confession'), true);
  f.s.money = 400; f.choose(0); f.clock.advance(0);
  assert.equal(f.modalOpen(), false); assert.equal(f.dialogs.pending, 0);
});

test('successful confession: the investor covers the debt, then the aid report is shown', () => {
  const f = fixture({ money: -1500, rep: 60, product: 70, random: 0 });
  f.flow.afterTick(); const before = f.s.money;
  f.choose(0);
  assert.ok(f.s.money > 0 && f.s.money >= before + 1500 + 400 * C.investor.aidRunwayDays, 'debt is repaid with a runway');
  assert.equal(f.s.crisis.bailouts, 1); assert.equal(f.s.gameOver, null);
  f.clock.advance(0);
  assert.equal(f.title(), 'Инвестор согласился помочь'); assert.equal(f.labels().length, 1);
  f.choose(0); assert.equal(f.modalOpen(), false);
  assert.deepEqual(f.pauses, [true, false, true, false], 'every window pauses the game');
  f.flow.afterTick(); assert.equal(f.s.crisis.days, 0, 'streak ends once the balance is positive');
  assert.equal(f.s.crisis.bailouts, 1, 'but the bailout is remembered');
});

test('failed confession: the investor leaves and the game is over', () => {
  const f = fixture({ money: -300, random: 0.999 });
  f.flow.afterTick(); f.choose(0);
  assert.equal(f.s.gameOver.reason, 'investor_left');
  assert.equal(f.s.gameOver.day, 7); assert.equal(f.gameOvers.length, 1);
  assert.equal(f.s.money, -300, 'no money was given');
  assert.equal(f.modalOpen(), false);
  f.flow.afterTick({ newDay: true }); assert.equal(f.gameOvers.length, 1, 'nothing happens after the game is over');
});

test('the odds of the confession really follow reputation and readiness of the product', () => {
  const outcome = (rep, product, roll) => {
    const f = fixture({ money: -300, rep, product, random: roll });
    f.flow.afterTick(); f.choose(0); return f.s.gameOver ? 'left' : 'aided';
  };
  // шанс при rep=0, product=0 равен 10%; при rep=100, product=100 — 95%
  assert.equal(outcome(0, 0, 0.2), 'left'); assert.equal(outcome(100, 100, 0.2), 'aided');
  assert.equal(outcome(100, 100, 0.97), 'left'); assert.equal(outcome(0, 0, 0.05), 'aided');
});

test('concealing keeps the game going without money from the investor', () => {
  const f = fixture({ money: -300 });
  f.flow.afterTick(); f.choose(1);
  assert.equal(f.s.crisis.stage, 'concealed'); assert.equal(f.s.money, -300); assert.equal(f.s.gameOver, null);
  assert.equal(f.modalOpen(), false); assert.deepEqual(f.pauses, [true, false]);
});

test('layoffs: every employee rolls separately; leavers are removed; the rest stay', () => {
  const f = fixture({ money: -800, days: 3, employees: [worker(1, 5), worker(2, 5), worker(3, 1)] });
  f.s.crisis.stage = 'concealed';                            // решение уже принято
  f.s.crisis.sinceQuitRoll = C.quitRollHours - 1;            // на этом тике наступает проверка
  f.rolls.queue = [0.1, 0.9, 0.5];                           // уходит только первый (60%); третий (8%) остаётся
  f.flow.afterTick();
  assert.deepEqual(f.s.employees.map(e => e.id), [2, 3]);
  assert.equal(f.logs.filter(l => /уволился/.test(l.text)).length, 1); assert.equal(f.s.gameOver, null);
});

test('everyone quitting ends the game', () => {
  const f = fixture({ money: -800, days: 3, employees: [worker(1, 5), worker(2, 5)], random: 0 });
  f.s.crisis.stage = 'concealed'; f.s.crisis.sinceQuitRoll = C.quitRollHours - 1;
  f.flow.afterTick();
  assert.equal(f.s.employees.length, 0); assert.equal(f.s.gameOver.reason, 'team_quit');
  assert.equal(f.gameOvers.length, 1);
});

test('no checks before day 3 and none between the six-hour marks', () => {
  const f = fixture({ money: -800, days: 2, employees: [worker(1, 5)], random: 0 });
  f.s.crisis.stage = 'concealed';
  for (let i = 0; i < 30; i++) f.flow.afterTick();           // 30 часов в рамках дня 2
  assert.equal(f.s.employees.length, 1, 'day 2: nobody leaves');
  f.flow.afterTick({ newDay: true });                        // наступил день 3
  for (let i = 0; i < C.quitRollHours - 1; i++) f.flow.afterTick();
  assert.equal(f.s.employees.length, 1, 'the first check comes only after six hours');
  f.flow.afterTick();
  assert.equal(f.s.employees.length, 0);
});

test('an empty office in the layoff phase is bankruptcy', () => {
  const f = fixture({ money: -800, days: 2, employees: [] });
  f.s.crisis.stage = 'concealed';
  f.flow.afterTick(); assert.equal(f.s.gameOver, null);
  f.flow.afterTick({ newDay: true });
  assert.equal(f.s.gameOver.reason, 'bankrupt');
});

test('daily announcements explain which debuff has just started', () => {
  const f = fixture({ money: -800, days: 1, random: 0.99 });
  f.s.crisis.stage = 'concealed';
  f.flow.afterTick({ newDay: true }); assert.match(f.lastLog().text, /Второй день.*медленнее/);
  f.flow.afterTick({ newDay: true }); assert.match(f.lastLog().text, /Третий день.*увольняться/);
  f.flow.afterTick({ newDay: true }); assert.match(f.lastLog().text, /4-й день/);
});

/* ---------------------------------------------------------------- отчёт инвестора */

const audit = { id: 'investor_report', audit: 'finance', description: 'Инвестор хочет отчёт.' };
const regular = { id: 'office_ac', description: 'Жарко.' };

test('hooks: while concealing, the report cannot be dismissed, appears more often and mentions the lie', () => {
  const f = fixture({ money: -300, days: 2 }); const hooks = f.flow.forceMajeureHooks();
  assert.equal(hooks.isDismissible(audit), true); assert.equal(hooks.eventWeight(audit, 3), 3);
  assert.equal(hooks.describe(audit), audit.description);
  f.s.crisis.stage = 'concealed';
  assert.equal(hooks.isDismissible(audit), false);
  assert.equal(hooks.eventWeight(audit, 3), 3 * C.investor.auditWeightMultiplier);
  assert.match(hooks.describe(audit), /скрыли/);
  assert.equal(hooks.isDismissible(regular), true); assert.equal(hooks.eventWeight(regular, 3), 3);
  assert.equal(hooks.describe(regular), regular.description);
  f.s.money = 200;                                           // выбрались из долга — ничего скрывать не нужно
  assert.equal(hooks.isDismissible(audit), true); assert.equal(hooks.eventWeight(audit, 3), 3);
});

test('hooks: a report requested while concealing can expose the lie and end the game', () => {
  const caught = fixture({ money: -300, days: 2, random: 0 });
  caught.s.crisis.stage = 'concealed';
  caught.flow.forceMajeureHooks().onResolved(audit, { type: 'choice' });
  assert.equal(caught.s.gameOver.reason, 'investor_discovered');

  const safe = fixture({ money: -300, days: 2, random: 0.999 });
  safe.s.crisis.stage = 'concealed';
  safe.flow.forceMajeureHooks().onResolved(audit, { type: 'ignored' });
  assert.equal(safe.s.gameOver, null); assert.match(safe.lastLog().text, /подозрением/);
});

test('hooks: the report is harmless if nothing was hidden or the money is back; other events never expose you', () => {
  for (const setup of [
    f => { f.s.crisis.stage = 'none'; },                                  // признались / ещё не решали
    f => { f.s.crisis.stage = 'concealed'; f.s.money = 500; }             // выбрались из долга
  ]) {
    const f = fixture({ money: -300, days: 2, random: 0 }); setup(f);
    f.flow.forceMajeureHooks().onResolved(audit, { type: 'choice' });
    assert.equal(f.s.gameOver, null);
  }
  const f = fixture({ money: -300, days: 2, random: 0 }); f.s.crisis.stage = 'concealed';
  f.flow.forceMajeureHooks().onResolved(regular, { type: 'choice' });
  assert.equal(f.s.gameOver, null);
});
