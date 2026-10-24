/* Изолированный слой форс-мажоров. Конфиг загружается отдельно из force-majeure.json. */
(function (root) {
  'use strict';
  const TYPE = {
    investor: { icon: '💼', label: 'Инвестор', color: '#ffcf4a' },
    employees: { icon: '👥', label: 'Команда', color: '#6db7ff' },
    office: { icon: '🏢', label: 'Офис', color: '#ff7a6b' }
  };
  let config = [], queue = [], active = null, lastTick = -100, tickNo = 0;
  let deps = null, sessionState = null, generation = 0, activePaused = false;
  let loadPromise = null, firstHireHandled = false, pendingFirstHire = false, nextTimer = null;
  const seen = new Set(), deferred = new Map();
  const $ = id => document.getElementById(id);
  const currentState = () => deps && deps.getState ? deps.getState() : sessionState;
  const validSession = () => !!sessionState && currentState() === sessionState;

  function reset() {
    generation++;
    if (nextTimer !== null) clearTimeout(nextTimer);
    for (const timer of deferred.values()) clearTimeout(timer);
    deferred.clear(); seen.clear(); queue = []; active = null;
    nextTimer = null; activePaused = false; firstHireHandled = false; pendingFirstHire = false;
    lastTick = -100; tickNo = 0; sessionState = null; deps = null;
    const modal = $('forceMajeureModal');
    if (modal) modal.hidden = true;
    // Смена игры не должна запускать таймер предыдущей сессии.
    if (document.body) document.body.classList.remove('fm-open');
  }

  function connect(s, callbacks) {
    if (!s || !Array.isArray(s.employees)) return false;
    if (sessionState !== s) { reset(); sessionState = s; }
    if (callbacks) deps = callbacks;
    return validSession();
  }

  function eligible(event, s) {
    const conditions = event.conditions || {};
    return s && Array.isArray(s.employees) && s.employees.length >= Math.max(1, conditions.minEmployees || 1) &&
      (!conditions.minDay || s.day >= conditions.minDay) && (!conditions.minMoney || s.money >= conditions.minMoney) &&
      (!conditions.minRep || s.rep >= conditions.minRep) && (!event.once || !seen.has(event.id));
  }

  function alreadyPending(event) {
    return active?.id === event.id || queue.some(item => item.id === event.id) || deferred.has(event.id);
  }

  function enqueue(source) {
    if (!validSession() || !config.length) return;
    const s = currentState();
    const pool = config.filter(event => eligible(event, s) && !alreadyPending(event)
      && (source === 'hire' || Math.random() < (event.weight || 1) / 40));
    if (!pool.length) return;
    const total = pool.reduce((sum, event) => sum + Math.max(0.01, event.weight || 1), 0);
    let roll = Math.random() * total, chosen = pool[0];
    for (const event of pool) {
      roll -= Math.max(0.01, event.weight || 1);
      if (roll <= 0) { chosen = event; break; }
    }
    queue.push(chosen);
    showNext();
  }

  function showNext() {
    if (active || !validSession()) return;
    const s = currentState();
    queue = queue.filter(event => eligible(event, s));
    if (!queue.length) return;
    active = queue.shift();
    const event = active, epoch = generation;
    const type = TYPE[event.type] || { icon: '⚠️', label: event.type, color: '#ffcf4a' };
    $('fmIcon').textContent = type.icon;
    $('fmType').textContent = type.label;
    $('fmType').style.color = type.color;
    $('fmTitle').textContent = event.title;
    $('fmDescription').textContent = event.description;
    const choices = $('fmChoices'); choices.replaceChildren();
    for (const choice of event.choices) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn'; button.textContent = choice.label;
      button.addEventListener('click', () => resolve(choice, event, epoch));
      const cost = -((choice.effects && choice.effects.money) || 0);
      if (cost > 0 && s.money < cost) { button.disabled = true; button.textContent += ' (не хватает денег)'; }
      choices.appendChild(button);
    }
    const defer = document.createElement('button'); defer.type = 'button'; defer.className = 'btn sec';
    defer.textContent = 'Отложить'; defer.addEventListener('click', () => postpone(event, epoch));
    choices.appendChild(defer);
    const ignore = document.createElement('button'); ignore.type = 'button'; ignore.className = 'btn sec';
    ignore.textContent = 'Игнорировать'; ignore.addEventListener('click', () => close(event, epoch, true));
    choices.appendChild(ignore);
    $('forceMajeureModal').hidden = false;
    activePaused = event.pause !== false && !!(deps && deps.pause);
    if (activePaused) deps.pause(true);
  }

  function isCurrent(event, epoch) {
    return generation === epoch && active === event && validSession();
  }

  function resolve(choice, event, epoch) {
    if (!isCurrent(event, epoch)) return;
    const s = currentState(), effects = choice.effects || {};
    if (effects.money < 0 && s.money < -effects.money) return;
    s.money = Math.max(0, s.money + (effects.money || 0));
    s.rep = Math.max(0, Math.min(100, s.rep + (effects.rep || 0)));
    s.product = Math.max(0, Math.min(100, s.product + (effects.product || 0)));
    for (const employee of s.employees) {
      employee.mood = Math.max(0, Math.min(100, employee.mood + (effects.employeeMood || 0)));
      employee.energy = Math.max(0, Math.min(100, employee.energy + (effects.employeeEnergy || 0)));
    }
    if (deps.onApplied) deps.onApplied(event, choice, effects);
    close(event, epoch, true);
  }

  function close(event, epoch, consumed) {
    if (!isCurrent(event, epoch)) return false;
    if (consumed && event.once) seen.add(event.id);
    const restorePause = activePaused;
    active = null; activePaused = false; $('forceMajeureModal').hidden = true;
    if (restorePause) deps.pause(false);
    if (deps.render) deps.render();
    if (queue.length) {
      nextTimer = setTimeout(() => {
        nextTimer = null;
        if (generation === epoch) showNext();
      }, 0);
    }
    return true;
  }

  function postpone(event, epoch) {
    if (!close(event, epoch, false)) return;
    const timer = setTimeout(() => {
      deferred.delete(event.id);
      if (generation !== epoch || !validSession() || !eligible(event, currentState())) return;
      queue.push(event); showNext();
    }, 30000);
    deferred.set(event.id, timer);
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
    get pending() { return queue.length + deferred.size + (active ? 1 : 0); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
