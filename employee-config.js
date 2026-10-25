'use strict';

/*
 * Единая конфигурация тиров сотрудников, зарплат, навыков и генерации найма.
 * Используется и браузерной игрой, и серверным валидатором сохранений.
 */
(function exposeEmployeeConfig(root, factory) {
  const config = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
  if (root) root.EmployeeConfig = config;
})(typeof window !== 'undefined' ? window : globalThis, function buildEmployeeConfig() {
  /*
   * ЕДИНЫЙ БАЛАНС ИГРЫ. Экономика, сложности, сотрудники, навыки и задачи
   * настраиваются здесь; script.js только использует готовые значения.
   * Один игровой тик = один час, зарплата и аренда списываются раз в день.
   */
  const BASE = Object.freeze({
    tickMs: 1000, speeds: Object.freeze([1, 2, 4]),
    baseSpeed: 2.5,
    workEnergy: 0.9, restEnergy: 5, idleEnergy: 0.5, autoRestBelow: 8, resumeAt: 95,
    startDesks: 4, maxDesks: 10, desksPerUpgrade: 2, deskCost: 1500,
    rentBase: 40, rentPerDesk: 15,
    refreshCost: 100, candidates: 4,
    // Базовая цена клиента за игровой час. После 250 клиентов каждый следующий
    // учитывается с меньшим весом, но рост аудитории продолжает увеличивать доход.
    arpu: 0.08, customerIncomeCap: 250, aboveCapCustomerWeight: 0.25, maxCustomers: 1000, maxMoney: 1e12,
    // Баланс может уходить в минус (общий долг компании); это технический предел, чтобы число не росло бесконечно.
    minMoney: -1e9,
    // Разовая страховка от софтлока: только если денег почти нет и команда пуста.
    rescueThreshold: 250, rescueGrant: 5000,
    autosaveTicks: 10, logMax: 40,
    roles: Object.freeze({
      dev: Object.freeze({ name: 'Разработчик', specs: Object.freeze(['Backend', 'Frontend', 'Mobile']), fit: Object.freeze({ code: 1.0, backend: 1.0, frontend: 0.95, ui: 0.4, marketing: 0.2 }) }),
      designer: Object.freeze({ name: 'Дизайнер', specs: Object.freeze(['UI', 'UX', 'Графика']), fit: Object.freeze({ code: 0.3, backend: 0.25, frontend: 0.45, ui: 1.0, marketing: 0.4 }) }),
      marketer: Object.freeze({ name: 'Маркетолог', specs: Object.freeze(['SMM', 'SEO', 'Контекст']), fit: Object.freeze({ code: 0.2, backend: 0.15, frontend: 0.2, ui: 0.4, marketing: 1.0 }) })
    }),
    tasks: Object.freeze({
      code: Object.freeze({ id: 'code', name: 'Разработка продукта', work: 30, desc: 'Внутренняя разработка продукта.' }),
      backend: Object.freeze({ id: 'backend', name: 'Backend', work: 30, desc: 'Серверная логика, API и данные продукта.' }),
      frontend: Object.freeze({ id: 'frontend', name: 'Frontend', work: 30, desc: 'Клиентская часть и взаимодействия продукта.' }),
      ui: Object.freeze({ id: 'ui', name: 'UI', work: 24, desc: 'Интерфейс и пользовательский опыт.' }),
      marketing: Object.freeze({ id: 'marketing', name: 'Маркетинг', work: 25, desc: 'Продвижение продукта и привлечение пользователей.' })
    })
  });

  /*
   * ФИНАНСОВЫЙ КРИЗИС: долг, дебаффы, увольнения за невыплату зарплат и реакция инвестора.
   * Здесь только числа; правила их применения находятся в crisis.js.
   * «День без денег» считается с первой полуночи, на которой баланс ≤ 0 (первый такой день = 1).
   */
  const CRISIS = Object.freeze({
    // Дебафф настроения по объёму долга: до freeDebt ничего нет, дальше растёт линейно.
    freeDebt: 200,            // $ долга без последствий
    moodDebtStep: 250,        // каждые $250 долга сверх лимита...
    moodDrainPerStep: 0.1,    // ...добавляют −0.1 настроения каждому сотруднику в час
    maxMoodDrain: 1.2,        // потолок потери настроения в час
    // Дебафф скорости работы по длительности: с 2-го дня без денег, дальше усиливается.
    speedPenaltyStartDay: 2,
    speedPenaltyBase: 0.15,   // −15% к скорости в первый «штрафной» день
    speedPenaltyPerDay: 0.05, // и ещё −5% за каждый следующий день
    maxSpeedPenalty: 0.5,
    // Увольнения за неуплату: с 3-го дня, бросок для каждого сотрудника раз в quitRollHours часов.
    quitStartDay: 3,
    quitRollHours: 6,
    quitDailyGrowth: 0.10,    // +10 п.п. к шансу за каждый следующий день после стартового
    maxQuitChance: 0.95,
    quitChanceByTier: Object.freeze({ 1: 0.08, 2: 0.18, 3: 0.30, 4: 0.45, 5: 0.60 }),
    // Инвестор.
    investor: Object.freeze({
      // Шанс, что инвестор поможет, если признаться: база + вклад репутации и готовности продукта.
      trustBase: 0.10, trustRepWeight: 0.40, trustProductWeight: 0.45,
      trustMin: 0.05, trustMax: 0.95,
      repeatPenalty: 0.15,    // −15 п.п. за каждую уже полученную помощь
      // Размер помощи: покрыть долг и дать запас на aidRunwayDays дней расходов.
      aidRunwayDays: 5, aidMinimum: 1000, aidRounding: 100,
      // Запрос отчёта при скрытом кризисе: шанс, что инвестор раскусит обман.
      detectBase: 0.40, detectPerDay: 0.10, detectRepRelief: 0.20,
      detectMin: 0.10, detectMax: 0.95,
      auditWeightMultiplier: 3 // во столько раз чаще выпадает событие-отчёт, пока вы скрываете кризис
    })
  });

  // Режимы меняют не только стартовый капитал: у каждого своя экономика,
  // темп разработки, цены действий и интенсивность форс-мажоров.
  const DIFFICULTIES = Object.freeze({
    easy: Object.freeze({
      name: 'Лёгкий', startingMoney: 8800, employeeSpeed: 1.15, taskWorkMultiplier: 0.88,
      forceMajeureFrequency: 0.5, salaryMultiplier: 0.88, rentMultiplier: 0.82,
      incomeMultiplier: 1.12, hireFeeMultiplier: 2.3, refreshCostMultiplier: 0.75,
      deskCostMultiplier: 0.85,
      goal: Object.freeze({ product: 38, customers: 80, reputation: 30 }),
      crisis: Object.freeze({ quitChanceMultiplier: 0.7, investorTrustBonus: 0.10 }),
      description: 'Больше стартового капитала, дешёвые сотрудники и аренда, ускоренная работа и более щадящие форс-мажоры.'
    }),
    medium: Object.freeze({
      name: 'Нормальная', startingMoney: 7000, employeeSpeed: 1, taskWorkMultiplier: 1,
      forceMajeureFrequency: 1, salaryMultiplier: 1, rentMultiplier: 1,
      incomeMultiplier: 1, hireFeeMultiplier: 3, refreshCostMultiplier: 1,
      deskCostMultiplier: 1,
      goal: Object.freeze({ product: 55, customers: 110, reputation: 38 }),
      crisis: Object.freeze({ quitChanceMultiplier: 1, investorTrustBonus: 0 }),
      description: 'Сбалансированный режим: требуется вырастить продукт, привлечь клиентов и держать под контролем постоянные расходы.'
    }),
    hardcore: Object.freeze({
      name: 'Сложная', startingMoney: 6500, employeeSpeed: 0.88, taskWorkMultiplier: 1.16,
      forceMajeureFrequency: 1.65, salaryMultiplier: 1.10, rentMultiplier: 1.17,
      incomeMultiplier: 1.05, hireFeeMultiplier: 3.15, refreshCostMultiplier: 1.3,
      deskCostMultiplier: 1.25,
      goal: Object.freeze({ product: 65, customers: 140, reputation: 48 }),
      crisis: Object.freeze({ quitChanceMultiplier: 1.35, investorTrustBonus: -0.05 }),
      description: 'Меньше стартового капитала, выше оклады и расходы, медленнее работа и чаще форс-мажоры. Требует точного найма и распределения задач.'
    })
  });

  const SKILLS = Object.freeze({
    backend: Object.freeze({ label: 'Backend', short: 'Backend' }),
    frontend: Object.freeze({ label: 'Frontend', short: 'Frontend' }),
    ui: Object.freeze({ label: 'UI', short: 'UI' }),
    marketing: Object.freeze({ label: 'Маркетинг', short: 'Маркетинг' })
  });

  // Шансы появления суммарно составляют 100%. Можно менять баланс здесь.
  const TIERS = Object.freeze([
    Object.freeze({ id: 1, salary: Object.freeze({ min: 70, max: 109 }), skillCount: Object.freeze({ min: 1, max: 2 }), skillLevel: Object.freeze({ min: 1, max: 4 }), workSpeedMultiplier: 1.00, chance: 42 }),
    Object.freeze({ id: 2, salary: Object.freeze({ min: 110, max: 159 }), skillCount: Object.freeze({ min: 1, max: 3 }), skillLevel: Object.freeze({ min: 2, max: 6 }), workSpeedMultiplier: 1.05, chance: 28 }),
    Object.freeze({ id: 3, salary: Object.freeze({ min: 160, max: 229 }), skillCount: Object.freeze({ min: 2, max: 3 }), skillLevel: Object.freeze({ min: 3, max: 7 }), workSpeedMultiplier: 1.10, chance: 17 }),
    Object.freeze({ id: 4, salary: Object.freeze({ min: 230, max: 329 }), skillCount: Object.freeze({ min: 2, max: 4 }), skillLevel: Object.freeze({ min: 4, max: 9 }), workSpeedMultiplier: 1.15, chance: 9 }),
    Object.freeze({ id: 5, salary: Object.freeze({ min: 330, max: 480 }), skillCount: Object.freeze({ min: 3, max: 4 }), skillLevel: Object.freeze({ min: 5, max: 10 }), workSpeedMultiplier: 1.20, chance: 4 })
  ]);

  // Тир даёт небольшой прямой бонус скорости сверх отличий в наборе навыков.
  // Множители не делают дорогих сотрудников обязательными: тир 1 остаётся базовым ×1,00.

  // Какие специализации повышают эффективность существующих задач.
  const TASK_SKILLS = Object.freeze({
    code: Object.freeze(['backend', 'frontend']),
    backend: Object.freeze(['backend']),
    frontend: Object.freeze(['frontend']),
    ui: Object.freeze(['ui']),
    marketing: Object.freeze(['marketing'])
  });

  // Веса влияют на специализацию кандидата, но не гарантируют идеальный набор навыков.
  const ROLE_WEIGHTS = Object.freeze({
    dev: Object.freeze({ backend: 4, frontend: 4, ui: 1, marketing: 1 }),
    designer: Object.freeze({ backend: 1, frontend: 1, ui: 5, marketing: 1 }),
    marketer: Object.freeze({ backend: 1, frontend: 1, ui: 1, marketing: 5 })
  });

  const SPEC_SKILLS = Object.freeze({
    Backend: Object.freeze(['backend']),
    Frontend: Object.freeze(['frontend']),
    Mobile: Object.freeze(['backend', 'frontend']),
    UI: Object.freeze(['ui']),
    UX: Object.freeze(['ui']),
    'Графика': Object.freeze(['ui']),
    SMM: Object.freeze(['marketing']),
    SEO: Object.freeze(['marketing']),
    'Контекст': Object.freeze(['marketing'])
  });


  // Баланс развития одного стартапа. Типы и этапы собраны здесь, чтобы баланс
  // можно было менять без разбросанных проверок по UI и игровой логике.
  const STARTUP_BALANCE = Object.freeze({
    defaultType: 'webService',
    maxLifetimeWork: 1e9,
    initialCustomers: 2,
    initialProduct: 4,
    // Прибавка к качеству продукта за завершённую внутреннюю задачу.
    taskProductGain: Object.freeze({ code: 4.2, backend: 3.8, frontend: 3.5, ui: 2.4, marketing: 0.55 }),
    taskReputationGain: Object.freeze({ code: 0.15, backend: 0.15, frontend: 0.2, ui: 1.0, marketing: 0.45 }),
    taskCustomerBase: 3.4,
    taskCustomerSkillWeight: 1.0,
    taskCustomerProductWeight: 0.72,
    taskCustomerRepWeight: 0.35,
    types: Object.freeze({
      webService: Object.freeze({
        id: 'webService', name: 'Веб-сервис', icon: '🌐',
        description: 'Платформа с личным кабинетом, API и серверной логикой. Хорошо растёт за счёт Backend и Frontend.',
        focus: 'Backend и Frontend',
        taskMultipliers: Object.freeze({ code: 1.00, backend: 1.18, frontend: 1.04, ui: 0.94, marketing: 0.98 }),
        productMultipliers: Object.freeze({ code: 1.00, backend: 1.16, frontend: 1.08, ui: 0.92, marketing: 0.8 }),
        customerMultiplier: 0.97, revenueMultiplier: 1.02
      }),
      mobileApp: Object.freeze({
        id: 'mobileApp', name: 'Мобильное приложение', icon: '📱',
        description: 'Приложение для пользователей телефона. Интерфейс и клиентская часть особенно важны.',
        focus: 'Frontend и UI',
        taskMultipliers: Object.freeze({ code: 1.00, backend: 0.94, frontend: 1.20, ui: 1.12, marketing: 1.03 }),
        productMultipliers: Object.freeze({ code: 1.00, backend: 0.92, frontend: 1.2, ui: 1.22, marketing: 0.85 }),
        customerMultiplier: 1.08, revenueMultiplier: 1.00
      }),
      gameStudio: Object.freeze({
        id: 'gameStudio', name: 'Игровая студия', icon: '🎮',
        description: 'Студия развивает собственную игру. Клиентская часть, UI и продвижение помогают собирать аудиторию.',
        focus: 'Frontend, UI и Маркетинг',
        taskMultipliers: Object.freeze({ code: 1.04, backend: 0.88, frontend: 1.15, ui: 1.12, marketing: 1.10 }),
        productMultipliers: Object.freeze({ code: 1.02, backend: 0.88, frontend: 1.15, ui: 1.16, marketing: 0.92 }),
        customerMultiplier: 1.18, revenueMultiplier: 0.91
      }),
      saas: Object.freeze({
        id: 'saas', name: 'SaaS-платформа', icon: '☁️',
        description: 'Подписной сервис для постоянных клиентов. Backend и маркетинг важны для стабильной выручки.',
        focus: 'Backend и Маркетинг',
        taskMultipliers: Object.freeze({ code: 1.00, backend: 1.22, frontend: 0.98, ui: 0.90, marketing: 1.12 }),
        productMultipliers: Object.freeze({ code: 1.00, backend: 1.2, frontend: 0.98, ui: 0.88, marketing: 1.05 }),
        customerMultiplier: 0.91, revenueMultiplier: 1.18
      })
    }),
    stages: Object.freeze([
      Object.freeze({ id: 'prototype', name: 'Прототип', icon: '🧪', product: 0, customers: 0, reputation: 0, revenueMultiplier: 1.00, customerMultiplier: 1.00, workSpeedMultiplier: 1.00, bonus: 'Базовые скорость разработки и выручка', description: 'Создайте рабочую основу и найдите первых пользователей.' }),
      Object.freeze({ id: 'firstVersion', name: 'Первая версия', icon: '🚀', product: 22, customers: 8, reputation: 4, revenueMultiplier: 1.08, customerMultiplier: 1.04, workSpeedMultiplier: 1.02, bonus: '+8% к выручке, +4% к привлечению клиентов, +2% к скорости работы', description: 'Продукт уже полезен первым клиентам.' }),
      Object.freeze({ id: 'growth', name: 'Рост', icon: '📈', product: 45, customers: 30, reputation: 14, revenueMultiplier: 1.20, customerMultiplier: 1.10, workSpeedMultiplier: 1.04, bonus: '+20% к выручке, +10% к привлечению клиентов, +4% к скорости работы', description: 'Команда улучшает продукт и расширяет аудиторию.' }),
      Object.freeze({ id: 'scaling', name: 'Масштабирование', icon: '🏢', product: 68, customers: 75, reputation: 28, revenueMultiplier: 1.34, customerMultiplier: 1.16, workSpeedMultiplier: 1.06, bonus: '+34% к выручке, +16% к привлечению клиентов, +6% к скорости работы', description: 'Бизнес растёт. После этого этапа можно продолжать развивать продукт без финального экрана.' })
    ])
  });

  const orderedSkillKeys = Object.keys(SKILLS);
  const safeTier = value => {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  const tierConfig = tier => TIERS[(safeTier(tier) || 1) - 1];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const difficultyConfig = key => DIFFICULTIES[ key ] || DIFFICULTIES.medium;
  const asLevel = (value, tier) => {
    const range = tierConfig(tier).skillLevel;
    const n = Number(value);
    return clamp(Number.isFinite(n) ? Math.round(n) : range.min, range.min, range.max);
  };

  /** Настройки кризиса для выбранной сложности (модификатор шанса увольнения, доверие инвестора). */
  const crisisSettings = key => difficultyConfig(key).crisis;

  function tierForSalary(salary) {
    const n = Number(salary);
    if (!Number.isFinite(n)) return 1;
    const matching = TIERS.find(tier => n >= tier.salary.min && n <= tier.salary.max);
    if (matching) return matching.id;
    return TIERS.reduce((best, tier) => {
      const midpoint = (tier.salary.min + tier.salary.max) / 2;
      const bestMidpoint = (best.salary.min + best.salary.max) / 2;
      return Math.abs(n - midpoint) < Math.abs(n - bestMidpoint) ? tier : best;
    }, TIERS[0]).id;
  }

  function salaryForTier(tier, random = Math.random, difficultyKey = 'medium') {
    const range = tierConfig(tier).salary;
    const roll = clamp(Number(random()) || 0, 0, 0.999999999);
    const baseSalary = range.min + Math.floor(roll * (range.max - range.min + 1));
    return Math.max(1, Math.round(baseSalary * difficultyConfig(difficultyKey).salaryMultiplier));
  }

  function rentForDesks(deskCount, difficultyKey = 'medium') {
    const desks = clamp(Number.isFinite(Number(deskCount)) ? Number(deskCount) : BASE.startDesks, BASE.startDesks, BASE.maxDesks);
    return Math.max(0, Math.round((BASE.rentBase + BASE.rentPerDesk * desks) * difficultyConfig(difficultyKey).rentMultiplier));
  }

  function incomePerTick(customerCount, product, difficultyKey = 'medium', startupType = STARTUP_BALANCE.defaultType, stageIndex = 0, reputation = 0) {
    const customers = clamp(Number.isFinite(Number(customerCount)) ? Number(customerCount) : 0, 0, BASE.maxCustomers);
    const revenueCustomers = Math.min(customers, BASE.customerIncomeCap)
      + Math.max(0, customers - BASE.customerIncomeCap) * BASE.aboveCapCustomerWeight;
    const productValue = clamp(Number.isFinite(Number(product)) ? Number(product) : 0, 0, 100);
    const repValue = clamp(Number.isFinite(Number(reputation)) ? Number(reputation) : 0, 0, 100);
    const type = STARTUP_BALANCE.types[startupType] || STARTUP_BALANCE.types[STARTUP_BALANCE.defaultType];
    const stage = STARTUP_BALANCE.stages[clamp(Math.floor(Number(stageIndex) || 0), 0, STARTUP_BALANCE.stages.length - 1)];
    const productFactor = 0.25 + productValue / 100;
    const trustFactor = 0.85 + repValue / 300;
    return Math.max(0, revenueCustomers * BASE.arpu * productFactor * trustFactor * type.revenueMultiplier * stage.revenueMultiplier * difficultyConfig(difficultyKey).incomeMultiplier);
  }

  function hireCost(salary, difficultyKey = 'medium') {
    const safeSalary = clamp(Number.isFinite(Number(salary)) ? Number(salary) : 0, 0, 1e6);
    return Math.max(0, Math.ceil(safeSalary * difficultyConfig(difficultyKey).hireFeeMultiplier));
  }

  function actionCost(action, difficultyKey = 'medium') {
    const settings = difficultyConfig(difficultyKey);
    if (action === 'refresh') return Math.max(1, Math.round(BASE.refreshCost * settings.refreshCostMultiplier));
    if (action === 'desk') return Math.max(1, Math.round(BASE.deskCost * settings.deskCostMultiplier));
    return 0;
  }

  function pickTier(random = Math.random) {
    const total = TIERS.reduce((sum, tier) => sum + tier.chance, 0);
    let ticket = clamp(Number(random()) || 0, 0, 0.999999999) * total;
    for (const tier of TIERS) {
      ticket -= tier.chance;
      if (ticket < 0) return tier.id;
    }
    return TIERS[TIERS.length - 1].id;
  }

  function weightedSkillPick(available, role, random) {
    const weights = ROLE_WEIGHTS[role] || ROLE_WEIGHTS.dev;
    const total = available.reduce((sum, key) => sum + (weights[key] || 1), 0);
    let ticket = clamp(Number(random()) || 0, 0, 0.999999999) * total;
    for (const key of available) {
      ticket -= weights[key] || 1;
      if (ticket < 0) return key;
    }
    return available[available.length - 1];
  }

  function generateSkills(role, tier, random = Math.random, preferredSpec = '') {
    const config = tierConfig(tier);
    const count = config.skillCount.min + Math.floor(clamp(Number(random()) || 0, 0, 0.999999999)
      * (config.skillCount.max - config.skillCount.min + 1));
    const available = [...orderedSkillKeys];
    const selected = [];
    const preferredKey = (SPEC_SKILLS[preferredSpec] || [])[0];
    if (preferredKey && available.includes(preferredKey)) {
      selected.push(preferredKey);
      available.splice(available.indexOf(preferredKey), 1);
    }
    while (selected.length < count && available.length) {
      const key = weightedSkillPick(available, role, random);
      selected.push(key);
      available.splice(available.indexOf(key), 1);
    }
    const result = {};
    for (const key of orderedSkillKeys) {
      if (selected.includes(key)) {
        const levels = config.skillLevel;
        result[key] = levels.min + Math.floor(clamp(Number(random()) || 0, 0, 0.999999999)
          * (levels.max - levels.min + 1));
      }
    }
    return result;
  }

  function legacyPreferredKeys(person) {
    const fromSpec = SPEC_SKILLS[person && person.spec] || [];
    const role = person && person.role;
    const byRole = role === 'designer' ? ['ui', 'frontend', 'marketing', 'backend']
      : role === 'marketer' ? ['marketing', 'ui', 'backend', 'frontend']
      : ['backend', 'frontend', 'ui', 'marketing'];
    return [...new Set([...fromSpec, ...byRole])];
  }

  function legacySkills(person, tier) {
    const range = tierConfig(tier).skillLevel;
    const legacyLevel = asLevel(person && person.skill, tier);
    const count = tierConfig(tier).skillCount.min;
    const keys = legacyPreferredKeys(person);
    const result = {};
    for (const key of keys) {
      if (!SKILLS[key] || Object.hasOwn(result, key)) continue;
      result[key] = clamp(legacyLevel, range.min, range.max);
      if (Object.keys(result).length >= count) break;
    }
    if (!Object.keys(result).length) result.backend = range.min;
    return Object.fromEntries(orderedSkillKeys.filter(key => Object.hasOwn(result, key)).map(key => [key, result[key]]));
  }

  function normalizeEmployeeTraits(person) {
    const requestedTier = safeTier(person && person.tier);
    const tier = requestedTier || tierForSalary(person && person.salary);
    const tierSettings = tierConfig(tier);
    const rawSkills = person && person.skills;
    const skills = {};
    if (rawSkills && typeof rawSkills === 'object' && !Array.isArray(rawSkills)) {
      for (const key of orderedSkillKeys) {
        const value = rawSkills[key];
        if (typeof value === 'number' && Number.isFinite(value)) skills[key] = asLevel(value, tier);
      }
    }

    // Обрезаем невозможное для тира количество специализаций, сохраняя самые сильные.
    let entries = Object.entries(skills).sort((a, b) => b[1] - a[1] || orderedSkillKeys.indexOf(a[0]) - orderedSkillKeys.indexOf(b[0]));
    entries = entries.slice(0, tierSettings.skillCount.max);
    const normalized = Object.fromEntries(orderedSkillKeys.filter(key => entries.some(([name]) => name === key))
      .map(key => [key, entries.find(([name]) => name === key)[1]]));

    if (!Object.keys(normalized).length) {
      return { tier, skills: legacySkills(person || {}, tier) };
    }
    // В нормальных сохранениях число навыков уже подходит тиру. Недостающие добавляем детерминированно.
    for (const key of legacyPreferredKeys(person || {})) {
      if (Object.keys(normalized).length >= tierSettings.skillCount.min) break;
      if (!Object.hasOwn(normalized, key)) normalized[key] = asLevel(person && person.skill, tier);
    }
    const sorted = Object.fromEntries(orderedSkillKeys.filter(key => Object.hasOwn(normalized, key)).map(key => [key, normalized[key]]));
    return { tier, skills: sorted };
  }

  function taskSkillKey(person, taskId) {
    const candidates = TASK_SKILLS[taskId] || [];
    return candidates.filter(key => person && person.skills && typeof person.skills[key] === 'number' && Number.isFinite(person.skills[key]))
      .sort((a, b) => person.skills[b] - person.skills[a] || candidates.indexOf(a) - candidates.indexOf(b))[0] || null;
  }

  function taskSkillLevel(person, taskId) {
    const key = taskSkillKey(person, taskId);
    return key ? clamp(Math.round(Number(person.skills[key]) || 1), 1, 10) : 0;
  }

  function improveTaskSkill(person, taskId) {
    const candidates = TASK_SKILLS[taskId] || [];
    const maxLevel = tierConfig(person && person.tier).skillLevel.max;
    const key = candidates.filter(skill => person && person.skills
      && typeof person.skills[skill] === 'number' && Number.isFinite(person.skills[skill])
      && person.skills[skill] < maxLevel)
      .sort((a, b) => person.skills[b] - person.skills[a] || candidates.indexOf(a) - candidates.indexOf(b))[0];
    if (!key) return null;
    const previous = clamp(Math.round(Number(person.skills[key]) || 1), 1, 10);
    const next = Math.min(maxLevel, previous + 1);
    person.skills[key] = next;
    return { key, previous, next, improved: next > previous };
  }

  return Object.freeze({
    BASE, CRISIS, DIFFICULTIES, SKILLS, TIERS, TASK_SKILLS, ROLE_WEIGHTS, SPEC_SKILLS, STARTUP_BALANCE,
    tierConfig, crisisSettings, safeTier, tierForSalary, salaryForTier, rentForDesks, incomePerTick, hireCost, actionCost,
    pickTier, generateSkills,
    normalizeEmployeeTraits, taskSkillKey, taskSkillLevel, improveTaskSkill
  });
});
