/* Presentation state is deliberately separate from the v1 game save. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const titles = { emp: 'Команда', tasks: 'Задачи', startup: 'Стартап', assign: 'Назначить задачу', hire: 'Найм', log: 'Журнал', menu: 'Меню' };

  // Reconcile nodes instead of replacing live controls on every simulation tick.
  function key(node) {
    return node.nodeType === 1 ? node.getAttribute('data-key') || node.id ||
      [node.tagName, node.getAttribute('data-act') || node.getAttribute('data-ui') || '',
        node.getAttribute('data-id') || node.getAttribute('data-value') || node.getAttribute('data-task') || ''].join(':') : '#text';
  }
  function patch(parent, nodes) {
    const wanted = nodes.flat().filter(Boolean);
    wanted.forEach((fresh, index) => {
      let old = parent.childNodes[index];
      if (!old || key(old) !== key(fresh) || old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName) {
        const found = Array.from(parent.childNodes).slice(index + 1).find(n => key(n) === key(fresh) && n.nodeName === fresh.nodeName);
        if (found) { parent.insertBefore(found, old || null); old = found; }
        else { parent.insertBefore(fresh, old || null); return; }
      }
      if (fresh.nodeType === 3) { if (old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue; return; }
      for (const a of Array.from(old.attributes)) if (!fresh.hasAttribute(a.name)) old.removeAttribute(a.name);
      for (const a of Array.from(fresh.attributes)) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
      patch(old, Array.from(fresh.childNodes));
    });
    while (parent.childNodes.length > wanted.length) parent.lastChild.remove();
  }

  function create(d) {
    const { h, btn, stat, tierDisplay, skillRows, portrait, fmt, C } = d;
    let section = null, candidateId = null, hireDetail = false;
    let tabs = { menu: 'game' };
    let pages = new Map(), logSnapshot = null, pageCount = 1, lastFocus = null;
    let frame = 0, lastMeasureKey = '', measuredPages = [], currentContext = '';
    const meter = h('div', { class: 'panel-content ui-measure', 'aria-hidden': 'true' });
    meter.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;height:auto;max-height:none;contain:layout style;';
    document.body.append(meter);
    const state = d.state;
    const taskUI = TaskUI.create({ h, portrait, C });
    const action = (label, name, props = {}) => h('button', { class: 'btn sec', type: 'button', 'data-act': name, ...props }, label);
    const control = (label, name, value, props = {}) => h('button', { class: 'btn sec', type: 'button', 'data-ui': name, 'data-value': value, ...props }, label);
    const text = (value, cls = '') => h('p', { class: cls }, value);
    const row = (label, value) => h('div', { class: 'info-row' }, h('span', { class: 'mute' }, label), h('b', {}, value));
    const modalOpen = () => !$('difficultySetup').hidden || !$('decisionModal').hidden || !$('gameOverScreen').hidden || !$('tutorialShade').hidden;
    const tab = (value, label) => control(label, 'tab', value, { class: 'panel-tab', 'aria-pressed': String(tabs[section] === value) });
    const pagingButtons = (name, count, index) => [
      control('‹', name, -1, { class: 'btn sec icon-btn', 'aria-label': 'Предыдущий', disabled: index <= 0 }),
      h('span', { class: 'page-count', 'aria-live': 'polite' }, `${index + 1} / ${count}`),
      control('›', name, 1, { class: 'btn sec icon-btn', 'aria-label': 'Следующий', disabled: index >= count - 1 })
    ];

    function open(value, toggle = false) {
      if (!titles[value] || !state() || modalOpen()) return;
      if (toggle && section === value) return close();
      if (!section) lastFocus = document.activeElement;
      if (section !== value && value === 'log') logSnapshot = state().log.slice();
      if (section !== value && value === 'hire') hireDetail = false;
      section = value;
      if ((value === 'emp' || value === 'assign') && !d.selected() && state().employees.length) d.select(state().employees[0].id);
      render();
      requestAnimationFrame(() => { if (!modalOpen()) $('panelTitle').focus({ preventScroll: true }); });
    }
    function close() {
      section = null; render();
      if (lastFocus?.isConnected && !lastFocus.closest('[hidden]')) lastFocus.focus({ preventScroll: true });
    }
    function reset() {
      section = null; candidateId = null; hireDetail = false; pages.clear(); logSnapshot = null;
      tabs = { menu: 'game' }; lastMeasureKey = '';
      if ($('panelShell')) { $('panelShell').hidden = true; $('gameView').classList.remove('panel-open'); }
    }
    function personHeader(person) {
      return h('div', { class: 'person-head', 'data-key': `person-${person.id}` },
        portrait(person, 'avatar--card'), h('div', {}, h('h3', {}, person.name), tierDisplay(person)));
    }

    /** Карточка сотрудника: состояние, навыки, условия найма и управление (бывшие вкладки «Сотрудник» и «Управление»). */
    function employeeContent(person) {
      const task = C.tasks[person.task];
      return [personHeader(person),
        row('Статус', d.STATUS[person.status]),
        stat('Энергия', `${Math.round(person.energy)}%`, person.energy, 100, 'en'),
        stat('Настроение', `${Math.round(person.mood)}%`, person.mood, 100, 'mood'),
        text(task ? `${task.name} · внутренняя работа над «${d.StartupSystem.typeOf(state().startupType).name}»` : 'Задача не назначена', 'mute'),
        ...(task ? [stat('Прогресс задачи', `${Math.floor(person.progress / d.taskWork(task) * 100)}%`, person.progress, d.taskWork(task), 'pr')] : []),
        ...d.warnings(person).map(w => text(w, 'warnline')),
        text(`${C.roles[person.role].name} · ${person.spec}`, 'mute'),
        ...skillRows(person),
        row('Зарплата / день', fmt(person.salary)),
        row('Скорость', `×${person.speed.toFixed(2)}`),
        ...(task ? [action('Снять с задачи', 'clear')] : []),
        action('Уволить', 'fire', { class: 'btn danger' })];
    }

    function panelData() {
      const s = state(), person = d.selected(), api = d.api();
      let content = [], tools = [], tabNodes = [], actions = [], context = section;
      if (section === 'emp') {
        if (!person) return { content: [text('Команда пока пуста. Наймите первого сотрудника.')], actions: [control('Найти сотрудника', 'open', 'hire')], context };
        tools = pagingButtons('employee', s.employees.length, s.employees.indexOf(person));
        context += `:${person.id}`;
        content = employeeContent(person);
        actions = [control('Назначить задачу', 'open', 'assign'), action(person.status === 'rest' ? 'К работе' : 'Отдых', person.status === 'rest' ? 'back' : 'rest', { 'data-key': 'employee-rest' })];
      } else if (section === 'tasks') {
        const startupType = d.StartupSystem.typeOf(s.startupType);
        const stage = d.StartupSystem.stageOf(s.startupStage);
        content = [
          text(`${startupType.icon} ${startupType.name}: задачи сотрудников постоянно развивают один продукт. Отдельных заказов и выплат за задачи нет.`, 'mute'),
          text(`Сейчас этап «${stage.name}». Бонус: ${stage.bonus}.`, 'mute'),
          ...taskUI.overview(s.employees)
        ];
        actions = s.employees.length ? [] : [control('Нанять сотрудника', 'open', 'hire')];
      } else if (section === 'startup') {
        const startup = d.StartupSystem.typeOf(s.startupType);
        const stageIndex = d.StartupSystem.stageIndex(s);
        const stage = d.StartupSystem.stageOf(stageIndex);
        const nextStage = d.StartupSystem.BALANCE.stages[stageIndex + 1];
        const difficulty = d.difficultyConfig();
        const progress = d.StartupSystem.stageProgress(s);
        context += `:${s.startupType}:${stageIndex}`;
        content = [
          h('div', { class: 'startup-panel-heading', 'data-key': 'startup-overview' },
            h('span', { class: 'startup-type-icon', 'aria-hidden': 'true' }, startup.icon),
            h('div', {}, h('h3', {}, startup.name), h('p', { class: 'mute' }, `Один продукт на всю кампанию · ${stage.name}`))),
          text(startup.description, 'mute'),
          row('Сильные направления', startup.focus),
          row('Доход за час сейчас', fmt(d.incomeTick())),
          row('Продуктовое качество', `${Math.floor(s.product)} / 100`),
          stat('Качество продукта', `${Math.floor(s.product)}%`, s.product, 100, 'pr'),
          row('Объём выполненной работы', `${Math.floor(s.startupProgress || 0).toLocaleString('ru-RU')} ед.`),
          h('h3', { class: 'startup-subtitle' }, 'Этап развития'),
          h('div', { class: 'startup-panel-heading', 'data-key': `startup-stage-${stage.id}` },
            h('span', { class: 'startup-type-icon', 'aria-hidden': 'true' }, stage.icon),
            h('div', {}, h('h3', {}, stage.name), h('p', { class: 'mute' }, stage.description))),
          row('Бонус этапа', stage.bonus),
          ...(nextStage ? [
            stat(`До этапа «${nextStage.name}»`, `${progress}%`, progress, 100, 'pr'),
            row('Нужно качество продукта', `${Math.floor(s.product)} / ${nextStage.product}%`),
            row('Нужно клиентов', `${s.customers} / ${nextStage.customers}`),
            row('Нужна репутация', `${Math.floor(s.rep)} / ${nextStage.reputation}`)
          ] : [text('Достигнуто масштабирование. Это не конец игры: качество, аудитория и доход продолжают расти.', 'good')]),
          h('h3', { class: 'startup-subtitle' }, 'Ключевые показатели'),
          row('Клиенты', s.customers.toLocaleString('ru-RU')),
          row('Репутация', `${Math.floor(s.rep)} / 100`),
          row('Доход / день', fmt(d.incomeTick() * 24)),
          row('Зарплаты и аренда / день', fmt(d.salaries() + d.rentCost())),
          text(`Выполненные задачи повышают качество продукта, репутацию или клиентскую базу. Выручка начисляется каждый игровой час по клиентам; бонус этапа, тип стартапа и репутация влияют на её размер.`, 'mute'),
          text(s.won ? '🏆 Первый рубеж сложности достигнут — продолжай развивать стартап.' : `Первый рубеж: качество ${difficulty.goal.product}%, ${difficulty.goal.customers} клиентов и репутация ${difficulty.goal.reputation}. После него игра продолжается.`, s.won ? 'good' : 'mute')
        ];
        actions = s.employees.length ? [control('Распределить задачи', 'open', 'assign')] : [control('Нанять первого сотрудника', 'open', 'hire')];
      } else if (section === 'assign') {
        if (!person) return { content: [text('Сначала наймите сотрудника.')], actions: [control('Найти сотрудника', 'open', 'hire')], context };
        context += `:${person.id}`;
        tools = [control('‹ Назад', 'open', 'emp', { class: 'btn sec' })];
        const task = C.tasks[person.task];
        content = [personHeader(person), text(task ? `Сейчас: ${TaskUI.titleOf(task.id)}` : 'Задача не назначена', 'mute'),
          ...taskUI.choices(person, (p, id) => d.efficiency(p, id) / C.baseSpeed * 100, s.startupType)];
      } else if (section === 'hire') {
        const c = hireDetail ? s.candidates.find(person => person.id === candidateId) : null;
        if (!c) hireDetail = false;
        context += hireDetail ? `:detail:${c.id}` : ':pool';
        if (hireDetail) {
          tools = [control('‹ Кандидаты', 'candidate-back', '', { class: 'btn sec' })];
          content = [personHeader(c), text(`${C.roles[c.role].name} · ${c.spec}`, 'mute'),
            row('Оклад / день', fmt(c.salary)), row('Скорость', `×${c.speed.toFixed(2)}`), ...skillRows(c),
            ...(s.employees.length >= s.desks ? [text('Нет свободных мест. Расширьте офис.', 'warnline')] : [])];
          actions = [action(`Нанять ${fmt(d.hireCost(c))}`, 'hire', { class: 'btn', 'data-id': c.id,
            disabled: s.money < d.hireCost(c) || s.employees.length >= s.desks })];
        } else {
          tools = [h('span', { class: 'mute' }, `${s.candidates.length} в пуле`)];
          content = s.candidates.length ? [h('div', { class: 'candidate-pool', 'data-key': 'candidate-pool', style: `--pool-count:${Math.min(4, s.candidates.length)}` },
            ...s.candidates.map(c => h('button', {
              class: 'candidate-card', type: 'button', 'data-ui': 'candidate-details', 'data-value': c.id,
              'data-key': `candidate-${c.id}`, title: c.name,
              'aria-label': `${c.name}. ${C.roles[c.role].name}. ${c.tier} звёзд. Найм ${fmt(d.hireCost(c))}. Подробнее`
            }, portrait(c, 'avatar--card'),
              h('span', { class: 'candidate-main' }, h('b', { class: 'candidate-name' }, c.name),
                h('span', { class: 'candidate-role' }, C.roles[c.role].name)),
              h('span', { class: 'candidate-stars', 'aria-hidden': 'true' },
                ...Array.from({ length: EmployeeConfig.safeTier(c.tier) || 1 }, () => h('i', { class: 'rating-star' }))),
              h('span', { class: 'candidate-fee' }, fmt(d.hireCost(c))))))
          ] : [text('Кандидатов нет. Обновите список.')];
          actions = [action(`Обновить пул · ${fmt(d.refreshCost())}`, 'refresh', {
            'aria-label': `Обновить кандидатов за ${fmt(d.refreshCost())}`, disabled: s.money < d.refreshCost() })];
        }
      } else if (section === 'log') {
        if (!logSnapshot) logSnapshot = s.log.slice();
        const changed = logSnapshot[0] !== s.log[0];
        tools = [control(changed ? 'Новые' : 'Обновить', 'log-refresh', '', { class: 'btn sec' })];
        content = logSnapshot.length ? logSnapshot.map((l, i) => h('p', { class: `log-entry ${l.type}`, 'data-key': `log-${i}` },
          h('span', { class: 'lt' }, l.t), ' · ', l.text)) : [text('Здесь появятся события компании.', 'mute')];
      } else if (section === 'menu') {
        const hasNotice = !!api.hold || api.legacy;
        tabNodes = [tab('game', 'Игра'), tab('company', 'Компания'), ...(hasNotice ? [tab('notices', 'Важно')] : [])];
        if (!hasNotice && tabs.menu === 'notices') tabs.menu = 'game';
        context += `:${tabs.menu}`;
        if (tabs.menu === 'company') {
          const diff = d.difficultyConfig(), goal = diff.goal;
          content = [...d.crisisBlocks(), row('Тип стартапа', d.StartupSystem.typeOf(s.startupType).name), row('Этап', d.StartupSystem.stageOf(s.startupStage).name),
            row('Баланс', fmt(s.money)), row('Доход / день', fmt(d.incomeTick() * 24)), row('Расходы / день', fmt(d.salaries() + d.rentCost())),
            row('Зарплаты / день', fmt(d.salaries())), row('Аренда / день', fmt(d.rentCost())), row('Сложность', diff.name),
            row('Качество продукта', `${Math.floor(s.product)} / ${diff.goal.product}`), row('Клиенты', `${s.customers} / ${diff.goal.customers}`), row('Репутация', `${Math.floor(s.rep)} / ${diff.goal.reputation}`),
            text(s.won ? 'Первый рубеж достигнут; развитие продолжается.' : 'Достигни целевых показателей, продолжая развивать тот же продукт.', s.won ? 'good' : 'mute'),
            text(`Скорость работы ×${diff.employeeSpeed.toFixed(2)} · трудоёмкость задач ×${diff.taskWorkMultiplier.toFixed(2)} · события ×${diff.forceMajeureFrequency.toFixed(2)}`, 'mute'),
            text(`Оклады ×${diff.salaryMultiplier.toFixed(2)} · аренда ×${diff.rentMultiplier.toFixed(2)} · доход ×${diff.incomeMultiplier.toFixed(2)} · цена найма ×${diff.hireFeeMultiplier.toFixed(2)}`, 'mute')];
        } else if (tabs.menu === 'help') {
          tools = [control('‹ Назад', 'help-back', '')];
          content = [h('h3', {}, 'Как устроен найм'),
            text(`В новом пуле ${C.candidates} кандидата. Откройте карточку, чтобы сравнить навыки, оклад и скорость.`),
            text('Вероятность рейтинга при обновлении пула:', 'mute'),
            ...EmployeeConfig.TIERS.map(t => row('★'.repeat(t.id), `${t.chance}%`)),
            text(`Стоимость найма — оклад × ${d.difficultyConfig().hireFeeMultiplier.toLocaleString('ru-RU')} (зависит от сложности). Подходящие задаче навыки повышают эффективность.`, 'mute')];
        } else if (tabs.menu === 'notices') {
          if (api.hold === 'conflict') content.push(text('Сохранение изменилось на другом устройстве. Автосохранение приостановлено.'),
            action('Загрузить с сервера', 'noticeLoad'), action('Сохранить мою версию', 'noticeForce'));
          if (api.hold === 'corrupt') content.push(text('Сохранение повреждено. Автосохранение выключено.'), action('Новая кампания', 'noticeForce'));
          if (api.hold === 'noload') content.push(text('Не удалось загрузить игру. Автосохранение выключено, чтобы сохранить прогресс.'), action('Повторить загрузку', 'retryLoad'));
          if (api.legacy) content.push(text('В браузере найдено старое сохранение.'), action('Импортировать', 'importLocal'), action('Удалить локальное', 'dropLocal'));
        } else content = [row('Аккаунт', api.user || ''), text($('saveStatus').textContent || 'Автосохранение включено', 'mute'),
          h('div', { class: 'menu-grid' }, action('Сохранить', 'save'), action('Загрузить', 'load')),
          h('div', { class: 'menu-grid' }, action('Новая игра', 'reset'), action('Выйти', 'logout')),
          h('div', { class: 'menu-grid' }, control('Обучение', 'tutorial', ''), control('Справка по игре', 'help', ''))];
      }
      return { content, tools, tabNodes, actions, context };
    }

    function heightOf(nodes) { meter.replaceChildren(...nodes.map(n => n.cloneNode(true))); return meter.getBoundingClientRect().height; }
    function splitBlock(node, limit) {
      if (heightOf([node]) <= limit + 1) return [node];
      if (node.children.length && node.tagName !== 'P' && !node.matches('button,.skill-row,.info-row')) {
        return Array.from(node.childNodes).filter(n => n.nodeType === 1 || n.textContent.trim()).flatMap(n =>
          splitBlock(n.nodeType === 3 ? text(n.textContent) : n.cloneNode(true), limit));
      }
      if (node.matches('button,img,.avatar,.skill-row,.info-row')) return [node];
      const words = node.textContent.split(/\s+/).filter(Boolean), chunks = [];
      while (words.length) {
        let lo = 1, hi = words.length, count = 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1, probe = node.cloneNode(false); probe.textContent = words.slice(0, mid).join(' ');
          if (heightOf([probe]) <= limit + 1) { count = mid; lo = mid + 1; } else hi = mid - 1;
        }
        const chunk = node.cloneNode(false); chunk.textContent = words.splice(0, count).join(' ');
        chunk.setAttribute('data-key', `${node.getAttribute('data-key') || 'text'}-part-${chunks.length}`); chunks.push(chunk);
      }
      return chunks;
    }
    function paginate(content, limit, width) {
      meter.style.width = `${width}px`;
      const result = []; let page = [];
      content.flatMap(n => splitBlock(n, limit)).forEach(node => {
        if (page.length && heightOf([...page, node]) > limit + 1) { result.push(page); page = []; }
        page.push(node);
      });
      if (page.length || !result.length) result.push(page);
      meter.replaceChildren(); return result;
    }
    function drawContent(data) {
      const body = $('panelBody'), pager = $('panelPager');
      // Measure the unpaged capacity without temporarily hiding the focused pager.
      // Hiding a live button even for one layout pass can drop keyboard focus.
      if (!pager.children.length) patch(pager, pagingButtons('page', 1, 0));
      const footer = $('panelFooter');
      const css = getComputedStyle(body);
      const verticalPadding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
      const horizontalPadding = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight);
      let height = Math.floor(body.clientHeight - verticalPadding), width = body.clientWidth - horizontalPadding;
      if (height < 1 || width < 1) return;
      meter.style.width = `${width}px`;
      if (section === 'hire' && !hireDetail && heightOf(data.content) > height + 1) {
        // The pool is an overview: keep every candidate visible; details retain the full name and stats.
        data.content[0]?.classList.add('pool-compact');
      }
      const separatePager = getComputedStyle(footer).display === 'contents' || footer.classList.contains('no-actions');
      const pagerHeight = separatePager && !pager.hidden
        ? Math.max(44, pager.getBoundingClientRect().height) + parseFloat(getComputedStyle($('panelShell')).rowGap || 0) : 0;
      const needsPaging = heightOf(data.content) > height + pagerHeight + 1;
      pager.hidden = !needsPaging; footer.classList.toggle('paged', needsPaging);
      height = Math.floor(body.clientHeight - verticalPadding);
      const signature = `${width}:${height}:` + data.content.map(n => n.outerHTML).join('');
      if (signature !== lastMeasureKey) {
        measuredPages = paginate(data.content, Math.max(1, height), width); lastMeasureKey = signature;
      }
      pageCount = measuredPages.length; currentContext = data.context;
      const index = Math.min(pages.get(currentContext) || 0, pageCount - 1); pages.set(currentContext, index);
      patch($('panelContent'), measuredPages[index].map(n => n.cloneNode(true)));
      patch(pager, pagingButtons('page', pageCount, index));
      pager.hidden = pageCount <= 1;
      $('panelFooter').classList.toggle('paged', pageCount > 1);
      $('panelTitle').dataset.page = pageCount > 1 ? `Стр. ${index + 1} / ${pageCount}` : '';
    }

    function renderOffice() {
      const s = state(); if (!s || $('gameView').hidden) return;
      const pages = Math.ceil(s.desks / 4), officePage = Math.min(d.officePage(), pages - 1);
      const seats = [], bubbles = [];
      for (let slot = 0; slot < 4; slot++) {
        const i = officePage * 4 + slot; if (i >= s.desks) continue;
        const e = s.employees.find(x => x.desk === i), selected = !!e && s.selected === e.id;
        const speech = e ? d.Speech.getBubble(e.id) : null;
        if (speech) bubbles.push(h('div', { class: 'speech-bubble', 'data-key': `speech-${e.id}`, role: 'status',
          style: `--speech-anchor-x:${slot % 2 ? 68.5 : 32.5}%;--speech-anchor-y:${slot < 2 ? 40 : 62}%` }, h('span', { class: 'speech-text' }, speech.text)));
        seats.push(h('div', { class: `office-seat slot-${slot}${e ? ` ${e.status}` : ' empty'}${selected ? ' sel' : ''}`,
          'data-key': `seat-${i}`, 'data-act': e ? 'select' : null, 'data-id': e?.id,
          role: e ? 'button' : null, tabindex: e ? 0 : null, 'aria-label': e ? `${e.name}: ${d.STATUS[e.status]}` : null },
          e ? portrait(e, 'avatar--office') : null, CharacterArt.desk(i),
          selected ? h('span', { class: 'seat-energy', 'aria-hidden': 'true' }, `⚡ ${Math.round(e.energy)}%`) : null,
          e && d.warnings(e).length ? h('span', { class: 'seat-warning', title: d.warnings(e).join('. ') }, '!') : null));
      }
      let scene = $('office').querySelector('.office-scene');
      if (!scene) { scene = h('div', { class: 'office-scene' }); $('office').append(scene); }
      patch(scene, [...seats, ...bubbles]);
      $('officeRoom').textContent = `${officePage + 1} / ${pages}`;
      $('officeOccupancy').textContent = `${s.employees.length}/${s.desks} мест`;
      const expand = $('expandButton');
      expand.disabled = s.desks >= C.maxDesks || s.money < d.deskCost();
      expand.textContent = s.desks >= C.maxDesks ? 'Максимум' : `+${C.desksPerUpgrade} · ${fmt(d.deskCost())}`;
      expand.title = s.desks >= C.maxDesks ? 'Офис максимального размера' : `Расширить офис: ${fmt(d.deskCost())}`;
      document.querySelector('[data-act="officePrev"]').disabled = officePage <= 0;
      document.querySelector('[data-act="officeNext"]').disabled = officePage >= pages - 1;
      if ($('officeHint')) $('officeHint').textContent = s.employees.length ? 'Нажмите на персонажа, чтобы управлять им' : 'Офис ждёт команду. Откройте «Найм»';
      scene.classList.toggle('scene-small', scene.clientWidth < 180);
      // Keep undersized preview decorative while its controls are available in Team.
      scene.inert = scene.clientWidth < 152;
    }
    function renderTop() {
      const s = state();
      const compact = value => Math.floor(value).toLocaleString('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
      $('sMoney').textContent = Math.abs(s.money) >= 100000 ? '$' + compact(s.money) : fmt(s.money);
      $('sMoney').classList.toggle('neg', s.money < 0);
      $('sMoney').closest('.stat').title = s.money < 0 ? `Долг компании: ${fmt(-s.money)}` : `Баланс: ${fmt(s.money)}`;
      DailyBalance.render($('sMoneyDelta'), d.incomeTick() * 24, d.salaries() + d.rentCost(),
        value => Math.abs(value) >= 100000 ? (value < 0 ? '−' : '') + '$' + compact(Math.abs(value)) : fmt(value));
      const strip = $('crisisStrip'), crisisText = d.crisisStrip();
      strip.hidden = !crisisText; strip.textContent = crisisText ? `⚠ ${crisisText}` : '';
      $('sCust').textContent = s.customers >= 10000 ? compact(s.customers) : s.customers;
      $('sCust').parentElement.title = `Клиенты: ${s.customers.toLocaleString('ru-RU')}`;
      $('sRep').textContent = Math.floor(s.rep);
      const productProgress = Math.max(0, Math.min(100, Number(s.product) || 0));
      const productProgressInt = Math.floor(productProgress);
      const productStat = $('sProd').closest('.stat');
      $('sProd').textContent = `${productProgressInt}%`;
      const productFill = $('sProdProgress');
      if (productFill) productFill.style.width = `${productProgress}%`;
      const productTrack = productStat.querySelector('[role="progressbar"]');
      if (productTrack) productTrack.setAttribute('aria-valuenow', String(productProgressInt));
      const productDescription = `Качество единого продукта: ${productProgressInt}%. Задачи команды развивают стартап постоянно; тип и этап можно посмотреть в разделе «Стартап».`;
      productStat.title = productDescription;
      productStat.setAttribute('aria-label', productDescription);
      $('sTime').textContent = d.timeStr();
      $('bPause').textContent = d.paused() ? '▶' : 'Ⅱ';
      $('bPause').setAttribute('aria-label', d.paused() ? 'Продолжить игру' : 'Приостановить игру');
      $('bPause').title = d.paused() ? 'Продолжить' : 'Пауза';
      $('bPause').setAttribute('aria-pressed', String(d.paused()));
      $('speedButton').textContent = `${s.speed}×`;
    }
    function render() {
      if (!state() || $('gameView').hidden) return;
      renderTop();
      $('gameView').classList.toggle('panel-open', !!section);
      $('gameView').classList.toggle('hire-pool-open', section === 'hire' && !hireDetail);
      $('panelShell').hidden = !section;
      const navSection = section === 'assign' ? 'emp' : section;   // «Назначить задачу» — часть карточки сотрудника
      document.querySelectorAll('[data-ui="panel"]').forEach(n => {
        n.classList.toggle('on', n.dataset.value === navSection); n.setAttribute('aria-expanded', String(n.dataset.value === navSection));
      });
      if (section) {
        $('panelShell').dataset.section = section; $('panelTitle').textContent = section === 'hire' && hireDetail ? 'Кандидат' : titles[section];
        const data = panelData();
        $('panelFooter').classList.toggle('no-actions', !data.actions?.length);
        for (const [id, nodes] of [['panelTools', data.tools], ['panelTabs', data.tabNodes], ['panelActions', data.actions]]) {
          patch($(id), nodes || []); $(id).hidden = !nodes?.length;
        }
        drawContent(data);
      }
      renderOffice();
    }
    function scheduleLayout() {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; lastMeasureKey = ''; render(); });
    }
    function handle(ev) {
      const el = ev.target.closest('[data-ui]');
      if (!el || el.disabled || !state() || $('gameView').hidden || modalOpen()) return;
      ev.preventDefault();
      const value = el.dataset.value;
      let focusAfter = null;
      switch (el.dataset.ui) {
        case 'panel': open(value, true); return;
        case 'open': open(value); return;
        case 'close': close(); return;
        case 'company': tabs.menu = 'company'; open('menu'); return;
        case 'tab': tabs[section] = value; break;
        case 'employee-open': if (!state().employees.some(e => e.id === Number(value))) return; d.select(Number(value)); open('emp'); return;
        case 'speed': d.setSpeed(C.speeds[(C.speeds.indexOf(state().speed) + 1) % C.speeds.length]); break;
        case 'employee': {
          const people = state().employees, index = people.indexOf(d.selected());
          const next = people[index + Number(value)]; if (next) d.select(next.id); break;
        }
        case 'candidate-details':
          if (!state().candidates.some(c => c.id === Number(value))) return;
          candidateId = Number(value); hireDetail = true; pages.delete(`hire:detail:${candidateId}`); focusAfter = 'details'; break;
        case 'candidate-back': hireDetail = false; focusAfter = 'pool'; break;
        case 'tutorial': d.startTutorial(); return;
        case 'help': tabs.menu = 'help'; break;
        case 'help-back': tabs.menu = 'game'; break;
        case 'page': pages.set(currentContext, Math.max(0, Math.min(pageCount - 1, (pages.get(currentContext) || 0) + Number(value)))); break;
        case 'log-refresh': logSnapshot = state().log.slice(); pages.set('log', 0); break;
        default: return;
      }
      render();
      if (focusAfter && !modalOpen()) {
        const target = focusAfter === 'pool' ? document.querySelector(`[data-ui="candidate-details"][data-value="${candidateId}"]`) : $('panelTitle');
        target?.focus({ preventScroll: true });
      }
    }
    document.addEventListener('click', handle);
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && section && !modalOpen()) { ev.preventDefault(); close(); } });
    const resize = new ResizeObserver(scheduleLayout); resize.observe($('panelBody')); resize.observe($('office'));
    window.addEventListener('resize', scheduleLayout);
    window.visualViewport?.addEventListener('resize', scheduleLayout);
    document.fonts?.ready.then(scheduleLayout);
    return { open, close, reset, render, renderOffice, scheduleLayout,
      afterAction(action) {
        if (action === 'fire' && !d.selected() && state().employees.length) d.select(state().employees[0].id);
        if (action === 'refresh') hireDetail = false;
        if (action === 'hire') {
          hireDetail = false; candidateId = null;
          requestAnimationFrame(() => {
            if (section === 'hire' && !modalOpen()) (document.querySelector('[data-ui="candidate-details"]') || $('panelTitle')).focus({ preventScroll: true });
          });
        }
        if (action === 'select' || action === 'assign') open('emp');
      },
      get section() { return section; } };
  }
  root.CompactUI = Object.freeze({ create, patch });
})(typeof window !== 'undefined' ? window : globalThis);
