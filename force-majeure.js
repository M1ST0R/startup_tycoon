/* Изолированный слой форс-мажоров. Конфиг загружается отдельно из force-majeure.json. */
(function (root) {
  'use strict';
  const TYPE = {
    investor: { icon: '💼', label: 'Инвестор', color: '#ffcf4a' },
    employees: { icon: '👥', label: 'Команда', color: '#6db7ff' },
    office: { icon: '🏢', label: 'Офис', color: '#ff7a6b' }
  };
  let config = [], queue = [], active = null, lastTick = -100, tickNo = 0, busy = false;
  let deps = null;
  const $ = id => document.getElementById(id);
  async function load() {
    try {
      const r = await fetch('force-majeure.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      config = await r.json();
    } catch (e) { console.error('Не удалось загрузить force-majeure.json', e); }
  }
  function eligible(e, s) {
    const c = e.conditions || {};
    return s && s.employees && s.employees.length >= Math.max(1, c.minEmployees || 1) &&
      (!c.minDay || s.day >= c.minDay) && (!c.minMoney || s.money >= c.minMoney) &&
      (!c.minRep || s.rep >= c.minRep) && (!e.once || !seen.has(e.id));
  }
  const seen = new Set();
  function enqueue(source, s, callbacks) {
    if (!config.length || !s || !s.employees || s.employees.length < 1 || busy) return;
    deps = callbacks || deps;
    const pool = config.filter(e => eligible(e, s) && (source === 'hire' || Math.random() < (e.weight || 1) / 40));
    if (!pool.length) return;
    // Веса определяют относительную вероятность выбора события.
    const total = pool.reduce((n, e) => n + Math.max(0.01, e.weight || 1), 0);
    let roll = Math.random() * total, chosen = pool[0];
    for (const e of pool) { roll -= Math.max(0.01, e.weight || 1); if (roll <= 0) { chosen = e; break; } }
    queue.push(chosen);
    if (chosen.once) seen.add(chosen.id);
    showNext();
  }
  function showNext() {
    if (active || !queue.length) return;
    active = queue.shift();
    const t = TYPE[active.type] || { icon: '⚠️', label: active.type, color: '#ffcf4a' };
    $('fmIcon').textContent = t.icon;
    $('fmType').textContent = t.label;
    $('fmType').style.color = t.color;
    $('fmTitle').textContent = active.title;
    $('fmDescription').textContent = active.description;
    const choices = $('fmChoices'); choices.replaceChildren();
    active.choices.forEach(choice => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn';
      b.textContent = choice.label; b.addEventListener('click', () => resolve(choice)); choices.appendChild(b);
      const st = deps && deps.getState && deps.getState();
      const cost = -((choice.effects && choice.effects.money) || 0);
      if (st && cost > 0 && st.money < cost) { b.disabled = true; b.textContent = choice.label + ' (не хватает денег)'; }
    });
    const defer = document.createElement('button'); defer.type = 'button'; defer.className = 'btn sec';
    defer.textContent = 'Отложить'; defer.addEventListener('click', () => { const ev = active; active = null; $('forceMajeureModal').hidden = true; if (deps && deps.pause) deps.pause(false); if (deps && deps.render) deps.render(); if (queue.length) setTimeout(showNext, 0); setTimeout(() => { queue.push(ev); showNext(); }, 30000); });
    choices.appendChild(defer);
    const ignore = document.createElement('button'); ignore.type = 'button'; ignore.className = 'btn sec';
    ignore.textContent = 'Игнорировать'; ignore.addEventListener('click', () => { close(); });
    choices.appendChild(ignore);
    $('forceMajeureModal').hidden = false;
    if (active.pause !== false && deps && deps.pause) deps.pause(true);
  }
  function resolve(choice) {
    const s = deps && deps.getState && deps.getState();
    if (s) {
      const f = choice.effects || {};
      s.money = Math.max(0, s.money + (f.money || 0));
      s.rep = Math.max(0, Math.min(100, s.rep + (f.rep || 0)));
      s.product = Math.max(0, Math.min(100, s.product + (f.product || 0)));
      (s.employees || []).forEach(e => {
        e.mood = Math.max(0, Math.min(100, e.mood + (f.employeeMood || 0)));
        e.energy = Math.max(0, Math.min(100, e.energy + (f.employeeEnergy || 0)));
      });
      if (deps.onApplied) deps.onApplied(active, choice, f);
    }
    close();
  }
  function close() {
    active = null; $('forceMajeureModal').hidden = true;
    if (deps && deps.pause) deps.pause(false);
    if (deps && deps.render) deps.render();
    if (queue.length) setTimeout(showNext, 0);
  }
  function init() { return load(); }
  function onTick(s, callbacks) {
    tickNo++;
    if (tickNo - lastTick < 8) return;
    if (Math.random() < 0.12) { lastTick = tickNo; enqueue('tick', s, callbacks); }
  }
  function onHire(s, callbacks) { enqueue('hire', s, callbacks); }
  root.ForceMajeureSystem = { init, onTick, onHire, get pending() { return queue.length + (active ? 1 : 0); } };
})(window);
