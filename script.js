'use strict';

/* =====================================================================
   1. СПРАЙТЫ — всё, что нужно для замены картинок, находится здесь.
   Укажите путь к PNG в поле img (например 'img/dev.png'), и игра
   подставит его вместо emoji. Пустая строка = встроенная emoji-заглушка.
   Если файл не найден, игра сама вернётся к emoji.
   ===================================================================== */
const SPRITES = {
  roles: {                       // сотрудники в офисе (рекомендуется 48×48 px)
    dev:      { img: '', emoji: '🧑‍💻' },
    designer: { img: '', emoji: '🧑‍🎨' },
    marketer: { img: '', emoji: '🧑‍💼' }
  },
  bubbles: {                     // значок над сотрудником: задача или состояние
    code:      { img: '', emoji: '💻' },
    ui:        { img: '', emoji: '🎨' },
    marketing: { img: '', emoji: '📣' },
    rest:      { img: '', emoji: '☕' },
    idle:      { img: '', emoji: '💤' }
  }
};

/* =====================================================================
   2. БАЛАНС — единая конфигурация находится в employee-config.js.
   Здесь остаются только ссылки на конфиг, чтобы игровая логика не дублировала числа.
   ===================================================================== */
const C = EmployeeConfig.BASE;
const DIFFICULTIES = EmployeeConfig.DIFFICULTIES;
const STATUS = { work: 'Работает', rest: 'Отдыхает', idle: 'Бездействует' };
const KEY = 'startupTycoon.save.v1';   // ключ СТАРОГО локального сохранения (используется только для импорта)

/* =====================================================================
   3. СОСТОЯНИЕ ИГРЫ
   ===================================================================== */
let S;                 // текущее состояние (сохраняется целиком)
let timer = null, paused = false, tickCount = 0, officePage = 0;
let fmPausedBefore = false, fmPauseActive = false;
let pendingDifficulty = 'medium', difficultyResetMode = false;
// Система реплик вынесена в speech-system.js; здесь остаётся только интеграция с игрой.

const num = (v, def, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const portrait = (person, mode) => CharacterArt.portrait(person, mode);
const fmt = n => '$' + Math.floor(n).toLocaleString('ru-RU');
const $ = id => document.getElementById(id);
const sel = () => S.employees.find(e => e.id === S.selected) || null;
const timeStr = () => `День ${S.day}, ${String(S.hour).padStart(2, '0')}:00`;
const rentCost = () => EmployeeConfig.rentForDesks(S.desks, S.difficulty);
const salaries = () => S.employees.reduce((s, e) => s + e.salary, 0);
const incomeTick = () => S ? EmployeeConfig.incomePerTick(S.customers, S.product, S.difficulty) : 0;
const hireCost = candidate => EmployeeConfig.hireCost(candidate.salary, S.difficulty);
const candidateRefreshCost = () => EmployeeConfig.actionCost('refresh', S.difficulty);
const deskUpgradeCost = () => EmployeeConfig.actionCost('desk', S.difficulty);

function defaultFlavorState() {
  return { lastTick: -1000, cooldowns: {}, recent: [] };
}

function newState() {
  return { v: 1, difficulty: 'medium', money: DIFFICULTIES.medium.startingMoney, rep: 0, product: 0, customers: 0, day: 1, hour: 9, speed: 1,
           desks: C.startDesks, nextId: 1, employees: [], candidates: [], log: [], won: false, selected: null, rescueUsed: false,
           flavor: defaultFlavorState() };
}

/** Добавляет запись в журнал событий (новые сверху). Весь текст выводится как textContent. */
function log(text, type = 'info') {
  S.log.unshift({ t: timeStr(), text: String(text).slice(0, 200), type });
  if (S.log.length > C.logMax) S.log.length = C.logMax;
}

function gameTickIndex() {
  return S ? (S.day - 1) * 24 + S.hour : 0;
}

function dailyCosts() {
  return S ? rentCost() + salaries() : 1;
}

function difficultyConfig() { return DIFFICULTIES[S && DIFFICULTIES[S.difficulty] ? S.difficulty : 'medium']; }
function goalForDifficulty() { return difficultyConfig().goal; }
function taskWork(task) { return Math.ceil(task.work * difficultyConfig().projectComplexity); }

/* Реактивные реплики вынесены в отдельный модуль. Эти обёртки сохраняют
   прежние точки вызова игры и не дублируют логику очереди/порогов. */
const Speech = StartupSpeechSystem.create({
  getState: () => S,
  getConfig: () => C,
  getSelected: () => sel(),
  getTaskWork: taskWork,
  isEmployeeVisible: person => Math.floor(person.desk / 4) === officePage,
  gameTickIndex,
  dailyCosts,
  formatMoney: fmt,
  pick,
  dialogue: StartupOfficeDialogue,
  log: (text, type) => log(text, type),
  markDirty: () => { if (API) API.dirty = true; },
  isVisible: () => !!(S && !$('gameView').hidden && $('difficultySetup').hidden && $('forceMajeureModal').hidden),
  renderOffice: () => renderOffice()
});

function syncEmployeeReaction(person) { Speech.syncEmployee(person); }
function seedReactionState() { Speech.seed(); }
function showCharacterLine(person, category, values = {}, options = {}) {
  return Speech.showCharacterLine(person, category, values, options);
}
function showResumeBubble() { Speech.resume(); }
function flavor(category, values = {}, options = {}) { return Speech.flavor(category, values, options); }
function flavorContext(person, task) { return Speech.context(person, task); }
function evaluateReactions() { Speech.evaluateReactions(); }

function normalizeFlavorState(raw) {
  const result = defaultFlavorState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  result.lastTick = Math.floor(num(raw.lastTick, -1000, -1e9, 1e9));
  if (raw.cooldowns && typeof raw.cooldowns === 'object' && !Array.isArray(raw.cooldowns)) {
    Object.entries(raw.cooldowns).slice(0, 32).forEach(([key, value]) => {
      if (/^[a-zA-Z][a-zA-Z0-9]*$/u.test(key)) result.cooldowns[key] = Math.floor(num(value, -1000, -1e9, 1e9));
    });
  }
  result.recent = Array.isArray(raw.recent)
    ? raw.recent.slice(0, StartupOfficeDialogue.CONFIG.recentLimit).filter(x => typeof x === 'string').map(x => x.slice(0, 80))
    : [];
  return result;
}

/* =====================================================================
   4. СОТРУДНИКИ И РАСЧЁТ ЗАДАЧ
   ===================================================================== */
/** Создаёт кандидата с тиром, случайным набором специализаций и окладом из диапазона тира. */
function genCandidate() {
  const role = pick(Object.keys(C.roles)), R = C.roles[role];
  const spec = pick(R.specs);
  const tier = EmployeeConfig.pickTier();
  const skills = EmployeeConfig.generateSkills(role, tier, Math.random, spec);
  const skill = Math.max(1, ...Object.values(skills)); // Совместимость со старым полем опыта в репликах.
  const salary = EmployeeConfig.salaryForTier(tier, Math.random, S.difficulty);
  const taken = new Set([...S.employees, ...S.candidates].map(p => p.name).filter(Boolean));
  const gender = pick(['male', 'female']);
  const spriteIndex = pick(CharacterArt.spriteIndices[gender]);
  const appearance = { hair: Math.floor(spriteIndex / 3), cloth: spriteIndex % 3, sprite: spriteIndex };
  return { id: S.nextId++, gender, appearance, name: StartupNameGenerator.generate(taken, gender), role, spec,
           tier, skills, skill, salary, speed: +(0.8 + Math.random() * 0.4).toFixed(2),
           energy: 100, mood: rnd(60, 90), task: null, progress: 0, status: 'idle', desk: -1 };
}

/** Эффективность зависит от роли и подходящего навыка; энергия и настроение сохраняют прежние модификаторы. */
function efficiency(e, taskId) {
  const matchedLevel = EmployeeConfig.taskSkillLevel(e, taskId);
  const skillFactor = matchedLevel > 0 ? 0.4 + matchedLevel * 0.12 : 0.4;
  return C.baseSpeed * difficultyConfig().employeeSpeed * e.speed * C.roles[e.role].fit[taskId] * skillFactor
       * (0.4 + 0.6 * e.energy / 100) * (0.5 + 0.5 * e.mood / 100);
}

/** Предупреждения о состоянии сотрудника. */
function warnings(e) {
  const w = [];
  if (e.energy < 25) w.push('Устал: работает медленнее');
  if (e.mood < 30) w.push('Недоволен: работает медленнее');
  if (e.status === 'idle') w.push('Простаивает: назначьте задачу');
  return w;
}

/** Результат завершённой задачи. */
function completeTask(e, t) {
  const p0 = S.product, r0 = S.rep, c0 = S.customers, skill0 = e.skill;
  const skillGrowth = EmployeeConfig.improveTaskSkill(e, t.id);
  const taskLevel = EmployeeConfig.taskSkillLevel(e, t.id);
  e.skill = Math.min(10, e.skill + 0.12); // Оставляем legacy-опыт для совместимости с существующими репликами.
  e.mood = Math.min(100, e.mood + 3);
  let msg;
  if (t.id === 'code') {
    S.product = Math.min(100, S.product + 4 + taskLevel * 0.4);
    if (p0 >= 100) S.rep = Math.min(100, S.rep + 0.3);
    msg = p0 >= 100 ? 'продукт полностью готов, репутация +0.3' : `продукт +${(S.product - p0).toFixed(1)}%`;
  } else if (t.id === 'ui') {
    S.rep = Math.min(100, S.rep + 1 + taskLevel * 0.15);
    S.product = Math.min(100, S.product + 1);
    msg = `репутация +${(S.rep - r0).toFixed(1)}`;
  } else {
    const g = Math.max(1, Math.round((3 + taskLevel * 1.2) * (0.25 + S.product / 100) * (1 + S.rep / 100)));
    const added = Math.min(g, Math.max(0, C.maxCustomers - S.customers));
    S.customers += added;
    msg = `клиенты +${added}`;
  }
  if (skillGrowth && skillGrowth.improved) {
    log(`${e.name} улучшил навык «${EmployeeConfig.SKILLS[skillGrowth.key].label}»: ${skillGrowth.next}/10`, 'good');
  }
  log(`${e.name} завершил «${t.name}»: ${msg}`, 'good');
  flavor('taskSuccess', flavorContext(e, t), { type: 'good', force: true });
  if (Math.floor(S.product / 25) > Math.floor(p0 / 25)) log(`Продукт готов на ${Math.floor(S.product)}%`, 'good');
  if (Math.floor(S.rep / 10) > Math.floor(r0 / 10)) log(`Репутация выросла до ${Math.floor(S.rep)}`, 'good');
  if (S.rep > r0) flavor('reputation', flavorContext(e, t), { type: 'good' });
  if (Math.floor(S.customers / 25) > Math.floor(c0 / 25)) log(`Уже ${S.customers} клиентов!`, 'good');
  if (S.customers > c0) flavor('clientGrowth', flavorContext(e, t), { type: 'good' });
  if (Math.floor(e.skill) > Math.floor(skill0)) flavor('skillUp', flavorContext(e, t), { type: 'good' });
}

/** Один тик работы сотрудника: работа, отдых или простой. */
function workEmployee(e) {
  const en0 = e.energy, mo0 = e.mood;
  if (e.status === 'rest') {
    e.energy = Math.min(100, e.energy + C.restEnergy);
    e.mood = Math.min(100, e.mood + 0.4);
    if (e.energy >= C.resumeAt) {
      e.status = e.task ? 'work' : 'idle';
      log(`${e.name} отдохнул${e.task ? ' и вернулся к задаче' : ''}`, 'good');
      flavor('rest', flavorContext(e, e.task ? C.tasks[e.task] : null), { type: 'good' });
    }
  } else if (!e.task) {
    e.status = 'idle';
    e.energy = Math.min(100, e.energy + C.idleEnergy);
    e.mood = Math.max(0, e.mood - 0.25);
    flavor('idle', flavorContext(e), { type: 'info' });
  } else {
    e.status = 'work';
    e.energy = Math.max(0, e.energy - C.workEnergy);
    e.mood = e.energy < 25 ? Math.max(0, e.mood - 0.6) : Math.min(100, e.mood + 0.05);
    if (e.energy <= C.autoRestBelow) {
      e.status = 'rest';
      log(`${e.name} выбился из сил и ушёл отдыхать`, 'warn');
      flavor('rest', flavorContext(e, e.task ? C.tasks[e.task] : null), { type: 'warn' });
    } else {
      const t = C.tasks[e.task];
      e.progress += efficiency(e, e.task);
      flavor('taskWork', flavorContext(e, t), { type: 'info' });
      const requiredWork = taskWork(t);
      if (e.progress >= requiredWork) { e.progress -= requiredWork; completeTask(e, t); }
    }
  }
  if (en0 >= 25 && e.energy < 25) {
    log(`${e.name} устал`, 'warn');
    flavor('rest', flavorContext(e, e.task ? C.tasks[e.task] : null), { type: 'warn' });
  }
  if (mo0 >= 30 && e.mood < 30) {
    log(`${e.name} недоволен`, 'warn');
    flavor('lowMood', flavorContext(e, e.task ? C.tasks[e.task] : null), { type: 'warn' });
  }
}

/* =====================================================================
   5. ИГРОВЫЕ ТИКИ И ДЕЙСТВИЯ ИГРОКА
   ===================================================================== */
/** Раз в сутки: аренда и зарплаты. Деньги никогда не уходят в минус. */
function payDay() {
  let paid = 0, missed = 0;
  const rent = rentCost();
  if (S.money >= rent) { S.money -= rent; paid += rent; }
  else {
    S.rep = Math.max(0, S.rep - 1); missed++;
    log('Нечем платить за аренду офиса', 'bad');
    flavor('failure', { ...flavorContext(null), name: 'Финансовый отдел', reason: 'аренду нечем оплачивать' }, { type: 'bad' });
  }
  S.employees.forEach(e => {
    if (S.money >= e.salary) { S.money -= e.salary; paid += e.salary; }
    else {
      e.mood = Math.max(0, e.mood - 15); S.rep = Math.max(0, S.rep - 1); missed++;
      log(`Не хватило денег на зарплату: ${e.name}`, 'bad');
      flavor('failure', { ...flavorContext(e), reason: 'зарплата не поместилась в бюджет' }, { type: 'bad' });
    }
  });
  log(`Конец дня: выплачено ${fmt(paid)}`, missed ? 'bad' : 'info');
  // Одноразовый спасательный контракт защищает кампанию от безвыходного состояния:
  // без сотрудников и почти без денег игрок иначе не может ни работать, ни нанимать.
  if (!S.rescueUsed && S.employees.length === 0 && S.money < C.rescueThreshold) {
    S.money = Math.min(C.maxMoney, S.money + C.rescueGrant);
    S.rescueUsed = true;
    log(`🛟 Антикризисный контракт: +${fmt(C.rescueGrant)}. Используйте резерв, чтобы нанять сотрудника и восстановить доход.`, 'good');
  }
  if (S.money < (rent + salaries()) * 2) {
    log('Денег хватит меньше чем на 2 дня расходов', 'warn');
    flavor('moneyLow', flavorContext(null), { type: 'warn' });
  }
}

function checkGoal() {
  const goal = goalForDifficulty();
  if (!S.won && S.customers >= goal.customers && S.rep >= goal.reputation) {
    S.won = true;
    log('🏆 Цель достигнута: ваш стартап стал успешной компанией! Можно играть дальше.', 'good');
  }
}

function resetForceMajeure() {
  ForceMajeureSystem.reset();
  if (fmPauseActive) paused = fmPausedBefore;
  fmPauseActive = false;
  document.body.classList.remove('fm-open');
}

function forceMajeureDeps() {
  return {
    getState: () => S,
    getFrequency: () => difficultyConfig().forceMajeureFrequency,
    pause: value => {
      if (value && !fmPauseActive) {
        fmPausedBefore = paused; fmPauseActive = true; paused = true;
        document.body.classList.add('fm-open');
      } else if (!value && fmPauseActive) {
        paused = fmPausedBefore; fmPauseActive = false;
        document.body.classList.remove('fm-open');
      }
      restartTimer();
    },
    render: () => { if (S) render(); },
    onApplied: (event, choice) => {
      API.dirty = true;
      log(`Форс-мажор «${event.title}»: ${choice.label}`, 'warn');
      scheduleSave();
    }
  };
}

function tick() {
  if (!S || paused || !$('difficultySetup').hidden) return;
  try {
    ForceMajeureSystem.onTick(S, forceMajeureDeps());
    if (paused) return;
    S.hour++;
    if (S.hour >= 24) { S.hour = 0; S.day++; payDay(); }
    S.employees.forEach(workEmployee);
    S.money = Math.min(C.maxMoney, Math.max(0, S.money + incomeTick()));
    evaluateReactions();
    if (Math.random() < StartupOfficeDialogue.CONFIG.rareTickChance) {
      const chosen = sel();
      flavor('officeRare', chosen ? flavorContext(chosen) : {}, { type: 'info' });
    }
    checkGoal();
    API.dirty = true;
    if (++tickCount % C.autosaveTicks === 0) save(true);
    render();
  } catch (err) { console.error('Ошибка тика:', err); }
}

function restartTimer() {
  clearInterval(timer); timer = null;
  if (S && !paused && $('difficultySetup').hidden) timer = setInterval(tick, C.tickMs / S.speed);
}

function hire(id) {
  if (S.employees.some(employee => employee.id === id)) return;
  const i = S.candidates.findIndex(c => c.id === id);
  if (i < 0) return;
  const c = S.candidates[i];
  c.tier = EmployeeConfig.safeTier(c.tier) || 1;
  const candidateSalary = Number(c.salary);
  c.salary = Number.isFinite(candidateSalary)
    ? Math.max(1, Math.min(1e6, Math.floor(candidateSalary)))
    : EmployeeConfig.salaryForTier(c.tier, () => 0, S.difficulty);
  const fee = hireCost(c);
  if (S.employees.length >= S.desks) return log('Нет свободных мест: расширьте офис', 'bad');
  if (S.money < fee) return log(`Не хватает денег на найм ${c.name}: нужно ${fmt(fee)}`, 'bad');
  S.money = Math.max(0, S.money - fee);
  S.candidates.splice(i, 1);
  const used = new Set(S.employees.map(e => e.desk));
  c.desk = 0; while (used.has(c.desk)) c.desk++;
  S.employees.push(c);
  S.selected = c.id;
  officePage = Math.floor(c.desk / 4);
  Speech.syncVisibility();
  syncEmployeeReaction(c);
  if (!flavor('hire', flavorContext(c), { force: true, type: 'good' })) {
    log(`Нанят сотрудник: ${c.name} (${C.roles[c.role].name}, ${c.spec})`, 'good');
  }
  ForceMajeureSystem.onHire(S, forceMajeureDeps());
}

function assign(taskId) {
  const e = sel();
  if (!e) return log('Сначала выберите сотрудника в офисе', 'warn');
  if (!C.tasks[taskId]) return;
  if (e.task !== taskId) e.progress = 0;
  e.task = taskId; e.status = 'work';
  syncEmployeeReaction(e);
  log(`${e.name} назначен на «${C.tasks[taskId].name}»`);
  flavor('taskStart', flavorContext(e, C.tasks[taskId]), { type: 'info', force: true });
}

/** Обработчик всех кнопок (делегирование событий по data-act). */
function act(ev) {
  const el = ev.target.closest && ev.target.closest('[data-act]');
  if (!el || !S || $('gameView').hidden || !$('forceMajeureModal').hidden) return;
  const a = el.dataset.act, e = sel();
  if (a === 'officePrev' || a === 'officeNext') {
    officePage = Math.max(0, Math.min(Math.ceil(S.desks / 4) - 1, officePage + (a === 'officeNext' ? 1 : -1)));
    Speech.syncVisibility();
    render(); return;
  }
  switch (a) {
    case 'select': if (S.employees.some(x => x.id === +el.dataset.id)) S.selected = +el.dataset.id; break;
    case 'assign': assign(el.dataset.task); break;
    case 'rest': if (e) { e.status = 'rest'; syncEmployeeReaction(e); log(`${e.name} отправлен отдыхать`); showCharacterLine(e, 'rest', flavorContext(e, e.task ? C.tasks[e.task] : null), { force: true, priority: 9 }); } break;
    case 'back': if (e) { e.status = e.task ? 'work' : 'idle'; syncEmployeeReaction(e); log(`${e.name} вернулся к работе`); showCharacterLine(e, e.energy < 85 ? 'energyLow' : 'energyRecovered', flavorContext(e, e.task ? C.tasks[e.task] : null), { force: true, priority: 4 }); } break;
    case 'clear': if (e) { e.task = null; e.progress = 0; e.status = 'idle'; syncEmployeeReaction(e); log(`${e.name} снят с задачи`); showCharacterLine(e, 'idle', flavorContext(e), { force: true, priority: 3 }); } break;
    case 'fire':
      if (e && confirm(`Уволить сотрудника ${e.name}?`)) {
        S.employees = S.employees.filter(x => x !== e); Speech.removeEmployee(e.id); S.selected = null; log(`${e.name} уволен`, 'warn');
      } break;
    case 'hire': hire(+el.dataset.id); break;
    case 'refresh':
      if (S.money < candidateRefreshCost()) log(`Не хватает денег на обновление списка: нужно ${fmt(candidateRefreshCost())}`, 'bad');
      else { S.money -= candidateRefreshCost(); S.candidates = []; for (let i = 0; i < C.candidates; i++) S.candidates.push(genCandidate()); log('Список кандидатов обновлён'); }
      break;
    case 'expand':
      if (S.desks >= C.maxDesks) break;
      if (S.money < deskUpgradeCost()) log(`Не хватает денег на расширение: нужно ${fmt(deskUpgradeCost())}`, 'bad');
      else { S.money -= deskUpgradeCost(); S.desks = Math.min(C.maxDesks, S.desks + C.desksPerUpgrade); log(`Офис расширен: мест ${S.desks}`, 'good'); }
      break;
    case 'pause': paused = !paused; restartTimer(); break;
    case 'speed': S.speed = C.speeds.includes(+el.dataset.v) ? +el.dataset.v : 1; restartTimer(); break;
    case 'save': save(false); break;
    case 'load': loadGame().then(render); break;
    case 'reset':
      if (confirm('Начать заново? Сохранение на сервере будет заменено новой игрой.')) openDifficultySetup(true);
      return;
    case 'diff-select':
      if (DIFFICULTIES[el.dataset.v]) { pendingDifficulty = el.dataset.v; renderDifficultySetup(); }
      return;
    case 'start-difficulty':
      startDifficultyCampaign();
      return;
    case 'cancel-difficulty':
      if (difficultyResetMode) {
        $('difficultySetup').hidden = true;
        restartTimer(); render();
      }
      return;
    case 'logout': logout(); return;
    case 'noticeLoad': loadGame().then(render); break;
    case 'noticeForce':
      if (API.hold === 'corrupt') { openDifficultySetup(true); return; }
      if (API.hold !== 'conflict' || confirm('Перезаписать сохранение на сервере текущей игрой?')) pushSave({ force: true, silent: false });
      break;
    case 'retryLoad': enterGame(); return;
    case 'importLocal': importLocal(); break;
    case 'dropLocal':
      try { localStorage.removeItem(KEY); } catch (err) { /* хранилище недоступно */ }
      API.legacy = false; break;
  }
  API.dirty = true;
  if (SAVE_ACTIONS.has(a)) scheduleSave();   // важные действия сохраняем сразу (с небольшой задержкой)
  render();
}

/* =====================================================================
   6. СОХРАНЕНИЕ НА СЕРВЕРЕ И ЗАГРУЗКА (с проверкой данных)
   ===================================================================== */
function cleanPerson(r) {
  if (!r || typeof r !== 'object' || !C.roles[r.role]) return null;
  const id = Math.floor(num(r.id, 0, 0, 1e9));
  const name = String(typeof r.name === 'string' ? r.name : '').slice(0, 32);
  const identity = StartupNameGenerator.resolveIdentity({ ...r, id, name });
  const task = C.tasks[r.task] ? r.task : null;
  const traits = EmployeeConfig.normalizeEmployeeTraits(r);
  const legacySkill = num(r.skill, Math.max(1, ...Object.values(traits.skills)), 1, 10);
  let status = ['work', 'rest', 'idle'].includes(r.status) ? r.status : 'idle';
  if (status === 'work' && !task) status = 'idle';
  if (status === 'idle' && task) status = 'work';
  return { id, name, ...identity, role: r.role,
           spec: String(r.spec || '').slice(0, 24), skill: legacySkill, tier: traits.tier, skills: traits.skills,
           salary: Math.floor(num(r.salary, EmployeeConfig.tierConfig(traits.tier).salary.min, 1, 1e6)),
           speed: num(r.speed, 1, 0.5, 2), energy: num(r.energy, 100, 0, 100), mood: num(r.mood, 70, 0, 100),
           task, progress: num(r.progress, 0, 0, 1e4), status, desk: Math.floor(num(r.desk, -1, -1, 99)) };
}

/** Превращает прочитанные данные в корректное состояние или бросает ошибку. */
function sanitize(r) {
  if (!r || typeof r !== 'object') throw new Error('Некорректное сохранение');
  const s = newState();
  s.money = num(r.money, s.money, 0, C.maxMoney); s.rep = num(r.rep, 0, 0, 100);
  s.product = num(r.product, 0, 0, 100); s.customers = Math.floor(num(r.customers, 0, 0, 1e9));
  s.day = Math.floor(num(r.day, 1, 1, 1e6)); s.hour = Math.floor(num(r.hour, 9, 0, 23));
  s.speed = C.speeds.includes(r.speed) ? r.speed : 1;
  s.difficulty = DIFFICULTIES[r.difficulty] ? r.difficulty : 'medium';
  s.desks = Math.floor(num(r.desks, C.startDesks, C.startDesks, C.maxDesks)); s.won = !!r.won;
  s.rescueUsed = typeof r.rescueUsed === 'boolean' ? r.rescueUsed : false;
  s.employees = (Array.isArray(r.employees) ? r.employees : []).map(cleanPerson).filter(Boolean).slice(0, s.desks);
  const used = new Set();
  s.employees.forEach(e => { if (e.desk < 0 || e.desk >= s.desks || used.has(e.desk)) e.desk = -1; else used.add(e.desk); });
  s.employees.forEach(e => { if (e.desk < 0) { let d = 0; while (used.has(d)) d++; e.desk = d; used.add(d); } });
  s.candidates = (Array.isArray(r.candidates) ? r.candidates : []).map(cleanPerson).filter(Boolean).slice(0, C.candidates);
  // Старые сохранения сохраняют имеющиеся имена; недостающие получают новые уникальные имена.
  const people = [...s.employees, ...s.candidates];
  const usedNames = new Set(people.map(p => p.name.trim()).filter(n => n && n !== 'Без имени'));
  const originalPeople = [...(Array.isArray(r.employees) ? r.employees : []), ...(Array.isArray(r.candidates) ? r.candidates : [])];
  let migratedState = !r.flavor || !DIFFICULTIES[r.difficulty] || typeof r.rescueUsed !== 'boolean' || people.some(person => {
    const original = originalPeople.find(p => p && p.id === person.id);
    return !original || original.gender !== person.gender
      || JSON.stringify(original.appearance) !== JSON.stringify(person.appearance)
      || original.tier !== person.tier || JSON.stringify(original.skills) !== JSON.stringify(person.skills);
  });
  for (const person of people) {
    if (!person.name || person.name === 'Без имени') {
      person.name = StartupNameGenerator.generate(usedNames, person.gender);
      usedNames.add(person.name);
      migratedState = true;
    }
  }
  s.flavor = normalizeFlavorState(r.flavor);
  // Помечаем миграцию для сохранения выданных имён и антиспам-истории на сервере.
  if (migratedState) API.dirty = true;
  s.nextId = 1 + Math.max(num(r.nextId, 0, 0, 1e9), ...[...s.employees, ...s.candidates].map(p => p.id));
  s.selected = s.employees.some(e => e.id === r.selected) ? r.selected : null;
  s.log = (Array.isArray(r.log) ? r.log : []).slice(0, C.logMax).map(l => ({
    t: String((l && l.t) || '').slice(0, 30), text: String((l && l.text) || '').slice(0, 200),
    type: ['good', 'warn', 'bad', 'info'].includes(l && l.type) ? l.type : 'info' }));
  return s;
}

/* ---- Связь с сервером ---- */
const API = { user: null, csrf: null, rev: 0, dirty: false, busy: false, queued: null,
              hold: null,      // null | 'conflict' | 'corrupt' | 'noload' — автосохранение приостановлено
              legacy: false,   // найдено старое локальное сохранение
              leaving: false, saveTimer: null };
const SAVE_ACTIONS = new Set(['hire', 'fire', 'expand', 'refresh', 'assign', 'rest', 'back', 'clear']);
const USER_RE = /^[A-Za-z0-9_]{3,20}$/;   // то же правило, что на сервере

/** Запрос к API: JSON, cookie сессии, CSRF-токен, таймаут 10 с. Возвращает {status, data}. */
async function api(method, path, body, keepalive) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 10000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (API.csrf) headers['X-CSRF-Token'] = API.csrf;
    const res = await fetch(path, { method, headers, credentials: 'same-origin', signal: ctl.signal,
      keepalive: !!keepalive, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (err) { /* пустой ответ */ }
    return { status: res.status, data: data || {} };
  } finally { clearTimeout(to); }
}

const hhmm = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function setStatus(t) { const el = $('saveStatus'); if (el) el.textContent = t; }
function scheduleSave() { clearTimeout(API.saveTimer); API.saveTimer = setTimeout(() => pushSave({ silent: true }), 1500); }
function save(silent) { return pushSave({ silent }); }

/** Отправляет игру на сервер. rev защищает от затирания сохранения из другой вкладки (409). Возвращает true при успехе. */
async function pushSave(opts = {}) {
  const { silent = true, force = false, keepalive = false } = opts;
  if (!API.user || !S) return false;
  if (API.hold && !force) {
    if (!silent) log('Автосохранение приостановлено: сначала решите вопрос в сообщении выше', 'warn');
    return false;
  }
  if (API.busy) { API.queued = opts; return false; }
  API.busy = true; API.dirty = false; setStatus('Сохранение…');
  let ok = false;
  try {
    const { status, data } = await api('PUT', '/api/save', { state: S, rev: API.rev, force }, keepalive);
    if (status === 200) {
      API.rev = data.rev; API.hold = null; ok = true; setStatus('Сохранено в ' + hhmm());
      if (!silent) log('Игра сохранена на сервере', 'good');
    } else if (status === 409) { API.hold = 'conflict'; API.dirty = true; setStatus('Конфликт сохранений'); }
    else if (status === 401) { API.busy = false; sessionExpired(); return false; }
    else { API.dirty = true; setStatus('Ошибка сохранения'); if (!silent) log(data.error || 'Не удалось сохранить игру', 'bad'); }
  } catch (err) {
    API.dirty = true; setStatus('Нет связи: сохраню позже');
    if (!silent) log('Нет связи с сервером, игра сохранится позже', 'warn');
  }
  API.busy = false;
  if (API.queued) { const q = API.queued; API.queued = null; pushSave(q); }
  render();
  return ok;
}

/** Читает сохранение с сервера: 'ok' | 'none' | 'bad' | 'error' | 'auth'. Текущая игра меняется только при 'ok'. */
async function loadFromServer() {
  try {
    const { status, data } = await api('GET', '/api/save');
    if (status === 401) { sessionExpired(); return 'auth'; }
    if (status !== 200) return 'error';
    if (!data.save) { API.rev = 0; return 'none'; }
    API.rev = Number(data.save.rev) || 0;
    try {
      API.dirty = false;
      const loaded = sanitize(data.save.state);
      resetForceMajeure();
      S = loaded;
      const selected = sel();
      officePage = selected ? Math.floor(selected.desk / 4) : 0;
      seedReactionState();
      return 'ok';
    } catch (err) { return 'bad'; }
  } catch (err) { return 'error'; }
}

/** Кнопка «Загрузить». */
async function loadGame() {
  const r = await loadFromServer();
  if (r === 'ok') { API.hold = null; if (API.dirty) scheduleSave(); tickCount = 0; restartTimer(); log('Игра загружена с сервера', 'good'); setStatus('Загружено в ' + hhmm()); showResumeBubble(); }
  else if (r === 'none') log('На сервере пока нет сохранения', 'bad');
  else if (r === 'bad') log('Сохранение на сервере повреждено, загрузка отменена', 'bad');
  else if (r === 'error') log('Не удалось связаться с сервером', 'bad');
}

/** Импорт старого localStorage-сохранения — только по явному согласию игрока. */
function legacyRaw() { try { return localStorage.getItem(KEY); } catch (err) { return null; } }
async function importLocal() {
  let local;
  try { local = sanitize(JSON.parse(legacyRaw())); }
  catch (err) { API.legacy = false; log('Локальное сохранение повреждено, импорт невозможен', 'bad'); return; }
  if ((S.day > 1 || S.employees.length) && !confirm('В аккаунте уже есть прогресс. Заменить его локальным сохранением из этого браузера?')) return;
  resetForceMajeure();
  S = local; officePage = sel() ? Math.floor(sel().desk / 4) : 0;
  API.legacy = false; tickCount = 0; seedReactionState();
  log('Локальное сохранение импортировано', 'good'); render();
  if (await pushSave({ force: true, silent: true })) { try { localStorage.removeItem(KEY); } catch (err) { /* недоступно */ } }
}

/* ---- Вход, выход, регистрация ---- */
function showAuth(msg) {
  clearInterval(timer); timer = null; clearTimeout(API.saveTimer);
  $('difficultySetup').hidden = true;
  resetForceMajeure();
  $('gameView').hidden = true; $('authView').hidden = false; $('authMsg').textContent = msg || '';
}
function showGame() { $('authView').hidden = true; $('gameView').hidden = false; $('userName').textContent = API.user; }
function resetSession() { Object.assign(API, { user: null, csrf: null, rev: 0, hold: null, legacy: false, dirty: false, queued: null }); resetForceMajeure(); S = null; officePage = 0; Speech.clear(); }
function sessionExpired() { resetSession(); showAuth('Сессия истекла. Войдите снова.'); }

/** Вход в игру после авторизации: грузим сохранение с сервера. */
async function enterGame() {
  Speech.clear();
  showGame(); clearInterval(timer); timer = null;
  API.hold = null; API.dirty = false; API.legacy = false; tickCount = 0;
  fresh();
  const r = await loadFromServer();
  if (r === 'auth') return;
  if (r === 'ok') log('Игра загружена с сервера', 'good');
  else if (r === 'none') {
    API.legacy = !!legacyRaw();
    render();
    openDifficultySetup(false);
    return;
  }
  else if (r === 'bad') { API.hold = 'corrupt'; log('Сохранение на сервере повреждено. Автосохранение выключено, пока вы не начнёте новую игру.', 'bad'); }
  else if (r === 'error') { API.hold = 'noload'; log('Не удалось загрузить сохранение. Автосохранение выключено, чтобы не затереть прогресс.', 'bad'); }
  API.legacy = !!legacyRaw() && API.hold !== 'noload';
  restartTimer(); render(); showResumeBubble();
  if (API.dirty) scheduleSave();
}

async function logout() {
  if (API.leaving) return;
  API.leaving = true;
  clearInterval(timer); timer = null; clearTimeout(API.saveTimer);
  for (let i = 0; API.busy && i < 40; i++) await new Promise(r => setTimeout(r, 50));
  if (!API.hold && API.dirty) await pushSave({ silent: true });
  let msg = 'Вы вышли из аккаунта.';
  try { await api('POST', '/api/logout'); } catch (err) { msg = 'Нет связи с сервером: сессия на сервере может остаться активной.'; }
  resetSession(); API.leaving = false;
  showAuth(msg);
}

/** Проверка формы на клиенте (сервер проверяет всё повторно). */
async function submitAuth(mode, ev) {
  ev.preventDefault();
  const f = ev.target, msg = $('authMsg'), u = f.elements.username.value.trim(), p = f.elements.password.value;
  let err = null;
  if (!USER_RE.test(u)) err = 'Имя пользователя: 3–20 символов, латинские буквы, цифры и _';
  else if (p.length < 8 || p.length > 128) err = 'Пароль: от 8 до 128 символов';
  else if (mode === 'register' && p !== f.elements.password2.value) err = 'Пароли не совпадают';
  if (err) { msg.textContent = err; return; }
  const b = f.querySelector('button[type="submit"]');
  b.disabled = true; msg.textContent = '';
  try {
    const { status, data } = await api('POST', '/api/' + mode, { username: u, password: p });
    if ((status === 200 || status === 201) && data.user) {
      API.user = data.user.username; API.csrf = data.csrfToken; f.reset();
      await enterGame();
    } else msg.textContent = data.error || 'Ошибка запроса';
  } catch (e2) { msg.textContent = 'Нет связи с сервером'; }
  finally { b.disabled = false; }
}

function switchTab(mode) {
  $('formLogin').hidden = mode !== 'login'; $('formRegister').hidden = mode !== 'register';
  $('tabLogin').classList.toggle('sec', mode !== 'login'); $('tabRegister').classList.toggle('sec', mode !== 'register');
  $('authMsg').textContent = '';
}

/** При старте проверяем, есть ли активная сессия. */
async function boot() {
  try {
    const { status, data } = await api('GET', '/api/me');
    if (status === 200 && data.user) { API.user = data.user.username; API.csrf = data.csrfToken; await enterGame(); }
    else showAuth('');
  } catch (err) { showAuth('Нет связи с сервером. Проверьте, что он запущен, и обновите страницу.'); }
}

function fresh(difficulty = 'medium') {
  clearInterval(timer); timer = null;
  resetForceMajeure();
  officePage = 0;
  S = newState();
  S.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'medium';
  S.money = difficultyConfig().startingMoney;
  for (let i = 0; i < C.candidates; i++) S.candidates.push(genCandidate());
  seedReactionState();
  const goal = goalForDifficulty();
  log(`Добро пожаловать! Сложность: ${difficultyConfig().name}. Наймите первых сотрудников. Цель: ${goal.customers} клиентов и репутация ${goal.reputation}.`);
}

/** Показывает выбор режима перед новой кампанией или после подтверждённого сброса. */
function openDifficultySetup(resetRun) {
  difficultyResetMode = !!resetRun;
  pendingDifficulty = DIFFICULTIES[S && S.difficulty] ? S.difficulty : 'medium';
  clearInterval(timer); timer = null;
  Speech.clear();
  $('cancelDifficulty').hidden = !difficultyResetMode;
  $('difficultySetup').hidden = false;
  renderDifficultySetup();
}

function renderDifficultySetup() {
  const cfg = DIFFICULTIES[pendingDifficulty] || DIFFICULTIES.medium;
  document.querySelectorAll('.difficulty-option').forEach(button => {
    const selected = button.dataset.v === pendingDifficulty;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('difficultyDetails').textContent = `${cfg.description} Стартовый капитал: ${fmt(cfg.startingMoney)}. Скорость ×${cfg.employeeSpeed.toFixed(2)}, трудоёмкость ×${cfg.projectComplexity.toFixed(2)}, аренда ×${cfg.rentMultiplier.toFixed(2)}, оклады ×${cfg.salaryMultiplier.toFixed(2)}, доход ×${cfg.incomeMultiplier.toFixed(2)}, найм ×${cfg.hireFeeMultiplier.toFixed(2)}, форс-мажоры ×${cfg.forceMajeureFrequency}. Цель: ${cfg.goal.customers} клиентов и ${cfg.goal.reputation} репутации.`;
  $('difficultyTitle').textContent = difficultyResetMode ? 'Выбери сложность новой кампании' : 'Выбери сложность';
  document.querySelector('[data-act="start-difficulty"]').textContent = difficultyResetMode ? 'Начать новую кампанию' : 'Начать игру';
}

async function startDifficultyCampaign() {
  const replacing = difficultyResetMode;
  $('difficultySetup').hidden = true;
  fresh(pendingDifficulty);
  API.hold = null;
  API.legacy = false;
  API.dirty = true;
  tickCount = 0;
  paused = false;
  render();
  restartTimer();
  showResumeBubble();
  pushSave({ force: replacing, silent: true });
}

/* =====================================================================
   7. ИНТЕРФЕЙС (DOM строится через createElement — без innerHTML)
   ===================================================================== */
/** Мини-конструктор элементов: h('div', {class:'x'}, 'текст', child). */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k in props || {}) { const v = props[k]; if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v); }
  kids.flat().forEach(c => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
  return el;
}
const fill = (el, arr) => el.replaceChildren(...arr.flat().filter(Boolean));

/** Спрайт: PNG, если путь указан, иначе emoji; при ошибке загрузки — тоже emoji. */
function sprite(def, cls) {
  const span = h('span', { class: cls }, def.emoji);
  if (!def.img) return span;
  const img = h('img', { class: cls, src: def.img, alt: def.emoji });
  img.addEventListener('error', () => img.replaceWith(span));
  return img;
}

function bar(v, max, kind) {
  const p = Math.max(0, Math.min(100, v / max * 100));
  return h('div', { class: `bar ${kind}${kind !== 'pr' && p < 25 ? ' low' : ''}` }, h('i', { style: `width:${p.toFixed(1)}%` }));
}
const stat = (label, text, v, max, kind) => h('div', { class: 'st' }, h('div', {}, h('span', {}, label), h('b', {}, text)), bar(v, max, kind));
const btn = (label, a, cls) => h('button', { class: 'btn ' + (cls || ''), type: 'button', 'data-act': a }, label);

function tierDisplay(person) {
  const tier = EmployeeConfig.safeTier(person.tier) || 1;
  return h('div', { class: 'tier-line' },
    h('span', { class: 'tier-stars', title: `Тир ${tier} из 5`, 'aria-label': `Тир ${tier} из 5` }, '★'.repeat(tier)),
    h('span', { class: 'mute' }, `Тир ${tier}/5`));
}

function skillRows(person) {
  const skills = person.skills || {};
  const entries = Object.keys(EmployeeConfig.SKILLS).filter(key => Number.isFinite(Number(skills[key])));
  if (!entries.length) return [h('p', { class: 'mute' }, 'Специализации не указаны')];
  return entries.map(key => {
    const level = Math.max(1, Math.min(10, Math.round(Number(skills[key]))));
    return h('div', { class: 'skill-row' },
      h('span', { class: 'skill-name' }, EmployeeConfig.SKILLS[key].label),
      h('span', { class: 'microchips', title: `${EmployeeConfig.SKILLS[key].label}: ${level}/10`, 'aria-label': `${EmployeeConfig.SKILLS[key].label}: ${level} из 10` },
        h('span', { class: 'microchips-filled' }, '■'.repeat(level)),
        h('span', { class: 'microchips-empty' }, '□'.repeat(10 - level)),
        h('b', { class: 'microchips-value' }, ` ${level}/10`)));
  });
}

function renderTop() {
  const exp = salaries() + rentCost();
  $('sMoney').textContent = fmt(S.money);
  $('sRep').textContent = `${Math.floor(S.rep)} / 100`;
  $('sProd').textContent = `${Math.floor(S.product)}%`;
  $('sCust').textContent = S.customers;
  $('sInc').textContent = fmt(incomeTick() * 24);
  $('sInc').title = `Выручка ограничена базой ${C.customerIncomeCap} оплачиваемых клиентов; фактически учитывается ${Math.min(C.customerIncomeCap, S.customers)}.`;
  $('sExp').textContent = fmt(exp);
  $('sTime').textContent = timeStr();
  $('bPause').textContent = paused ? 'Продолжить' : 'Пауза';
  document.querySelectorAll('[data-act="speed"]').forEach(b => b.classList.toggle('on', +b.dataset.v === S.speed));
  const g = $('goal');
  g.className = S.won ? 'won' : '';
  const goal = goalForDifficulty(), difficulty = difficultyConfig();
  g.textContent = `Сложность: ${difficulty.name} · работа ×${difficulty.employeeSpeed.toFixed(2)} · проекты ×${difficulty.projectComplexity.toFixed(2)} · ` +
    (S.won ? '🏆 Цель достигнута! ' : 'Цель: ') +
    `клиенты ${S.customers}/${goal.customers}, репутация ${Math.floor(S.rep)}/${goal.reputation}`;
  g.title = `Модификатор частоты форс-мажоров: ×${difficulty.forceMajeureFrequency}`;
}

function renderOffice() {
  const pages = Math.ceil(S.desks / 4);
  officePage = Math.min(officePage, pages - 1);
  const seats = [], roster = [], bubbles = [];
  for (let slot = 0; slot < 4; slot++) {
    const i = officePage * 4 + slot;
    if (i >= S.desks) continue;
    const e = S.employees.find(x => x.desk === i);
    const isSelected = !!e && e.id === S.selected;
    const w = e ? warnings(e) : [];
    const speech = e ? Speech.getBubble(e.id) : null;
    if (speech) bubbles.push(h('div', { class: 'speech-bubble', role: 'status', 'aria-live': 'polite',
      style: `--speech-anchor-x:${slot % 2 ? 68.5 : 32.5}%;--speech-anchor-y:${slot < 2 ? 40 : 62}%` },
      h('span', { class: 'speech-text' }, speech.text)));
    seats.push(h('div', { class: `office-seat slot-${slot}${e ? ` ${e.status}` : ' empty'}${isSelected ? ' sel' : ''}`,
      'data-act': e ? 'select' : null, 'data-id': e ? e.id : null,
      role: e ? 'button' : null, tabindex: e ? 0 : null,
      'aria-label': e ? `Выбрать сотрудника ${e.name}` : null },
      e ? portrait(e, 'avatar--office') : null,
      CharacterArt.desk(i),
      isSelected ? h('span', { class: 'seat-bubble', 'aria-hidden': 'true',
        title: e.task ? C.tasks[e.task].name : STATUS[e.status] },
        sprite(SPRITES.bubbles[e.status === 'work' ? e.task : e.status], 'ico')) : null,
      isSelected ? h('span', { class: 'seat-energy', 'aria-hidden': 'true' }, `⚡ ${Math.round(e.energy)}%`) : null,
      w.length ? h('span', { class: 'seat-warning', title: w.join('. ') }, '⚠') : null));
    roster.push(h('div', { class: `office-person${isSelected ? ' sel' : ''}` },
      h('span', { class: 'mute' }, `Место ${i + 1}`),
      e ? h('button', { type: 'button', 'data-act': 'select', 'data-id': e.id, title: e.name },
        e.name, ' · ', isSelected && e.status === 'work' && e.task ? C.tasks[e.task].name : STATUS[e.status])
        : h('span', {}, 'Свободно')));
  }
  fill($('office'), [h('div', { class: 'office-scene' }, seats, bubbles), h('div', { class: 'office-roster' }, roster)]);
  fill($('officeFoot'), [
    pages > 1 ? h('div', { class: 'office-pages' },
      h('button', { class: 'btn sec', type: 'button', 'data-act': 'officePrev', disabled: officePage === 0 }, '←'),
      h('span', {}, `Комната ${officePage + 1} / ${pages}`),
      h('button', { class: 'btn sec', type: 'button', 'data-act': 'officeNext', disabled: officePage === pages - 1 }, '→')) : null,
    S.desks < C.maxDesks
      ? h('button', { class: 'btn sec' + (S.money < deskUpgradeCost() ? ' off' : ''), type: 'button', 'data-act': 'expand' },
          `Расширить офис: +${C.desksPerUpgrade} места (${fmt(deskUpgradeCost())})`)
      : h('span', { class: 'mute' }, 'Офис максимального размера.'),
    h('span', { class: 'mute' }, `Мест занято: ${S.employees.length}/${S.desks}. Аренда: ${fmt(rentCost())} в день.`)
  ]);
}

function renderPanel() {
  const e = sel(), box = $('emp');
  if (!e) { fill(box, [h('p', { class: 'mute' }, 'Нажмите на сотрудника в офисе, чтобы увидеть его параметры и управлять им.')]); return; }
  const t = e.task ? C.tasks[e.task] : null;
  fill(box, [
    h('div', { class: 'ehead' }, portrait(e, 'avatar--card'),
      h('div', {}, h('h3', {}, e.name), h('div', { class: 'mute' }, `${C.roles[e.role].name} · ${e.spec}`),
        tierDisplay(e), h('span', { class: 'badge ' + e.status }, STATUS[e.status]))),
    h('div', { class: 'employee-skills' }, h('b', {}, 'Навыки'), ...skillRows(e)),
    stat('Энергия', `${Math.round(e.energy)}%`, e.energy, 100, 'en'),
    stat('Настроение', `${Math.round(e.mood)}%`, e.mood, 100, 'mood'),
    h('div', { class: 'row' }, h('span', {}, 'Скорость работы'), h('b', {}, '×' + e.speed.toFixed(2))),
    h('div', { class: 'row' }, h('span', {}, 'Зарплата'), h('b', {}, fmt(e.salary) + ' в день')),
    stat('Задача: ' + (t ? t.name : 'не назначена'), t ? `${Math.floor(e.progress / taskWork(t) * 100)}%` : '—', t ? e.progress : 0, t ? taskWork(t) : 1, 'pr'),
    warnings(e).map(w => h('div', { class: 'warnline' }, '⚠ ' + w)),
    h('div', { class: 'btns' },
      e.status === 'rest' ? btn('Вернуть к работе', 'back', 'sec') : btn('Отправить отдыхать', 'rest', 'sec'),
      t ? btn('Снять с задачи', 'clear', 'sec') : null,
      btn('Уволить', 'fire', 'sec')),
    h('p', { class: 'mute' }, 'Новую задачу назначайте в разделе «Задачи».')
  ]);
}

function renderTasks() {
  const s = sel();
  fill($('tasks'), Object.values(C.tasks).map(t => {
    const who = S.employees.filter(e => e.task === t.id).map(e => e.name);
    return h('div', { class: 'task' },
      h('div', {}, sprite(SPRITES.bubbles[t.id], 'ico'), ' ', h('b', {}, t.name)),
      h('p', { class: 'mute' }, t.desc),
      h('div', { class: 'mute' }, `Подходящие навыки: ${EmployeeConfig.TASK_SKILLS[t.id].map(key => EmployeeConfig.SKILLS[key].label).join(' / ')}`),
      h('div', { class: 'mute' }, `Трудоёмкость проекта: ${taskWork(t)} очков работы`),
      h('div', { class: 'mute' }, 'Работают: ' + (who.join(', ') || 'никто')),
      s ? h('div', { class: 'mute' }, `${s.name}: эффективность ${Math.round(efficiency(s, t.id) / C.baseSpeed * 100)}%`) : null,
      h('button', { class: 'btn' + (s ? '' : ' off'), type: 'button', 'data-act': 'assign', 'data-task': t.id },
        s ? `Назначить: ${s.name}` : 'Сначала выберите сотрудника'));
  }));
}

function renderHire() {
  const items = S.candidates.map(c => {
    const fee = hireCost(c);
    return h('div', { class: 'cand' }, portrait(c, 'avatar--card'),
      h('div', { class: 'cinfo' }, h('b', {}, c.name),
        h('div', { class: 'mute' }, `${C.roles[c.role].name} · ${c.spec}`),
        tierDisplay(c), h('div', { class: 'candidate-skills' }, ...skillRows(c)),
        h('div', { class: 'mute' }, `Скорость ×${c.speed.toFixed(2)} · оклад ${fmt(c.salary)} в день`)),
      h('button', { class: 'btn' + (S.money < fee || S.employees.length >= S.desks ? ' off' : ''), type: 'button', 'data-act': 'hire', 'data-id': c.id },
        `Нанять ${fmt(fee)}`));
  });
  const chances = EmployeeConfig.TIERS.map(tier => `${'★'.repeat(tier.id)} ${tier.chance}%`).join(' · ');
  fill($('hire'), [
    items.length ? items : h('p', { class: 'mute' }, 'Кандидатов нет. Обновите список.'),
    h('div', { class: 'tier-probabilities' },
      h('b', {}, 'Вероятность появления тиров'),
      h('div', { class: 'mute' }, chances)),
    h('div', { class: 'foot' }, h('button', { class: 'btn sec' + (S.money < candidateRefreshCost() ? ' off' : ''), type: 'button', 'data-act': 'refresh' },
      `Обновить список (${fmt(candidateRefreshCost())})`))
  ]);
}

function renderLog() {
  fill($('log'), S.log.slice(0, 16).map(l => h('li', { class: l.type }, h('span', { class: 'lt' }, l.t), ' ' + l.text)));
}

/** Сообщения о состоянии сохранения: конфликт, повреждение, импорт старого сохранения. */
function renderNotice() {
  const box = $('notice'), n = [];
  const row = (text, ...btns) => h('div', { class: 'nrow' }, h('span', {}, text), ...btns);
  if (API.hold === 'conflict') n.push(row('Сохранение на сервере изменилось в другой вкладке или на другом устройстве. Автосохранение приостановлено.',
    btn('Загрузить версию с сервера', 'noticeLoad', 'sec'), btn('Перезаписать сервер моей игрой', 'noticeForce', 'sec')));
  if (API.hold === 'corrupt') n.push(row('Сохранение на сервере повреждено. Автосохранение выключено.', btn('Начать новую игру', 'noticeForce', 'sec')));
  if (API.hold === 'noload') n.push(row('Не удалось загрузить сохранение с сервера. Автосохранение выключено, чтобы не затереть прогресс.', btn('Повторить загрузку', 'retryLoad', 'sec')));
  if (API.legacy) n.push(row('Найдено старое сохранение из этого браузера (без аккаунта).',
    btn('Импортировать в аккаунт', 'importLocal', 'sec'), btn('Удалить локальное', 'dropLocal', 'sec')));
  box.hidden = !n.length; fill(box, n);
}

function render() { if (!S) return; renderTop(); renderOffice(); renderPanel(); renderTasks(); renderHire(); renderLog(); renderNotice(); }

/* =====================================================================
   8. ЗАПУСК
   Клики обрабатываются по pointerup, чтобы кнопки не «терялись»,
   когда интерфейс перерисовывается во время тика.
   ===================================================================== */
document.addEventListener('pointerup', ev => { if (ev.button === 0) act(ev); });
document.addEventListener('click', ev => { if (ev.detail === 0) act(ev); });      // клавиатура
document.addEventListener('keydown', ev => {                                      // Enter/пробел на «div-кнопках»
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('div[data-act]')) { ev.preventDefault(); act(ev); }
});
// при закрытии/сворачивании страницы досылаем изменения (keepalive позволяет запросу дойти)
const flush = () => { if (S && API.user && API.dirty && !API.hold) pushSave({ silent: true, keepalive: true }); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);

document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('formLogin').addEventListener('submit', ev => submitAuth('login', ev));
$('formRegister').addEventListener('submit', ev => submitAuth('register', ev));
CharacterArt.load().then(() => { if (S) render(); }).catch(err => console.error('Не удалось загрузить изображения персонажей:', err));
ForceMajeureSystem.init().finally(boot);
