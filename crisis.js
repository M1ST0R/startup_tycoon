'use strict';

/*
 * FinanceCrisis — чистые правила финансового кризиса (без DOM, таймеров и побочных эффектов, кроме явных мутаций).
 *
 * Что здесь есть:
 *   • состояние кризиса `state.crisis` и `state.gameOver` с нормализацией (используется и клиентом, и сервером);
 *   • списание ежедневных расходов, которое может уводить баланс в долг;
 *   • дебаффы: настроение — от объёма долга, скорость работы — от числа дней без денег;
 *   • шансы: увольнение сотрудника, помощь инвестора при признании, разоблачение при скрытии;
 *   • автомат «серии дней без денег» (`advance`), который решает, когда пора бросать кубики увольнений.
 *
 * Все числа живут в EmployeeConfig.CRISIS; оркестрация окон и журнала — в crisis-flow.js.
 */
(function exposeFinanceCrisis(root, factory) {
  const hasModule = typeof module !== 'undefined' && module.exports;
  const api = factory(hasModule ? require('./employee-config') : root.EmployeeConfig);
  if (hasModule) module.exports = api;
  if (root) root.FinanceCrisis = api;
})(typeof window !== 'undefined' ? window : globalThis, function buildFinanceCrisis(EmployeeConfig) {
  const { CRISIS: C, BASE } = EmployeeConfig;
  const I = C.investor;

  /** Сюжетная стадия серии без денег: игрок ещё не решил или скрывает кризис от инвестора. */
  const STAGES = Object.freeze(['none', 'concealed']);

  /** Причины поражения и тексты экрана «Игра окончена». */
  const GAME_OVER_REASONS = Object.freeze({
    team_quit: Object.freeze({
      icon: '🚪', title: 'Команда ушла',
      text: 'Зарплаты не выплачивались слишком долго, и последний сотрудник покинул компанию. Работать стало некому.'
    }),
    investor_left: Object.freeze({
      icon: '💼', title: 'Инвестор ушёл',
      text: 'Вы признались, что деньги закончились, но инвестор не поверил в проект. Он забрал свои средства и права на продукт.'
    }),
    investor_discovered: Object.freeze({
      icon: '🕵️', title: 'Обман раскрыт',
      text: 'Инвестор понял, что вы скрывали финансовые проблемы. Он разорвал соглашение и забрал права на продукт.'
    }),
    bankrupt: Object.freeze({
      icon: '📉', title: 'Банкротство',
      text: 'У компании нет ни денег, ни команды, ни шансов расплатиться с долгами. Офис закрыт.'
    })
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const intIn = (value, min, max, fallback) => (Number.isInteger(value) ? clamp(value, min, max) : fallback);
  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

  /* ------------------------------------------------------------------ состояние */

  function defaultState() {
    return { days: 0, stage: 'none', sinceQuitRoll: 0, bailouts: 0 };
  }

  /** Мягкая нормализация (старые сохранения, битые поля): никогда не бросает исключений. */
  function normalizeState(raw) {
    const source = isObject(raw) ? raw : {};
    return {
      days: intIn(source.days, 0, 1e6, 0),
      stage: STAGES.includes(source.stage) ? source.stage : 'none',
      sinceQuitRoll: intIn(source.sinceQuitRoll, 0, C.quitRollHours, 0),
      bailouts: intIn(source.bailouts, 0, 1e6, 0)
    };
  }

  /** Возвращает запись о поражении или null. Неизвестная причина считается отсутствием поражения. */
  function normalizeGameOver(raw) {
    if (!isObject(raw) || !Object.hasOwn(GAME_OVER_REASONS, raw.reason)) return null;
    return {
      reason: raw.reason,
      day: intIn(raw.day, 1, 1e6, 1),
      customers: intIn(raw.customers, 0, 1e9, 0),
      rep: intIn(raw.rep, 0, 100, 0),
      product: intIn(raw.product, 0, 100, 0)
    };
  }

  function createGameOver(reason, s) {
    return normalizeGameOver({
      reason, day: s.day, customers: s.customers, rep: Math.floor(s.rep), product: Math.floor(s.product)
    });
  }

  /** Состояние кризиса всегда существует: старые игры без поля дополняются на лету. */
  function crisisOf(s) {
    if (!isObject(s.crisis)) s.crisis = defaultState();
    return s.crisis;
  }

  /* ------------------------------------------------------------------ деньги и долг */

  const isBroke = s => s.money <= 0;
  const debtOf = s => Math.max(0, -s.money);

  /** Сколько дней подряд баланс ≤ 0 (0 — кризиса нет; 1 — первый день без денег). */
  function daysBroke(s) {
    return isBroke(s) && isObject(s.crisis) ? s.crisis.days : 0;
  }

  /**
   * Списывает аренду и зарплаты. Платёж проходит ВСЕГДА: если денег не хватает, баланс уходит в долг.
   * Возвращает разбивку расходов и признак ухода в минус.
   */
  function chargeDailyCosts(s, rent) {
    const salaries = s.employees.reduce((sum, employee) => sum + employee.salary, 0);
    const total = rent + salaries;
    const balanceBefore = s.money;
    s.money = Math.max(BASE.minMoney, s.money - total);
    return { rent, salaries, total, balanceBefore, inDebt: s.money < 0 };
  }

  /* ------------------------------------------------------------------ дебаффы */

  /** Потеря настроения каждым сотрудником за час: зависит только от объёма долга. */
  function moodDrainPerTick(s) {
    const excess = debtOf(s) - C.freeDebt;
    if (excess <= 0) return 0;
    return Math.min(C.maxMoodDrain, excess / C.moodDebtStep * C.moodDrainPerStep);
  }

  /** Штраф к скорости работы (0…maxSpeedPenalty): зависит только от числа дней без денег. */
  function speedPenalty(s) {
    const days = daysBroke(s);
    if (days < C.speedPenaltyStartDay) return 0;
    return Math.min(C.maxSpeedPenalty, C.speedPenaltyBase + (days - C.speedPenaltyStartDay) * C.speedPenaltyPerDay);
  }

  const speedMultiplier = s => 1 - speedPenalty(s);

  /* ------------------------------------------------------------------ увольнения */

  const inQuitPhase = s => daysBroke(s) >= C.quitStartDay;

  /**
   * Шанс, что сотрудник уволится при очередной проверке. Начальный шанс задаёт тир,
   * затем +10 п.п. за каждый следующий день, всё умножается на коэффициент сложности.
   */
  function quitChance(s, employee) {
    if (!inQuitPhase(s)) return 0;
    const tier = EmployeeConfig.safeTier(employee && employee.tier) || 1;
    const base = C.quitChanceByTier[tier] + C.quitDailyGrowth * (daysBroke(s) - C.quitStartDay);
    return clamp(base * EmployeeConfig.crisisSettings(s.difficulty).quitChanceMultiplier, 0, C.maxQuitChance);
  }

  /** Бросает кубик для каждого сотрудника и возвращает тех, кто уходит (сам список штата не меняется). */
  function rollQuits(s, random = Math.random) {
    return s.employees.filter(employee => random() < quitChance(s, employee));
  }

  /** Не осталось никого, кто мог бы работать, а долг уже в фазе увольнений — компания разорена. */
  const isBankrupt = s => inQuitPhase(s) && s.employees.length === 0;

  /* ------------------------------------------------------------------ инвестор */

  /** Шанс, что инвестор поможет, если признаться: растёт с репутацией и готовностью продукта. */
  function confessionChance(s) {
    const rep = clamp(finite(s.rep), 0, 100) / 100;
    const product = clamp(finite(s.product), 0, 100) / 100;
    const bailouts = isObject(s.crisis) ? s.crisis.bailouts : 0;
    const trust = I.trustBase + I.trustRepWeight * rep + I.trustProductWeight * product
      + EmployeeConfig.crisisSettings(s.difficulty).investorTrustBonus
      - I.repeatPenalty * bailouts;
    return clamp(trust, I.trustMin, I.trustMax);
  }

  /** Сумма вложений: закрыть долг и дать запас на несколько дней расходов, с округлением вверх. */
  function aidAmount(s, dailyCosts) {
    const raw = debtOf(s) + Math.max(0, dailyCosts) * I.aidRunwayDays;
    return Math.max(I.aidMinimum, Math.ceil(raw / I.aidRounding) * I.aidRounding);
  }

  /** Игрок скрывает кризис: деньги всё ещё ≤ 0, а инвестору он об этом не сказал. */
  const isConcealing = s => isBroke(s) && isObject(s.crisis) && s.crisis.stage === 'concealed';

  /** Шанс, что при запросе отчёта инвестор поймёт, что его обманывают. Растёт с длиной кризиса. */
  function detectionChance(s) {
    const rep = clamp(finite(s.rep), 0, 100) / 100;
    const chance = I.detectBase + I.detectPerDay * Math.max(0, daysBroke(s) - 1) - I.detectRepRelief * rep;
    return clamp(chance, I.detectMin, I.detectMax);
  }

  /** Во сколько раз чаще выпадает событие «инвестор просит отчёт» (пока игрок скрывает кризис). */
  const auditWeightMultiplier = s => (isConcealing(s) ? I.auditWeightMultiplier : 1);

  /* ------------------------------------------------------------------ автомат серии дней без денег */

  /**
   * Вызывается один раз за тик после начисления дохода.
   *   newDay — в этом тике наступила полночь.
   * Возвращает:
   *   entered   — баланс только что стал ≤ 0 (серия началась);
   *   recovered — баланс снова > 0 (серия закончилась);
   *   rollQuits — пора проверять увольнения (каждые quitRollHours часов фазы увольнений).
   */
  function advance(s, { newDay = false } = {}) {
    const crisis = crisisOf(s);
    if (!isBroke(s)) {
      const recovered = crisis.days > 0;
      Object.assign(crisis, { days: 0, stage: 'none', sinceQuitRoll: 0 });
      return { entered: false, recovered, rollQuits: false };
    }

    const wasQuitPhase = crisis.days >= C.quitStartDay;
    let entered = false;
    if (crisis.days === 0) {
      Object.assign(crisis, { days: 1, stage: 'none', sinceQuitRoll: 0 });
      entered = true;
    } else if (newDay) {
      crisis.days++;
    }

    let rollNow = false;
    if (crisis.days < C.quitStartDay) {
      crisis.sinceQuitRoll = 0;
    } else if (!wasQuitPhase) {
      crisis.sinceQuitRoll = 0;          // фаза только началась: первая проверка через quitRollHours
    } else if (++crisis.sinceQuitRoll >= C.quitRollHours) {
      crisis.sinceQuitRoll = 0;
      rollNow = true;
    }
    return { entered, recovered: false, rollQuits: rollNow };
  }

  /* ------------------------------------------------------------------ данные для интерфейса */

  /** Всё, что нужно панели кризиса и подсказкам: единый снимок текущих дебаффов. */
  function summary(s) {
    const broke = isBroke(s);
    const crisis = isObject(s.crisis) ? s.crisis : defaultState();
    return {
      broke,
      debt: debtOf(s),
      days: daysBroke(s),
      moodDrain: moodDrainPerTick(s),
      speedMultiplier: speedMultiplier(s),
      quitPhase: inQuitPhase(s),
      hoursToQuitRoll: inQuitPhase(s) ? Math.max(1, C.quitRollHours - crisis.sinceQuitRoll) : null,
      concealing: isConcealing(s)
    };
  }

  /** Предупреждение в карточке сотрудника: его личный шанс уйти при ближайшей проверке. */
  function employeeWarning(s, employee) {
    const chance = quitChance(s, employee);
    return chance > 0 ? `Может уволиться из-за долгов по зарплате: ${Math.round(chance * 100)}% за проверку` : null;
  }

  return Object.freeze({
    STAGES, GAME_OVER_REASONS,
    defaultState, normalizeState, normalizeGameOver, createGameOver,
    isBroke, debtOf, daysBroke, chargeDailyCosts,
    moodDrainPerTick, speedPenalty, speedMultiplier,
    inQuitPhase, quitChance, rollQuits, isBankrupt,
    confessionChance, aidAmount, isConcealing, detectionChance, auditWeightMultiplier,
    advance, summary, employeeWarning
  });
});
