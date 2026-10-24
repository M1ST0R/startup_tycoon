'use strict';
/* Серверная проверка сохранения: структура и допустимые диапазоны.
   Сервер не пересчитывает игру, он лишь не даёт сохранить мусор и слишком большие данные. */

const ROLES = new Set(['dev', 'designer', 'marketer']);
const TASKS = new Set(['code', 'ui', 'marketing']);
const STATUSES = new Set(['work', 'rest', 'idle']);
const LOG_TYPES = new Set(['good', 'warn', 'bad', 'info']);

const fail = () => { throw new Error('invalid state'); };
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : fail());
const real = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail());
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : fail());
const list = (a, max) => (Array.isArray(a) && a.length <= max ? a : fail());

function person(p) {
  if (!p || typeof p !== 'object' || !ROLES.has(p.role) || !STATUSES.has(p.status)) fail();
  if (p.task !== null && !TASKS.has(p.task)) fail();
  const id = int(p.id, 0, 1e9);
  // Older saves have no appearance. Give each older character a stable look.
  const oldLook = { hair: (id * 37 + 11) % 64, cloth: (id * 3 + 1) % 4 };
  const appearance = p.appearance == null ? oldLook : {
    hair: int(p.appearance.hair, 0, 63), cloth: int(p.appearance.cloth, 0, 3)
  };
  return {
    id, appearance, name: str(p.name, 24), role: p.role, spec: str(p.spec, 24),
    skill: real(p.skill, 1, 10), salary: int(p.salary, 0, 1e6), speed: real(p.speed, 0.5, 2),
    energy: real(p.energy, 0, 100), mood: real(p.mood, 0, 100), task: p.task,
    progress: real(p.progress, 0, 1e4), status: p.status, desk: int(p.desk, -1, 99)
  };
}

/** Возвращает «чистую» копию состояния или бросает ошибку, если данные некорректны. */
function normalizeState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || s.v !== 1) fail();
  return {
    v: 1,
    money: real(s.money, 0, 1e12), rep: real(s.rep, 0, 100), product: real(s.product, 0, 100),
    customers: int(s.customers, 0, 1e9), day: int(s.day, 1, 1e6), hour: int(s.hour, 0, 23),
    speed: [1, 2, 4].includes(s.speed) ? s.speed : fail(),
    desks: int(s.desks, 4, 10), nextId: int(s.nextId, 1, 1e9), won: typeof s.won === 'boolean' ? s.won : fail(),
    selected: s.selected === null ? null : int(s.selected, 0, 1e9),
    employees: list(s.employees, 10).map(person),
    candidates: list(s.candidates, 10).map(person),
    log: list(s.log, 40).map(l => {
      if (!l || typeof l !== 'object' || !LOG_TYPES.has(l.type)) fail();
      return { t: str(l.t, 30), text: str(l.text, 200), type: l.type };
    })
  };
}

module.exports = { normalizeState };
