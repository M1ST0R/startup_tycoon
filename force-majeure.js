/*
 * Изолированный слой форс-мажоров. Конфиг загружается отдельно из force-majeure.json.
 * Показ окон, очередь и пауза игры — в decision-dialog.js (общая очередь с кризисными решениями);
 * здесь остаются только выбор событий, условия и применение последствий.
 *
 * Необязательные хуки в callbacks (для связи с другими системами, без знания о них):
 *   eventWeight(event, baseWeight) → число: подстройка частоты выпадения события;
 *   describe(event) → строка: текст окна вместо event.description;
 *   onResolved(event, { type: 'choice', choice }) — игрок выбрал вариант.
 */
(function (root) {
  'use strict';
  const OWNER = 'force-majeure';
  const TYPE = {
    investor: { icon: '💼', label: 'Инвестор', color: '#ffcf4a' },
    employees: { icon: '👥', label: 'Команда', color: '#6db7ff' },
    office: { icon: '🏢', label: 'Офис', color: '#ff7a6b' }
  };
  let config = [], lastTick = -100, tickNo = 0;
  let deps = null, sessionState = null, generation = 0;
  let loadPromise = null, firstHireHandled = false, pendingFirstHire = false;
  const seen = new Set(), inFlight = new Set();
  const currentState = () => deps && deps.getState ? deps.getState() : sessionState;
  const validSession = () => !!sessionState && currentState() === sessionState;

  function reset() {
    generation++;
    if (deps && deps.dialogs) deps.dialogs.clear(OWNER);
    seen.clear(); inFlight.clear();
    firstHireHandled = false; pendingFirstHire = false;
    lastTick = -100; tickNo = 0; sessionState = null; deps = null;
  }

  function connect(s, callbacks) {
    if (!s || !Array.isArray(s.employees)) return false;
    if (sessionState !== s) { reset(); sessionState = s; }
    if (callbacks) deps = callbacks;
    return validSession() && !!(deps && deps.dialogs);
  }

  function eligible(event, s) {
    const conditions = event.conditions || {};
    return s && Array.isArray(s.employees) && s.employees.length >= Math.max(1, conditions.minEmployees || 1) &&
      (!conditions.minDay || s.day >= conditions.minDay) && (!conditions.minMoney || s.money >= conditions.minMoney) &&
      (!conditions.minRep || s.rep >= conditions.minRep) && (!event.once || !seen.has(event.id));
  }

  const alreadyPending = event => inFlight.has(event.id);

  function weightOf(event) {
    const base = event.weight || 1;
    const custom = deps && deps.eventWeight ? Number(deps.eventWeight(event, base)) : base;
    return Number.isFinite(custom) ? Math.max(0, custom) : base;
  }

  /** Последствия выбора. Платные варианты проверяются до вызова, поэтому баланс не уходит в минус по вине события. */
  function applyEffects(s, effects) {
    s.money += effects.money || 0;
    s.rep = Math.max(0, Math.min(100, s.rep + (effects.rep || 0)));
    s.product = Math.max(0, Math.min(100, s.product + (effects.product || 0)));
    for (const employee of s.employees) {
      employee.mood = Math.max(0, Math.min(100, employee.mood + (effects.employeeMood || 0)));
      employee.energy = Math.max(0, Math.min(100, employee.energy + (effects.employeeEnergy || 0)));
    }
  }

  function resolve(choice, event) {
    if (!validSession()) return false;
    const s = currentState(), effects = choice.effects || {};
    if (effects.money < 0 && s.money < -effects.money) return false;   // не хватает денег — окно остаётся открытым
    applyEffects(s, effects);
    if (event.once) seen.add(event.id);
    if (deps.onApplied) deps.onApplied(event, choice, effects);
    if (deps.onResolved) deps.onResolved(event, { type: 'choice', choice });
    return true;
  }

  function dialogFor(event) {
    return {
      id: event.id, owner: OWNER, priority: 0,
      kind: TYPE[event.type] || { icon: '⚠️', label: event.type, color: '#ffcf4a' },
      title: event.title,
      description: () => (deps && deps.describe && deps.describe(event)) || event.description,
      // Доступность платных вариантов проверяется в момент показа, а не постановки в очередь.
      choices: () => {
        const s = currentState();
        return event.choices.map(choice => {
          const cost = -((choice.effects && choice.effects.money) || 0);
          const short = cost > 0 && s.money < cost;
          return { label: choice.label + (short ? ' (не хватает денег)' : ''), disabled: short, run: () => resolve(choice, event) };
        });
      },
      isValid: () => validSession() && eligible(event, currentState()),
      onDrop: () => inFlight.delete(event.id),
      onClose: () => inFlight.delete(event.id)
    };
  }

  function submit(event) {
    inFlight.add(event.id);
    if (!deps.dialogs.enqueue(dialogFor(event))) inFlight.delete(event.id);
  }

  function enqueue(source) {
    if (!validSession() || !config.length) return;
    const s = currentState();
    const pool = config.filter(event => eligible(event, s) && !alreadyPending(event)
      && (source === 'hire' || Math.random() < weightOf(event) / 40));
    if (!pool.length) return;
    const total = pool.reduce((sum, event) => sum + Math.max(0.01, weightOf(event)), 0);
    let roll = Math.random() * total, chosen = pool[0];
    for (const event of pool) {
      roll -= Math.max(0.01, weightOf(event));
      if (roll <= 0) { chosen = event; break; }
    }
    submit(chosen);
  }

  function init() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const response = await fetch('force-majeure.json', { cache: 'no-cache' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Ожидался массив событий');
        config = data.filter(event => event && typeof event.id === 'string' && Array.isArray(event.choices));
        if (pendingFirstHire && validSession()) {
          pendingFirstHire = false; enqueue('hire');
        }
      } catch (error) { console.error('Не удалось загрузить force-majeure.json', error); }
    })();
    return loadPromise;
  }

  function onTick(s, callbacks) {
    if (!connect(s, callbacks) || !s.employees.length) return;
    tickNo++;
    if (tickNo - lastTick < 8) return;
    const value = deps && deps.getFrequency ? deps.getFrequency() : 1;
    const frequency = Number.isFinite(value) ? Math.max(0, value) : 1;
    if (Math.random() < Math.min(1, 0.12 * frequency)) { lastTick = tickNo; enqueue('tick'); }
  }

  function onHire(s, callbacks) {
    if (!connect(s, callbacks) || s.employees.length !== 1 || firstHireHandled) return;
    firstHireHandled = true;
    if (config.length) enqueue('hire');
    else { pendingFirstHire = true; init(); }
  }

  root.ForceMajeureSystem = Object.freeze({
    init, reset, onTick, onHire,
    get pending() { return inFlight.size; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
