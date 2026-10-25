/* Раздел «Задачи»: список сотрудников с их задачами и выбор задачи для одного сотрудника.
 * Модуль только строит DOM-узлы; состояние игры и действия остаются в script.js / compact-ui.js. */
(function (root) {
  'use strict';

  /** Красивые названия задач для игрока (id задач — в employee-config.js). */
  const LABELS = Object.freeze({
    code: Object.freeze({ title: '💻 Разработка продукта', hint: 'Внутренняя разработка' }),
    backend: Object.freeze({ title: '🗄️ Backend', hint: 'Серверная логика и API' }),
    frontend: Object.freeze({ title: '🖥️ Frontend', hint: 'Клиентская часть' }),
    ui: Object.freeze({ title: '🎨 UI', hint: 'Интерфейс и UX' }),
    marketing: Object.freeze({ title: '📣 Маркетинг', hint: 'Привлечение клиентов' })
  });
  const ROOM_SIZE = 4;

  const titleOf = id => (LABELS[id] ? LABELS[id].title : id);
  const roomOf = person => Math.floor(person.desk / ROOM_SIZE);

  function create({ h, portrait, C }) {
    /** Строка сотрудника: портрет, имя и текущая задача. Клик открывает профиль. */
    const personRow = person => h('button', {
      class: 'task-person', type: 'button', 'data-ui': 'employee-open', 'data-value': person.id, 'data-key': `task-person-${person.id}`,
      'aria-label': `${person.name}: ${C.tasks[person.task] ? titleOf(person.task) : 'задача не назначена'}. Открыть профиль`
    }, portrait(person, 'avatar--card'),
      h('span', { class: 'task-person-main' },
        h('b', { class: 'task-person-name' }, person.name),
        h('span', { class: `task-person-task${C.tasks[person.task] ? '' : ' idle'}` },
          C.tasks[person.task] ? titleOf(person.task) : 'Без задачи')));

    /** Все сотрудники, сгруппированные по комнатам. */
    function overview(employees) {
      if (!employees.length) return [h('p', { class: 'mute' }, 'Команда пока пуста. Наймите первого сотрудника.')];
      const byRoom = new Map();
      [...employees].sort((a, b) => a.desk - b.desk).forEach(person => {
        const room = roomOf(person);
        if (!byRoom.has(room)) byRoom.set(room, []);
        byRoom.get(room).push(person);
      });
      const showRooms = byRoom.size > 1;
      return [...byRoom].flatMap(([room, people]) => [
        ...(showRooms ? [h('h3', { class: 'task-room', 'data-key': `task-room-${room}` }, `Комната ${room + 1}`)] : []),
        ...people.map(personRow)
      ]);
    }

    /** Три кнопки выбора задачи для сотрудника. */
    function choices(person, efficiencyOf, activeProject = null) {
      const ids = activeProject ? activeProject.allowedWork : (root.ProjectSystem ? root.ProjectSystem.LEGACY_TASKS : ['code', 'ui', 'marketing']);
      return ids.map(id => C.tasks[id]).filter(Boolean).map(task => {
        const projectProgress = activeProject && root.ProjectSystem
          ? Math.floor(root.ProjectSystem.streamProgress(activeProject, task.id)) : null;
        const detail = activeProject
          ? `${LABELS[task.id] ? LABELS[task.id].hint : task.name} · этап ${projectProgress}% · эффективность ${Math.round(efficiencyOf(person, task.id))}%`
          : `${LABELS[task.id] ? LABELS[task.id].hint : task.name} · эффективность ${Math.round(efficiencyOf(person, task.id))}%`;
        return h('button', {
          class: `task-choice${person.task === task.id ? ' current' : ''}`, type: 'button',
          'data-act': 'assign', 'data-task': task.id, 'data-key': `task-choice-${task.id}`
        }, h('span', { class: 'task-choice-main' },
          h('b', { class: 'task-choice-name' }, titleOf(task.id)),
          h('span', { class: 'task-choice-hint' }, detail)));
      });
    }

    return Object.freeze({ overview, choices });
  }

  root.TaskUI = Object.freeze({ create, LABELS, titleOf });
})(typeof window !== 'undefined' ? window : globalThis);
