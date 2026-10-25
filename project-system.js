'use strict';

/* Чистая логика проектного цикла. UI и игровые часы остаются в script.js/compact-ui.js. */
(function exposeProjectSystem(root, factory) {
  const config = root && root.EmployeeConfig ? root.EmployeeConfig : require('./employee-config');
  const api = factory(config);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProjectSystem = api;
})(typeof window !== 'undefined' ? window : globalThis, function buildProjectSystem(EmployeeConfig) {
  const BALANCE = EmployeeConfig.PROJECT_BALANCE;
  const WORK_IDS = Object.freeze(Object.keys(BALANCE.workTypes));
  const LEGACY_TASKS = Object.freeze(['code', 'ui', 'marketing']);
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const numeric = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? clamp(n, min, max) : fallback;
  };
  const int = (value, fallback, min, max) => Math.floor(numeric(value, fallback, min, max));
  const deadlineOf = id => BALANCE.deadlines.find(item => item.id === id) || BALANCE.deadlines.find(item => item.id === 'standard');
  const templateOf = id => BALANCE.templates[id] || null;
  const safeName = value => {
    if (typeof value !== 'string') return null;
    const name = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, BALANCE.nameMaxLength);
    return name.length >= BALANCE.nameMinLength ? name : null;
  };
  const safeDifficulty = key => EmployeeConfig.DIFFICULTIES[key] ? key : 'medium';

  function normalizedWeights(template, rawWeights) {
    const input = rawWeights && typeof rawWeights === 'object' && !Array.isArray(rawWeights) ? rawWeights : template.workWeights;
    const result = {};
    let total = 0;
    for (const workId of Object.keys(template.workWeights)) {
      const n = Number(input[workId]);
      const weight = Number.isFinite(n) ? clamp(n, 0, 1) : template.workWeights[workId];
      if (weight > 0) { result[workId] = weight; total += weight; }
    }
    if (!total) return { ...template.workWeights };
    for (const key of Object.keys(result)) result[key] /= total;
    return result;
  }

  function buildTargets(totalWork, weights) {
    const ids = Object.keys(weights);
    const targets = {};
    let remaining = totalWork;
    ids.forEach((id, index) => {
      // Last stream absorbs rounding so per-stream targets sum exactly to totalWork.
      const amount = index === ids.length - 1 ? remaining : Math.max(1, Math.round(totalWork * weights[id]));
      targets[id] = Math.min(remaining, amount);
      remaining -= targets[id];
    });
    if (remaining > 0 && ids.length) targets[ids[ids.length - 1]] += remaining;
    return targets;
  }

  function create({ id, templateId, name, deadlineId, startTick, difficultyKey }) {
    const template = templateOf(templateId);
    const projectName = safeName(name);
    const deadline = deadlineOf(deadlineId);
    const difficulty = EmployeeConfig.DIFFICULTIES[safeDifficulty(difficultyKey)];
    const tick = int(startTick, 0, 0, 1e8);
    if (!template || !projectName || !Number.isInteger(id) || id < 1 || id > 1e9) return null;
    const workWeights = normalizedWeights(template);
    const totalWork = clamp(Math.ceil(template.baseWork * deadline.effortMultiplier * difficulty.projectComplexity), 1, BALANCE.maxProjectWork);
    const streamTargets = buildTargets(totalWork, workWeights);
    const workDone = Object.fromEntries(Object.keys(streamTargets).map(key => [key, 0]));
    const qualitySkillPoints = Object.fromEntries(Object.keys(streamTargets).map(key => [key, 0]));
    return {
      id, templateId, name: projectName, deadlineId: deadline.id,
      startedTick: tick, deadlineTick: Math.min(1e8, tick + deadline.days * 24), deadlineDays: deadline.days,
      allowedWork: Object.keys(streamTargets), workWeights, streamTargets, workDone, qualitySkillPoints,
      totalWork: Object.values(streamTargets).reduce((sum, value) => sum + value, 0),
      baseReward: clamp(template.baseReward, 1, BALANCE.maxPayout),
      difficultyRewardMultiplier: clamp(difficulty.projectRewardMultiplier || 1, 0.5, 2),
      onTimeRewardMultiplier: deadline.onTimeRewardMultiplier,
      lateRewardMultiplier: deadline.lateRewardMultiplier,
      outcomes: { ...template.outcomes },
      rewardClaimed: false
    };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const template = templateOf(raw.templateId);
    const name = safeName(raw.name);
    const id = int(raw.id, 0, 1, 1e9);
    if (!template || !name || !id || raw.rewardClaimed === true) return null;

    // Terms are a snapshot: loading an active contract must not recalculate its stage targets
    // from a later balance edit. Only accept the known work streams for this template.
    const templateKeys = Object.keys(template.workWeights);
    const savedTargets = raw.streamTargets && typeof raw.streamTargets === 'object' && !Array.isArray(raw.streamTargets)
      ? raw.streamTargets : null;
    const savedAllowed = Array.isArray(raw.allowedWork)
      ? [...new Set(raw.allowedWork.filter(key => templateKeys.includes(key) && WORK_IDS.includes(key)))] : [];
    let targets = null;
    if (savedTargets && savedAllowed.length === templateKeys.length
      && templateKeys.every(key => savedAllowed.includes(key))) {
      const candidate = {};
      let sum = 0;
      for (const key of templateKeys) {
        const rawTarget = savedTargets[key];
        if (!Number.isInteger(rawTarget) || rawTarget < 1 || rawTarget > BALANCE.maxProjectWork) {
          sum = BALANCE.maxProjectWork + 1;
          break;
        }
        candidate[key] = rawTarget;
        sum += rawTarget;
      }
      if (sum >= 1 && sum <= BALANCE.maxProjectWork) targets = candidate;
    }

    const weights = normalizedWeights(template, raw.workWeights);
    if (!targets) {
      const rawTotal = numeric(raw.totalWork, template.baseWork, 1, BALANCE.maxProjectWork);
      targets = buildTargets(Math.floor(rawTotal), weights);
    }
    const workDone = {};
    const qualitySkillPoints = {};
    for (const key of Object.keys(targets)) {
      workDone[key] = numeric(raw.workDone && raw.workDone[key], 0, 0, targets[key]);
      qualitySkillPoints[key] = numeric(raw.qualitySkillPoints && raw.qualitySkillPoints[key], 0, 0, workDone[key]);
    }
    const deadline = deadlineOf(raw.deadlineId);
    const startedTick = int(raw.startedTick, 0, 0, 1e8);
    const deadlineDays = int(raw.deadlineDays, deadline.days, 1, 365);
    // Derive the absolute deadline from the saved duration so malformed timestamps cannot grant
    // a nearly infinite contract. For valid saves this reproduces the same exact deadline tick.
    const deadlineTick = Math.min(1e8, startedTick + deadlineDays * 24);
    const outcomes = raw.outcomes && typeof raw.outcomes === 'object' ? raw.outcomes : template.outcomes;
    return {
      id, templateId: template.id, name, deadlineId: deadline.id,
      startedTick, deadlineTick, deadlineDays,
      allowedWork: Object.keys(targets), workWeights: weights, streamTargets: targets, workDone, qualitySkillPoints,
      totalWork: Object.values(targets).reduce((sum, value) => sum + value, 0),
      baseReward: numeric(raw.baseReward, template.baseReward, 1, BALANCE.maxPayout),
      difficultyRewardMultiplier: numeric(raw.difficultyRewardMultiplier, 1, 0.5, 2),
      onTimeRewardMultiplier: numeric(raw.onTimeRewardMultiplier, deadline.onTimeRewardMultiplier, 0.1, 2),
      lateRewardMultiplier: numeric(raw.lateRewardMultiplier, deadline.lateRewardMultiplier, 0.1, 2),
      outcomes: {
        product: numeric(outcomes.product, template.outcomes.product, 0, 100),
        reputation: numeric(outcomes.reputation, template.outcomes.reputation, 0, 100),
        customers: int(outcomes.customers, template.outcomes.customers, 0, 1e6)
      },
      rewardClaimed: false
    };
  }

  function progress(project) {
    if (!project || !project.totalWork) return 0;
    const done = Object.keys(project.streamTargets).reduce((sum, key) => sum + Math.min(project.streamTargets[key], project.workDone[key] || 0), 0);
    return clamp(done / project.totalWork * 100, 0, 100);
  }

  /** Progress shown in the top bar: active product build, otherwise the last shipped build. */
  function creationProgress(state) {
    if (!state || typeof state !== 'object') return 0;
    if (state.activeProject) return progress(state.activeProject);
    if (Array.isArray(state.completedProjects) && state.completedProjects.length > 0) return 100;
    // Before the first contract, legacy development tasks still contribute to product readiness.
    return clamp(Number(state.product) || 0, 0, 100);
  }

  function streamProgress(project, workId) {
    const target = project && project.streamTargets && project.streamTargets[workId];
    if (!target) return 0;
    return clamp((project.workDone[workId] || 0) / target * 100, 0, 100);
  }

  function addWork(project, workId, amount, skillLevel) {
    if (!project || !project.streamTargets || !Object.hasOwn(project.streamTargets, workId)) return 0;
    const target = project.streamTargets[workId];
    const done = project.workDone[workId] || 0;
    if (done >= target) return 0;
    const requested = numeric(amount, 0, 0, 1000);
    const accepted = Math.min(requested, target - done);
    if (accepted <= 0) return 0;
    project.workDone[workId] = done + accepted >= target - 1e-7 ? target : done + accepted;
    const level = numeric(skillLevel, 0, 0, 10);
    project.qualitySkillPoints[workId] = Math.min(project.workDone[workId], (project.qualitySkillPoints[workId] || 0) + accepted * level / 10);
    return accepted;
  }

  function isWorkComplete(project, workId) {
    return !!project && Object.hasOwn(project.streamTargets || {}, workId)
      && (project.workDone[workId] || 0) >= project.streamTargets[workId] - 1e-7;
  }

  function isComplete(project) {
    return !!project && Object.keys(project.streamTargets || {}).length > 0
      && Object.keys(project.streamTargets).every(workId => isWorkComplete(project, workId));
  }

  function quality(project) {
    if (!project) return BALANCE.qualityBase;
    let weightedSkill = 0;
    let weightsUsed = 0;
    for (const workId of Object.keys(project.streamTargets || {})) {
      const done = project.workDone[workId] || 0;
      if (done <= 0) continue;
      const coverage = clamp(done / project.streamTargets[workId], 0, 1);
      const weight = (project.workWeights[workId] || 0) * coverage;
      weightedSkill += weight * clamp((project.qualitySkillPoints[workId] || 0) / done, 0, 1);
      weightsUsed += weight;
    }
    const skillScore = weightsUsed > 0 ? weightedSkill / weightsUsed : 0;
    return Math.round(clamp(BALANCE.qualityBase + BALANCE.qualitySkillWeight * skillScore, BALANCE.qualityBase, 100));
  }

  function qualityMultiplier(score) {
    return clamp(BALANCE.qualityRewardMin + clamp(Number(score) || 0, 0, 100) / 100 * BALANCE.qualityRewardRange,
      BALANCE.qualityRewardMin, BALANCE.qualityRewardMin + BALANCE.qualityRewardRange);
  }

  function rewardBreakdown(project, score, late) {
    if (!project) return null;
    const qualityFactor = qualityMultiplier(score);
    const deadlineFactor = late ? project.lateRewardMultiplier : project.onTimeRewardMultiplier;
    const raw = project.baseReward * project.difficultyRewardMultiplier * qualityFactor * deadlineFactor;
    const payout = Math.floor(clamp(Number.isFinite(raw) ? raw : 0, 0, BALANCE.maxPayout));
    return {
      base: project.baseReward,
      quality: Math.round(score),
      qualityMultiplier: qualityFactor,
      deadlineMultiplier: deadlineFactor,
      difficultyMultiplier: project.difficultyRewardMultiplier,
      late: !!late,
      payout
    };
  }

  function outcomes(project, score) {
    const qualityFactor = BALANCE.outcomeQualityBase + clamp(Number(score) || 0, 0, 100) / 100 * BALANCE.outcomeQualityBonus;
    return {
      product: Math.round((project.outcomes.product || 0) * qualityFactor),
      reputation: Math.round((project.outcomes.reputation || 0) * qualityFactor),
      customers: Math.round((project.outcomes.customers || 0) * qualityFactor)
    };
  }

  /** Одноразовая фиксация результата. Повторный вызов для того же проекта не возвращает выплату. */
  function finalize(project, completedTick) {
    if (!project || project.rewardClaimed || !isComplete(project)) return null;
    const tick = int(completedTick, project.startedTick, project.startedTick, 1e8);
    const late = tick > project.deadlineTick;
    const score = quality(project);
    const reward = rewardBreakdown(project, score, late);
    const result = { completedTick: tick, late, quality: score, reward, outcomes: outcomes(project, score) };
    project.rewardClaimed = true;
    return result;
  }

  function bestWorkFor(project, person) {
    if (!project || !person) return null;
    const roleFit = EmployeeConfig.BASE.roles[person.role] && EmployeeConfig.BASE.roles[person.role].fit || {};
    return project.allowedWork
      .filter(workId => !isWorkComplete(project, workId))
      .sort((a, b) => {
        const score = workId => {
          const skillKey = workId === 'backend' ? 'backend' : workId === 'frontend' ? 'frontend' : workId;
          const level = Math.max(0, Number(person.skills && person.skills[skillKey]) || 0);
          const remaining = 1 - streamProgress(project, workId) / 100;
          return remaining * (roleFit[workId] || 0.1) * (level > 0 ? 0.4 + level * 0.12 : 0.4);
        };
        return score(b) - score(a);
      })[0] || null;
  }

  function summary(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const template = templateOf(raw.templateId);
    if (!template) return null;
    return {
      id: int(raw.id, 0, 1, 1e9), templateId: template.id,
      name: safeName(raw.name) || template.name,
      quality: int(raw.quality, BALANCE.qualityBase, BALANCE.qualityBase, 100),
      startedTick: int(raw.startedTick, 0, 0, 1e8),
      deadlineTick: int(raw.deadlineTick, 1, 1, 1e8),
      completedTick: int(raw.completedTick, 1, 1, 1e8),
      late: !!raw.late,
      payout: int(raw.payout, 0, 0, BALANCE.maxPayout),
      baseReward: int(raw.baseReward, template.baseReward, 0, BALANCE.maxPayout),
      qualityMultiplier: numeric(raw.qualityMultiplier, 1, 0, 2),
      deadlineMultiplier: numeric(raw.deadlineMultiplier, 1, 0, 2),
      difficultyMultiplier: numeric(raw.difficultyMultiplier, 1, 0, 2),
      outcomes: {
        product: int(raw.outcomes && raw.outcomes.product, 0, 0, 100),
        reputation: int(raw.outcomes && raw.outcomes.reputation, 0, 0, 100),
        customers: int(raw.outcomes && raw.outcomes.customers, 0, 0, 1e6)
      }
    };
  }

  return Object.freeze({ BALANCE, WORK_IDS, LEGACY_TASKS, safeName, templateOf, deadlineOf, create, normalize, progress, creationProgress,
    streamProgress, addWork, isWorkComplete, isComplete, quality, qualityMultiplier, rewardBreakdown, outcomes, finalize, bestWorkFor, summary });
});
