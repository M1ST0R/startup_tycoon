'use strict';

/*
 * CrisisFlow — сценарий финансового кризиса: связывает чистые правила (crisis.js) с игрой.
 *
 *   • каждый тик (после начисления дохода) двигает автомат «дней без денег»;
 *   • при нуле на счёте предлагает признаться инвестору или промолчать (окно с паузой игры);
 *   • раз в несколько часов бросает кубики увольнений за невыплату зарплат;
 *   • при запросе отчёта инвестором проверяет, не раскрыт ли обман;
 *   • объявляет поражение (`state.gameOver`).
 *
 * Модуль не знает про DOM и конкретную игру: всё внешнее приходит через deps.
 *   getState()              — текущее состояние игры;
 *   dialogs                 — экземпляр DecisionDialog;
 *   random()                — генератор [0, 1), по умолчанию Math.random;
 *   log(text, type)         — запись в журнал;
 *   formatMoney(n)          — форматирование сумм;
 *   dailyCosts()            — расходы за день (аренда + зарплаты);
 *   dismissEmployee(person) — убрать сотрудника из игры (уволился);
 *   onGameOver(gameOver)    — игра проиграна: остановить таймер, сохранить, показать экран;
 *   onChanged()             — состояние изменилось вне обычного тика (нужно сохранение).
 */
(function exposeCrisisFlow(root, factory) {
  const hasModule = typeof module !== 'undefined' && module.exports;
  const api = factory(
    hasModule ? require('./crisis') : root.FinanceCrisis,
    hasModule ? require('./employee-config') : root.EmployeeConfig
  );
  if (hasModule) module.exports = api;
  if (root) root.CrisisFlow = api;
})(typeof window !== 'undefined' ? window : globalThis, function buildCrisisFlow(Crisis, EmployeeConfig) {
  const OWNER = 'crisis';
  const PRIORITY = 100;                 // кризисные решения важнее обычных форс-мажоров
  const IDS = Object.freeze({ confession: 'crisis_confession', aid: 'crisis_aid_result' });
  const AUDIT_TAG = 'finance';          // значение поля `audit` у события форс-мажора «отчёт инвестору»
  const INVESTOR = Object.freeze({ icon: '💼', label: 'Инвестор', color: '#ffcf4a' });

  const TEXT = Object.freeze({
    confessionTitle: 'Деньги закончились',
    confession: (money, costs) => `На счету ${money}, расходы за день — ${costs}. Инвестор пока ничего не знает. `
      + 'Если признаться, он может вложить деньги — или потерять веру в проект и уйти вместе с правами на продукт. '
      + 'Если промолчать, придётся выбираться из долга самому, а при запросе отчёта инвестор может понять, что его обманывают.',
    confess: chance => `Признаться инвестору (шанс помощи ≈ ${chance}%)`,
    conceal: 'Промолчать и справиться самому',
    aidTitle: 'Инвестор согласился помочь',
    aid: (amount, balance) => `Инвестор вложил ${amount}. Долг погашен, на счету ${balance}. `
      + 'Повторно он будет осторожнее: шансы на новую помощь станут ниже.',
    aidOk: 'Продолжить',
    auditNote: 'Вы скрыли от инвестора, что деньги закончились. Любое неосторожное слово может вас выдать.'
  });

  function create(deps) {
    const random = deps.random || Math.random;
    const state = () => deps.getState();
    const pct = chance => Math.round(chance * 100);
    const fmt = n => deps.formatMoney(n);

    /* -------------------------------------------------- поражение */

    function endGame(reason) {
      const s = state();
      s.gameOver = Crisis.createGameOver(reason, s);
      deps.log(`Игра окончена: ${Crisis.GAME_OVER_REASONS[reason].title}`, 'bad');
      deps.onGameOver(s.gameOver);
    }

    /* -------------------------------------------------- решения игрока */

    function confess() {
      const s = state();
      if (!s || s.gameOver) return false;
      if (random() >= Crisis.confessionChance(s)) { endGame('investor_left'); return true; }
      const amount = Crisis.aidAmount(s, deps.dailyCosts());
      s.money = Math.min(EmployeeConfig.BASE.maxMoney, s.money + amount);
      s.crisis.bailouts++;
      deps.log(`Инвестор вложил ${fmt(amount)}: компания снова платёжеспособна`, 'good');
      deps.onChanged();
      deps.dialogs.enqueue({
        id: IDS.aid, owner: OWNER, priority: PRIORITY, kind: INVESTOR, title: TEXT.aidTitle,
        description: () => TEXT.aid(fmt(amount), fmt(s.money)),
        choices: [{ label: TEXT.aidOk }]
      });
      return true;
    }

    function conceal() {
      const s = state();
      if (!s || s.gameOver) return false;
      s.crisis.stage = 'concealed';
      deps.log('Вы промолчали: инвестор не знает, что деньги закончились. Выбирайтесь из долга сами', 'warn');
      deps.onChanged();
      return true;
    }

    function offerConfession(s) {
      if (deps.dialogs.has(IDS.confession)) return;
      deps.dialogs.enqueue({
        id: IDS.confession, owner: OWNER, priority: PRIORITY, kind: INVESTOR, title: TEXT.confessionTitle,
        description: () => TEXT.confession(fmt(s.money), fmt(deps.dailyCosts())),
        // Шанс пересчитывается в момент показа окна: репутация и продукт могли измениться.
        choices: () => [
          { label: TEXT.confess(pct(Crisis.confessionChance(s))), run: confess },
          { label: TEXT.conceal, secondary: true, run: conceal }
        ],
        isValid: () => state() === s && !s.gameOver && Crisis.isBroke(s) && s.crisis.stage === 'none'
      });
    }

    /* -------------------------------------------------- увольнения */

    function processQuits(s) {
      const leavers = Crisis.rollQuits(s, random);
      for (const person of leavers) {
        deps.log(`${person.name} уволился: компания не платит зарплату`, 'bad');
        deps.dismissEmployee(person);
      }
      if (leavers.length && !s.employees.length) endGame('team_quit');
    }

    function announceDay(s) {
      const days = s.crisis.days;
      if (days === 2) deps.log('Второй день без денег: сотрудники работают медленнее', 'warn');
      else if (days === 3) deps.log('Третий день без денег: сотрудники начнут увольняться из-за невыплат', 'bad');
      else if (days > 3) deps.log(`${days}-й день без денег: шанс увольнения вырос`, 'bad');
    }

    /* -------------------------------------------------- тик игры */

    /** Вызывать после начисления дохода. newDay — в этом тике наступила полночь. */
    function afterTick({ newDay = false } = {}) {
      const s = state();
      if (!s || s.gameOver) return;
      const step = Crisis.advance(s, { newDay });
      if (step.recovered) deps.log('Баланс снова положительный: финансовый кризис позади', 'good');
      if (step.entered) deps.log(`Деньги закончились: баланс ${fmt(s.money)}`, 'bad');
      else if (newDay && s.crisis.days > 0) announceDay(s);
      if (step.rollQuits) processQuits(s);
      if (!s.gameOver && Crisis.isBankrupt(s)) endGame('bankrupt');
      if (!s.gameOver && Crisis.isBroke(s) && s.crisis.stage === 'none') offerConfession(s);
    }

    /* -------------------------------------------------- связь с форс-мажорами */

    const isAudit = event => !!event && event.audit === AUDIT_TAG;

    /** Инвестор проверил отчётность: если игрок скрывал кризис, шанс, что обман раскроется. */
    function inspectBooks() {
      const s = state();
      if (!s || s.gameOver || !Crisis.isConcealing(s)) return;
      if (random() < Crisis.detectionChance(s)) endGame('investor_discovered');
      else deps.log('Инвестор принял объяснения, но смотрит с подозрением', 'warn');
    }

    /** Хуки для ForceMajeureSystem: добавляются в его callbacks. */
    function forceMajeureHooks() {
      return {
        // Скрывая кризис, нельзя отложить или проигнорировать запрос отчёта — это был бы побег от проверки.
        isDismissible: event => !(isAudit(event) && Crisis.isConcealing(state())),
        eventWeight: (event, base) => (isAudit(event) ? base * Crisis.auditWeightMultiplier(state()) : base),
        describe: event => (isAudit(event) && Crisis.isConcealing(state()) ? `${event.description} ${TEXT.auditNote}` : event.description),
        onResolved: event => { if (isAudit(event)) inspectBooks(); }
      };
    }

    return Object.freeze({ afterTick, forceMajeureHooks, IDS, OWNER });
  }

  return Object.freeze({ create, IDS, OWNER, AUDIT_TAG });
});
