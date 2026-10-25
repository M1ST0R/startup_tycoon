'use strict';

/* Модель одного стартапа: тип, непрерывное развитие продукта, этапы и бонусы. */
(function exposeStartupSystem(root, factory) {
  const config = root && root.EmployeeConfig ? root.EmployeeConfig : require('./employee-config');
  const api = factory(config);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.StartupSystem = api;
})(typeof window !== 'undefined' ? window : globalThis, function buildStartupSystem(EmployeeConfig) {
  const BALANCE = EmployeeConfig.STARTUP_BALANCE;
  const TYPE_IDS = Object.freeze(Object.keys(BALANCE.types));
  const TASK_IDS = Object.freeze(Object.keys(EmployeeConfig.BASE.tasks));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const safeNumber = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? clamp(n, min, max) : fallback;
  };
  const safeInt = (value, fallback, min, max) => Math.floor(safeNumber(value, fallback, min, max));

  function typeOf(id) {
    return BALANCE.types[id] || BALANCE.types[BALANCE.defaultType];
  }

  function typeId(value) {
    return Object.hasOwn(BALANCE.types, value) ? value : BALANCE.defaultType;
  }

  function stageOf(value) {
    const index = safeInt(value, 0, 0, BALANCE.stages.length - 1);
    return BALANCE.stages[index];
  }

  function stageIndex(state) {
    return safeInt(state && state.startupStage, 0, 0, BALANCE.stages.length - 1);
  }

  function meetsStage(state, index) {
    const stage = BALANCE.stages[index];
    return !!state && Number(state.product) >= stage.product
      && Number(state.customers) >= stage.customers
      && Number(state.rep) >= stage.reputation;
  }

  /* Этап можно только открыть, нельзя потерять из-за последующих изменений баланса. */
  function updateStage(state) {
    if (!state || typeof state !== 'object') return [];
    let index = stageIndex(state);
    const crossed = [];
    while (index + 1 < BALANCE.stages.length && meetsStage(state, index + 1)) {
      index++;
      crossed.push(BALANCE.stages[index]);
    }
    state.startupStage = index;
    return crossed;
  }

  function stageProgress(state) {
    const nextIndex = stageIndex(state) + 1;
    if (nextIndex >= BALANCE.stages.length) return 100;
    const next = BALANCE.stages[nextIndex];
    const ratios = [
      next.product <= 0 ? 1 : safeNumber(state && state.product, 0, 0, 100) / next.product,
      next.customers <= 0 ? 1 : safeNumber(state && state.customers, 0, 0, EmployeeConfig.BASE.maxCustomers) / next.customers,
      next.reputation <= 0 ? 1 : safeNumber(state && state.rep, 0, 0, 100) / next.reputation
    ];
    return Math.round(clamp(Math.min(...ratios) * 100, 0, 100));
  }

  function taskMultiplier(state, taskId) {
    const type = typeOf(state && state.startupType);
    const multiplier = type.taskMultipliers[taskId] || 1;
    return multiplier * stageOf(state && state.startupStage).workSpeedMultiplier;
  }

  function applyWork(state, amount) {
    if (!state) return 0;
    const accepted = safeNumber(amount, 0, 0, 1000);
    state.startupProgress = Math.min(BALANCE.maxLifetimeWork,
      safeNumber(state.startupProgress, 0, 0, BALANCE.maxLifetimeWork) + accepted);
    return accepted;
  }

  /** Применяет завершённую внутреннюю задачу. Отдельных денежных наград здесь нет. */
  function completeTask(state, taskId, skillLevel) {
    if (!state || !TASK_IDS.includes(taskId)) return { product: 0, reputation: 0, customers: 0, stages: [] };
    const type = typeOf(state.startupType);
    const stage = stageOf(state.startupStage);
    const level = safeNumber(skillLevel, 0, 0, 10);
    const skillFactor = 0.78 + level * 0.072;
    const productBase = BALANCE.taskProductGain[taskId] || 0;
    const productGain = productBase * (type.productMultipliers[taskId] || 1) * skillFactor;
    const repBase = BALANCE.taskReputationGain[taskId] || 0;
    const reputationGain = repBase * (0.85 + level * 0.035);
    let customersGain = 0;

    if (taskId === 'marketing') {
      const customerRaw = (BALANCE.taskCustomerBase + level * BALANCE.taskCustomerSkillWeight)
        * (0.72 + state.product / 100 * BALANCE.taskCustomerProductWeight)
        * (1 + state.rep / 100 * BALANCE.taskCustomerRepWeight)
        * type.customerMultiplier * stage.customerMultiplier;
      customersGain = Math.max(1, Math.round(customerRaw));
    }

    const oldProduct = safeNumber(state.product, 0, 0, 100);
    const oldRep = safeNumber(state.rep, 0, 0, 100);
    const oldCustomers = safeInt(state.customers, 0, 0, EmployeeConfig.BASE.maxCustomers);
    state.product = clamp(oldProduct + productGain, 0, 100);
    state.rep = clamp(oldRep + reputationGain, 0, 100);
    state.customers = Math.min(EmployeeConfig.BASE.maxCustomers, oldCustomers + customersGain);
    const stages = updateStage(state);
    return {
      product: Number((state.product - oldProduct).toFixed(2)),
      reputation: Number((state.rep - oldRep).toFixed(2)),
      customers: state.customers - oldCustomers,
      stages
    };
  }

  function migrateLegacy(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const active = source.activeProject && typeof source.activeProject === 'object' ? source.activeProject : null;
    let legacyWork = 0;
    if (active && active.workDone && typeof active.workDone === 'object') {
      legacyWork = Object.values(active.workDone).reduce((sum, value) => sum + safeNumber(value, 0, 0, BALANCE.maxLifetimeWork), 0);
    }
    const savedProgress = safeNumber(source.startupProgress, legacyWork, 0, BALANCE.maxLifetimeWork);
    const state = {
      startupType: typeId(source.startupType),
      startupStage: safeInt(source.startupStage, 0, 0, BALANCE.stages.length - 1),
      startupProgress: savedProgress
    };
    // If this is a campaign from before the persistent-startup model, infer eligible stages
    // from values that were already saved, without issuing any old contract reward.
    if (!Object.hasOwn(source, 'startupStage')) state.startupStage = 0;
    return state;
  }

  return Object.freeze({ BALANCE, TYPE_IDS, TASK_IDS, typeOf, typeId, stageOf, stageIndex, stageProgress, taskMultiplier, applyWork, completeTask, updateStage, migrateLegacy });
});
