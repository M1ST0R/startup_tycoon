'use strict';
const { resolveIdentity } = require('./name-generator');
const EmployeeConfig = require('./employee-config');
const FinanceCrisis = require('./crisis');
const ProjectSystem = require('./project-system');
/* Серверная проверка сохранения: структура и допустимые диапазоны.
   Сервер не пересчитывает игру, он лишь не даёт сохранить мусор и слишком большие данные. */

const ROLES = new Set(['dev', 'designer', 'marketer']);
const TASKS = new Set(['code', 'backend', 'frontend', 'ui', 'marketing']);
const STATUSES = new Set(['work', 'rest', 'idle']);
const LOG_TYPES = new Set(['good', 'warn', 'bad', 'info']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hardcore']);
const FLAVOR_DEFAULTS = Object.freeze({ lastTick: -1000, cooldowns: {}, recent: [] });

const fail = () => { throw new Error('invalid state'); };
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : fail());
const real = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail());
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : fail());
const list = (a, max) => (Array.isArray(a) && a.length <= max ? a : fail());

function person(p) {
  if (!p || typeof p !== 'object' || !ROLES.has(p.role) || !STATUSES.has(p.status)) fail();
  if (p.task !== null && !TASKS.has(p.task)) fail();
  const id = int(p.id, 0, 1e9);
  if (p.gender != null && p.gender !== 'male' && p.gender !== 'female') fail();
  if (p.appearance != null) {
    if (typeof p.appearance !== 'object' || Array.isArray(p.appearance)) fail();
    int(p.appearance.hair, 0, 63);
    int(p.appearance.cloth, 0, 3);
    if (p.appearance.sprite !== undefined) int(p.appearance.sprite, 0, 19);
  }
  const salary = int(p.salary, 1, 1e6);
  const traits = EmployeeConfig.normalizeEmployeeTraits(p);
  return {
    id, ...resolveIdentity(p),
    // Пустое/отсутствующее имя разрешено для старых сохранений: клиент назначит его без сброса прогресса.
    name: typeof p.name === 'string' ? p.name.slice(0, 32) : '',
    role: p.role, spec: str(p.spec, 24),
    skill: real(p.skill, 1, 10), tier: traits.tier, skills: traits.skills,
    salary, speed: real(p.speed, 0.5, 2),
    energy: real(p.energy, 0, 100), mood: real(p.mood, 0, 100), task: p.task,
    progress: real(p.progress, 0, 1e4), status: p.status, desk: int(p.desk, -1, 99)
  };
}

function flavorState(value) {
  const result = { ...FLAVOR_DEFAULTS, cooldowns: {}, recent: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (Number.isInteger(value.lastTick) && value.lastTick >= -1e9 && value.lastTick <= 1e9) result.lastTick = value.lastTick;
  if (value.cooldowns && typeof value.cooldowns === 'object' && !Array.isArray(value.cooldowns)) {
    Object.entries(value.cooldowns).slice(0, 32).forEach(([key, tick]) => {
      if (/^[a-zA-Z][a-zA-Z0-9]*$/u.test(key) && Number.isInteger(tick) && tick >= -1e9 && tick <= 1e9) {
        result.cooldowns[key] = tick;
      }
    });
  }
  if (Array.isArray(value.recent)) {
    result.recent = value.recent.slice(0, 14).filter(item => typeof item === 'string').map(item => item.slice(0, 80));
  }
  return result;
}

/** Возвращает «чистую» копию состояния или бросает ошибку, если данные некорректны. */
function normalizeState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || s.v !== 1) fail();
  const activeProject = ProjectSystem.normalize(s.activeProject);
  if (s.activeProject && !activeProject) fail();
  const completedProjects = Array.isArray(s.completedProjects)
    ? s.completedProjects.slice(0, ProjectSystem.BALANCE.historyLimit).map(ProjectSystem.summary).filter(Boolean)
    : [];
  const employees = list(s.employees, 10).map(person);
  if (activeProject) {
    employees.forEach(employee => {
      if (!activeProject.allowedWork.includes(employee.task)) employee.task = ProjectSystem.bestWorkFor(activeProject, employee);
      if (employee.task && employee.status !== 'rest') employee.status = 'work';
      if (!employee.task && employee.status === 'work') employee.status = 'idle';
    });
  } else {
    employees.forEach(employee => {
      if (employee.task === 'backend' || employee.task === 'frontend') employee.task = 'code';
    });
  }
  const projectsCompleted = s.projectsCompleted === undefined
    ? completedProjects.length : int(s.projectsCompleted, 0, 1e6);
  const minNextProjectId = Math.max(1, activeProject ? activeProject.id + 1 : 1, ...completedProjects.map(project => project.id + 1));
  const nextProjectId = s.nextProjectId === undefined ? minNextProjectId : int(s.nextProjectId, minNextProjectId, 1e9);
  return {
    v: 1,
    difficulty: DIFFICULTIES.has(s.difficulty) ? s.difficulty : 'medium',
    // Баланс может быть отрицательным: это долг компании.
    money: real(s.money, EmployeeConfig.BASE.minMoney, EmployeeConfig.BASE.maxMoney), rep: real(s.rep, 0, 100), product: real(s.product, 0, 100),
    customers: int(s.customers, 0, 1e9), day: int(s.day, 1, 1e6), hour: int(s.hour, 0, 23),
    speed: [1, 2, 4].includes(s.speed) ? s.speed : fail(),
    desks: int(s.desks, 4, 10), nextId: int(s.nextId, 1, 1e9), won: typeof s.won === 'boolean' ? s.won : fail(),
    selected: s.selected === null ? null : int(s.selected, 0, 1e9),
    // Старые сохранения не знают о страховке от финансового софтлока.
    rescueUsed: typeof s.rescueUsed === 'boolean' ? s.rescueUsed : false,
    activeProject,
    completedProjects,
    projectsCompleted,
    nextProjectId,
    employees,
    candidates: list(s.candidates, 10).map(person),
    log: list(s.log, 40).map(l => {
      if (!l || typeof l !== 'object' || !LOG_TYPES.has(l.type)) fail();
      return { t: str(l.t, 30), text: str(l.text, 200), type: l.type };
    }),
    // Кризис и поражение необязательны: старые сохранения получают значения по умолчанию.
    crisis: FinanceCrisis.normalizeState(s.crisis),
    gameOver: FinanceCrisis.normalizeGameOver(s.gameOver),
    // Поля необязательны: старые сохранения мигрируют без потери остального прогресса.
    flavor: flavorState(s.flavor)
  };
}

module.exports = { normalizeState };
