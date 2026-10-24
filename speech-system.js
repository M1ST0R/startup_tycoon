'use strict';

/*
 * StartupSpeechSystem
 * Изолированная система реактивных реплик. Не изменяет игровую прогрессию,
 * а только читает состояние игры, добавляет записи в журнал и рисует облачко.
 * Совместима с текущей архитектурой обычных <script> без ES-модулей.
 */
(function attachStartupSpeechSystem(root) {
  const CONFIG = Object.freeze({
    bubbleDurationMs: 4400,
    queueGapMs: 450,
    maxQueue: 3,
    queuedMessageTtlMs: 18000,
    employeeCooldownTicks: 6,
    ambientChance: 0.006,
    recentLimit: 14
  });

  const PRIORITY = Object.freeze({
    budgetCritical: 11, failure: 10, taskSuccess: 10, rest: 9, lowMood: 8,
    moneyLow: 8, budgetWarning: 7, taskStart: 7, skillUp: 7,
    progress75: 7, energyLow: 6, clientGrowth: 6, reputation: 6,
    moodRecovered: 4, energyRecovered: 4, progress50: 5,
    progress25: 4, productProgress: 5, taskWork: 2, idle: 2,
    officeRare: 2, officeChatter: 1, hire: 7, budgetRecovered: 7
  });

  function create(deps) {
    let active = null;
    let queue = [];
    let displayTimer = null;
    let gapTimer = null;
    let lastEnqueueAt = 0;
    const snapshots = new Map();
    const lastSpoken = new Map();
    let lastBudgetBand = null;
    let lastProductBand = null;

    // Здесь находятся частота реплик и параметры очереди; тексты/вероятности категорий — в office-dialogue.js.
    const state = () => deps.getState();
    const currentTick = () => deps.gameTickIndex();
    const taskWork = task => deps.getTaskWork ? deps.getTaskWork(task) : task.work;
    const visibleEmployees = () => (state()?.employees || [])
      .filter(person => !deps.isEmployeeVisible || deps.isEmployeeVisible(person));
    const draw = () => {
      if (deps.isVisible()) deps.renderOffice();
    };

    function addRecentSpeech(id) {
      const s = state();
      if (!s || !s.flavor || !id) return;
      s.flavor.recent.unshift(id);
      s.flavor.recent = s.flavor.recent.slice(0, deps.dialogue.CONFIG.recentLimit || CONFIG.recentLimit);
    }

    function budgetBand() {
      const s = state();
      if (!s) return 0;
      const burn = Math.max(1, deps.dailyCosts());
      if (s.money < burn) return 0;
      if (s.money < burn * 2) return 1;
      if (s.money < burn * 4) return 2;
      return 3;
    }

    function productBand() {
      const s = state();
      return s ? Math.min(4, Math.floor(s.product / 25)) : 0;
    }

    function makeSnapshot(person) {
      const tasks = deps.getConfig().tasks;
      const task = person.task && tasks[person.task] ? tasks[person.task] : null;
      const progressPct = task ? Math.max(0, Math.min(100, person.progress / taskWork(task) * 100)) : 0;
      return {
        energy: person.energy,
        mood: person.mood,
        task: person.task,
        status: person.status,
        progressBand: progressPct >= 75 ? 3 : progressPct >= 50 ? 2 : progressPct >= 25 ? 1 : 0,
        skill: person.skill,
        idleTicks: 0
      };
    }

    function syncEmployee(person) {
      if (!person) return;
      const next = makeSnapshot(person);
      next.idleTicks = !person.task && person.status === 'idle' ? 1 : 0;
      snapshots.set(person.id, next);
    }

    function clear() {
      if (displayTimer !== null) clearTimeout(displayTimer);
      if (gapTimer !== null) clearTimeout(gapTimer);
      displayTimer = null;
      gapTimer = null;
      active = null;
      queue = [];
      snapshots.clear();
      lastSpoken.clear();
      lastBudgetBand = null;
      lastProductBand = null;
      draw();
    }

    function seed() {
      clear();
      const s = state();
      if (s) {
        s.employees.forEach(syncEmployee);
        lastBudgetBand = budgetBand();
        lastProductBand = productBand();
      }
    }

    function removeEmployee(employeeId) {
      snapshots.delete(employeeId);
      lastSpoken.delete(employeeId);
      queue = queue.filter(item => item.employeeId !== employeeId);
      if (active && active.employeeId === employeeId) {
        if (displayTimer !== null) clearTimeout(displayTimer);
        displayTimer = null;
        active = null;
        showNext();
      }
    }

    function context(person, task) {
      const s = state();
      if (!s) return {};
      const burn = Math.max(1, deps.dailyCosts());
      const progress = person && task ? Math.min(100, Math.floor(person.progress / taskWork(task) * 100)) : 0;
      const roles = deps.getConfig().roles;
      return {
        employeeId: person && Number.isSafeInteger(person.id) ? person.id : null,
        name: person && person.name ? person.name : 'Команда',
        task: task && task.name ? task.name : 'важная задача',
        role: person && roles[person.role] ? roles[person.role].name : 'специалист',
        spec: person && person.spec ? person.spec : 'универсальный профиль',
        money: deps.formatMoney(s.money),
        budgetDays: (s.money / burn).toFixed(1),
        mood: person ? Math.round(person.mood) : 0,
        energy: person ? Math.round(person.energy) : 0,
        progress,
        skill: person ? Number(person.skill).toFixed(1) : '1.0',
        rep: Math.floor(s.rep),
        customers: s.customers
      };
    }

    function speakerForPriority(priority = 1) {
      const people = visibleEmployees();
      if (!people.length) return null;
      const tick = currentTick();
      const eligible = people.filter(person => {
        const previous = lastSpoken.get(person.id);
        return !previous || previous.tick !== tick || priority > previous.priority;
      });
      const selected = deps.getSelected();
      if (!eligible.length) return people.includes(selected) ? selected : deps.pick(people);
      return selected && eligible.includes(selected) ? selected : deps.pick(eligible);
    }

    function remember(item) {
      const tick = currentTick();
      lastSpoken.set(item.employeeId, { tick, priority: item.priority });
    }

    function isEmployeeAvailable(employeeId) {
      const s = state();
      return !!(s && visibleEmployees().some(person => person.id === employeeId));
    }

    function syncVisibility() {
      queue = queue.filter(item => isEmployeeAvailable(item.employeeId));
      if (active && !isEmployeeAvailable(active.employeeId)) {
        if (displayTimer !== null) clearTimeout(displayTimer);
        displayTimer = null;
        active = null;
      }
      if (!active) {
        if (gapTimer !== null) clearTimeout(gapTimer);
        gapTimer = null;
        showNext();
      }
    }

    function showNext() {
      if (active || !state()) return;
      const now = Date.now();
      queue = queue
        .filter(item => item.expiresAt > now && isEmployeeAvailable(item.employeeId))
        .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
      if (!queue.length) { draw(); return; }
      active = queue.shift();
      active.expiresAt = Date.now() + active.duration;
      draw();
      displayTimer = setTimeout(() => {
        displayTimer = null;
        active = null;
        draw();
        gapTimer = setTimeout(() => {
          gapTimer = null;
          showNext();
        }, CONFIG.queueGapMs);
      }, active.duration);
    }

    function enqueue(person, text, options = {}) {
      if (!deps.isVisible() || !person || !Number.isSafeInteger(person.id) || !text || !isEmployeeAvailable(person.id)) return false;
      const now = Date.now();
      const priority = Number.isFinite(options.priority) ? options.priority : 1;
      const item = {
        employeeId: person.id,
        text: String(text).slice(0, 160),
        priority,
        createdAt: now,
        expiresAt: now + CONFIG.queuedMessageTtlMs,
        duration: Number.isFinite(options.duration) ? Math.max(1800, Math.min(8000, options.duration)) : CONFIG.bubbleDurationMs
      };

      // Не копим несколько реплик одного сотрудника; более важная может заменить ожидающую.
      const oldIndex = queue.findIndex(entry => entry.employeeId === person.id);
      if (oldIndex >= 0) {
        if (queue[oldIndex].priority >= priority) return false;
        queue.splice(oldIndex, 1);
      }

      if (!active) {
        queue.push(item);
        showNext();
        return true;
      }

      if (queue.length >= CONFIG.maxQueue) {
        let lowest = 0;
        for (let i = 1; i < queue.length; i++) {
          if (queue[i].priority < queue[lowest].priority) lowest = i;
        }
        if (queue[lowest].priority >= priority) return false;
        queue.splice(lowest, 1);
      }
      queue.push(item);
      return true;
    }

    function showCharacterLine(person, category, values = {}, options = {}) {
      const s = state();
      if (!s || !person || !Number.isSafeInteger(person.id)) return false;
      const tick = currentTick();
      const priority = Number.isFinite(options.priority) ? options.priority : (PRIORITY[category] || 1);
      const previous = lastSpoken.get(person.id);
      const forced = !!options.force;
      const cooldown = CONFIG.employeeCooldownTicks;
      if (previous) {
        if (previous.tick === tick && priority <= previous.priority) return false;
        if (!forced && previous.tick !== tick && tick - previous.tick < cooldown) return false;
      }
      const entry = deps.dialogue.renderSpeech(category, values, s.flavor ? s.flavor.recent : []);
      if (!entry || !entry.text) return false;

      // Если активна реплика этого же персонажа, не даём повторно запланировать обычную.
      if (active && active.employeeId === person.id && priority <= active.priority) return false;
      const queued = enqueue(person, entry.text, { priority, duration: options.duration });
      if (!queued) return false;
      addRecentSpeech(entry.id);
      remember({ employeeId: person.id, priority });
      return true;
    }

    function flavor(category, values = {}, options = {}) {
      const s = state();
      const cfg = deps.dialogue.CONFIG;
      const rule = cfg.categories[category];
      if (!rule || !s || !s.flavor) return false;
      const tick = currentTick();
      const lastCategory = Number.isFinite(s.flavor.cooldowns[category]) ? s.flavor.cooldowns[category] : -1000;
      const forced = !!options.force;
      if (!forced) {
        if (tick - s.flavor.lastTick < cfg.minGlobalTicks) return false;
        if (Math.random() >= rule.chance) return false;
      }

      const target = Number.isSafeInteger(values.employeeId)
        ? s.employees.find(person => person.id === values.employeeId)
        : speakerForPriority();

      if (tick - lastCategory < rule.cooldown) {
        if (forced) showCharacterLine(target, category, values, { force: true });
        return false;
      }

      const entry = deps.dialogue.render(category, values, s.flavor.recent);
      if (!entry) return false;
      showCharacterLine(target, category, values, { force: forced });
      s.flavor.lastTick = tick;
      s.flavor.cooldowns[category] = tick;
      addRecentSpeech(entry.id);
      deps.log(entry.text, options.type || 'info');
      deps.markDirty();
      return true;
    }

    function evaluateReactions() {
      const s = state();
      if (!s) return;
      const tick = currentTick();
      const employeeCandidates = [];

      for (const person of s.employees) {
        const previous = snapshots.get(person.id);
        const next = makeSnapshot(person);
        const isIdle = !person.task && person.status === 'idle';
        next.idleTicks = isIdle
          ? (previous && previous.task === null && previous.status === 'idle' ? previous.idleTicks + 1 : 1)
          : 0;
        if (!previous) {
          snapshots.set(person.id, next);
          continue;
        }
        const options = [];
        const add = (category, priority) => options.push({ category, priority });
        if (previous.status !== 'rest' && person.status === 'rest') add('rest', 9);
        if (previous.energy >= 25 && person.energy < 25) add('energyLow', 7);
        else if (previous.energy >= 40 && person.energy < 40) add('energyLow', 6);
        if (previous.mood >= 30 && person.mood < 30) add('lowMood', 8);
        else if (previous.mood >= 45 && person.mood < 45) add('lowMood', 6);
        if (previous.task === person.task && person.task && next.progressBand > previous.progressBand) {
          const category = next.progressBand >= 3 ? 'progress75' : next.progressBand === 2 ? 'progress50' : 'progress25';
          add(category, next.progressBand >= 3 ? 7 : next.progressBand === 2 ? 5 : 4);
        }
        if (Math.floor(person.skill) > Math.floor(previous.skill)) add('skillUp', 7);
        if (previous.energy < 85 && person.energy >= 85) add('energyRecovered', 4);
        if (previous.mood < 75 && person.mood >= 75) add('moodRecovered', 4);
        if (next.idleTicks >= 5 && previous.idleTicks < 5) add('idle', 3);
        snapshots.set(person.id, next);
        if (options.length) {
          options.sort((a, b) => b.priority - a.priority);
          employeeCandidates.push({ person, ...options[0] });
        }
      }

      // Ставим реакции в очередь, сортировка очереди сама обеспечит приоритеты.
      employeeCandidates.sort((a, b) => b.priority - a.priority);
      for (const item of employeeCandidates) {
        showCharacterLine(item.person, item.category,
          context(item.person, item.person.task ? deps.getConfig().tasks[item.person.task] : null),
          { priority: item.priority, force: true });
      }

      const currentBand = budgetBand();
      if (lastBudgetBand === null) lastBudgetBand = currentBand;
      if (currentBand !== lastBudgetBand && s.employees.length) {
        let category = null, priority = 0;
        if (currentBand < lastBudgetBand) {
          category = currentBand === 0 ? 'budgetCritical' : currentBand === 1 ? 'moneyLow' : 'budgetWarning';
          priority = currentBand === 0 ? 11 : currentBand === 1 ? 8 : 7;
        } else if (currentBand > lastBudgetBand && lastBudgetBand <= 1) {
          category = 'budgetRecovered'; priority = 7;
        }
        if (category) {
          const target = speakerForPriority(priority);
          showCharacterLine(target, category, context(target), { priority, force: true });
        }
      }
      lastBudgetBand = currentBand;

      const currentProductBand = productBand();
      if (currentProductBand > (lastProductBand === null ? currentProductBand : lastProductBand) && s.employees.length) {
        const target = speakerForPriority(PRIORITY.productProgress);
        showCharacterLine(target, 'productProgress', { ...context(target), product: Math.floor(s.product) },
          { priority: PRIORITY.productProgress, force: true });
      }
      lastProductBand = currentProductBand;

      // Случайная офисная болтовня редкая и не запускается, когда есть важная реакция.
      if (!employeeCandidates.length && s.employees.length && Math.random() < CONFIG.ambientChance && queue.length === 0 && !active) {
        const eligible = visibleEmployees().filter(person => {
          const meta = lastSpoken.get(person.id);
          return !meta || tick - meta.tick >= CONFIG.employeeCooldownTicks;
        });
        if (eligible.length) {
          const person = deps.pick(eligible);
          const category = person.mood < 40 ? 'lowMood'
            : person.energy < 40 ? 'energyLow'
              : person.status === 'rest' ? 'rest'
                : !person.task ? 'idle' : 'officeChatter';
          showCharacterLine(person, category,
            context(person, person.task ? deps.getConfig().tasks[person.task] : null), { priority: 1 });
        }
      }
    }

    function resume() {
      const s = state();
      if (!s || !deps.isVisible() || !s.employees.length) return;
      const people = visibleEmployees();
      const person = people.includes(deps.getSelected()) ? deps.getSelected() : people[0];
      if (!person) return;
      const category = person.status === 'rest' ? 'rest'
        : person.mood < 35 ? 'lowMood'
          : person.energy < 35 ? 'energyLow'
            : person.task ? 'taskWork' : 'idle';
      showCharacterLine(person, category,
        context(person, person.task ? deps.getConfig().tasks[person.task] : null),
        { force: true, priority: 3 });
    }

    function getBubble(employeeId) {
      if (!active || active.employeeId !== employeeId || active.expiresAt <= Date.now()) return null;
      return { text: active.text, expiresAt: active.expiresAt };
    }

    return Object.freeze({
      CONFIG,
      seed,
      clear,
      syncEmployee,
      removeEmployee,
      syncVisibility,
      context,
      showCharacterLine,
      speakerForPriority,
      flavor,
      evaluateReactions,
      resume,
      getBubble,
    });
  }

  root.StartupSpeechSystem = Object.freeze({ CONFIG, create });
})(typeof window !== 'undefined' ? window : globalThis);
