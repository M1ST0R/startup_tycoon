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
  const SKILLS = Object.freeze({
    backend: Object.freeze({ label: 'Backend', short: 'Backend' }),
    frontend: Object.freeze({ label: 'Frontend', short: 'Frontend' }),
    ui: Object.freeze({ label: 'UI', short: 'UI' }),
    marketing: Object.freeze({ label: 'Маркетинг', short: 'Маркетинг' })
  });

  // Шансы появления суммарно составляют 100%. Можно менять баланс здесь.
  const TIERS = Object.freeze([
    Object.freeze({ id: 1, salary: Object.freeze({ min: 70, max: 109 }), skillCount: Object.freeze({ min: 1, max: 2 }), skillLevel: Object.freeze({ min: 1, max: 4 }), chance: 42 }),
    Object.freeze({ id: 2, salary: Object.freeze({ min: 110, max: 159 }), skillCount: Object.freeze({ min: 1, max: 3 }), skillLevel: Object.freeze({ min: 2, max: 6 }), chance: 28 }),
    Object.freeze({ id: 3, salary: Object.freeze({ min: 160, max: 229 }), skillCount: Object.freeze({ min: 2, max: 3 }), skillLevel: Object.freeze({ min: 3, max: 7 }), chance: 17 }),
    Object.freeze({ id: 4, salary: Object.freeze({ min: 230, max: 329 }), skillCount: Object.freeze({ min: 2, max: 4 }), skillLevel: Object.freeze({ min: 4, max: 9 }), chance: 9 }),
    Object.freeze({ id: 5, salary: Object.freeze({ min: 330, max: 480 }), skillCount: Object.freeze({ min: 3, max: 4 }), skillLevel: Object.freeze({ min: 5, max: 10 }), chance: 4 })
  ]);

  // Какие специализации повышают эффективность существующих задач.
  const TASK_SKILLS = Object.freeze({
    code: Object.freeze(['backend', 'frontend']),
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

  const orderedSkillKeys = Object.keys(SKILLS);
  const safeTier = value => {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  const tierConfig = tier => TIERS[(safeTier(tier) || 1) - 1];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const asLevel = (value, tier) => {
    const range = tierConfig(tier).skillLevel;
    const n = Number(value);
    return clamp(Number.isFinite(n) ? Math.round(n) : range.min, range.min, range.max);
  };

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

  function salaryForTier(tier, random = Math.random) {
    const range = tierConfig(tier).salary;
    return range.min + Math.floor(clamp(Number(random()) || 0, 0, 0.999999999) * (range.max - range.min + 1));
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
    SKILLS, TIERS, TASK_SKILLS, ROLE_WEIGHTS, SPEC_SKILLS,
    tierConfig, safeTier, tierForSalary, salaryForTier, pickTier, generateSkills,
    normalizeEmployeeTraits, taskSkillKey, taskSkillLevel, improveTaskSkill
  });
});
