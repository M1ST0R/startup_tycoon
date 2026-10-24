'use strict';

// Loaded only by the temporary test proxy, never by the production application.
(async () => {
  const config = new URLSearchParams(parent.location.search);
  const checks = [], errors = [];
  const wait = async (condition, name) => {
    for (let i = 0; i < 1000; i++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out: ' + name);
  };
  const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
  const visible = element => !!element && !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
  const query = selector => document.querySelector(selector);
  const click = selector => {
    const element = typeof selector === 'string' ? query(selector) : selector;
    if (!element) throw new Error('Missing control: ' + selector);
    if (!visible(element)) throw new Error('Hidden control: ' + (element.outerHTML || selector));
    if (element.disabled) throw new Error('Disabled control: ' + element.outerHTML);
    element.click();
  };
  const act = action => click(`[data-act="${action}"]`);
  const reachAction = async action => {
    const available = () => [...document.querySelectorAll(`#panelShell [data-act="${action}"]`)].find(visible);
    for (let page = 0; page < 30 && !available(); page++) {
      const next = query('#panelPager [data-ui="page"][data-value="1"]');
      if (!next || next.disabled || !visible(next)) break;
      click(next); await settle(); layout('action page ' + action);
    }
    click(available());
  };
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const open = async section => {
    await ignoreEvent();
    if (query('#panelShell').hidden || query('#panelShell').dataset.section !== section) click(`[data-ui="panel"][data-value="${section}"]`);
    await settle();
    check(visible(query('#panelShell')) && query('#panelShell').dataset.section === section, 'section opens: ' + section);
  };
  const bounds = (element, name) => {
    if (!visible(element)) return;
    const box = element.getBoundingClientRect();
    check(box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
      `${name} fits viewport: ${JSON.stringify({ left: box.left, top: box.top, right: box.right, bottom: box.bottom })}`);
  };
  const layout = name => {
    check(document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1, name + ': page has no scrolling');
    for (const element of document.querySelectorAll('button,input,[role="button"]')) {
      if (element.closest('[inert]') || !visible(element)) continue;
      bounds(element, name + ': ' + (element.id || element.dataset.ui || element.dataset.act || element.textContent).slice(0, 60));
      const target = element.getBoundingClientRect();
      check(target.width >= 43 && target.height >= 43,
        `${name}: touch target ${element.id || element.dataset.ui || element.dataset.act || element.textContent} is ${target.width}x${target.height}`);
    }
    for (const id of ['panelBody', 'panelContent', 'panelShell', 'officeWrap']) {
      const element = query('#' + id);
      if (!visible(element)) continue;
      check(element.scrollHeight <= element.clientHeight + 2 && element.scrollWidth <= element.clientWidth + 2,
        `${name}: ${id} content fits (${element.scrollWidth}x${element.scrollHeight}/${element.clientWidth}x${element.clientHeight})`);
    }
  };
  const ignoreEvent = async () => {
    if (!query('#forceMajeureModal').hidden) {
      const ignore = [...document.querySelectorAll('#fmChoices button')].find(button => button.textContent === 'Игнорировать');
      if (!visible(ignore)) {
        // Overlay pagination keeps all original choices in the DOM; advance to its page.
        for (let i = 0; i < 10 && !visible(ignore); i++) {
          const next = [...document.querySelectorAll('#forceMajeureModal button')].find(button => visible(button) && /след|впер|далее|→|›/i.test(button.textContent + ' ' + button.getAttribute('aria-label')));
          if (!next) break;
          click(next); await settle();
        }
      }
      click(ignore); await settle();
    }
  };
  const pauseGame = () => { if (!paused) act('pause'); };
  const form = async (id, username) => {
    const element = query(id);
    element.elements.username.value = username;
    element.elements.password.value = 'TemporaryCheck123';
    if (element.elements.password2) element.elements.password2.value = 'TemporaryCheck123';
    for (let step = 0; step < 4 && !visible(element.querySelector('[type="submit"]')); step++) {
      const next = [...element.querySelectorAll('button')].find(button => visible(button) && button.textContent === 'Далее');
      click(next); await settle(); layout('auth step ' + step);
    }
    click(element.querySelector('[type="submit"]'));
  };
  addEventListener('error', event => { if (event.error) errors.push(event.error.stack || event.message); });
  addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  window.confirm = () => true;
  try {
    await wait(() => visible(query('#authView')), 'login');
    await settle(); layout('login');
    click('#tabRegister'); await settle(); layout('register');
    if (innerWidth <= 390) {
      const fullHeight = frameElement.height;
      frameElement.height = '300';
      await wait(() => parseInt(document.documentElement.style.getPropertyValue('--overlay-height'), 10) === innerHeight, 'overlay follows keyboard-sized viewport');
      await settle(); layout('keyboard-sized viewport');
      frameElement.height = fullHeight;
      await wait(() => parseInt(document.documentElement.style.getPropertyValue('--overlay-height'), 10) === innerHeight, 'overlay restores full viewport');
      await settle();
    }
    await form('#formRegister', config.get('user'));
    await wait(() => visible(query('#difficultySetup')), 'difficulty');
    await settle(); layout('difficulty');
    click(`[data-act="diff-select"][data-v="${config.get('difficulty')}"]`);
    act('start-difficulty');
    await wait(() => !visible(query('#difficultySetup')) && API.rev > 0 && !API.busy, 'campaign saved');
    pauseGame(); await settle(); layout('office');
    check(innerWidth === Number(config.get('width')) && innerHeight === Number(config.get('height')), 'exact viewport');
    check(S.difficulty === config.get('difficulty'), 'difficulty selected');
    const oldDirty = API.dirty, oldPaused = paused;
    await open('hire'); layout('hire');
    check(S.candidates.length === 3, 'new pool has three candidates');
    check([...document.querySelectorAll('[data-ui="candidate-details"]')].filter(visible).length === 3, 'all three candidates visible together');
    check(query('#panelPager').hidden, 'candidate pool needs no paging');
    check(!query('#panelTabs [data-value="skills"]') && !query('#panelTabs [data-value="chances"]'), 'hire has no skills or chances tabs');
    check(API.dirty === oldDirty && paused === oldPaused, 'navigation does not dirty or pause game');
    S.candidates.push(genCandidate()); render(); await settle(); layout('legacy four-candidate pool');
    check([...document.querySelectorAll('[data-ui="candidate-details"]')].filter(visible).length === 4, 'legacy fourth candidate remains available');
    S.candidates.pop(); render(); await settle();
    await wait(() => [...document.querySelectorAll('#panelShell .avatar-sprite')].every(image => image.complete && image.naturalWidth > 0), 'portraits');
    const chosenCandidate = S.candidates[1];
    click(document.querySelectorAll('[data-ui="candidate-details"]')[1]); await settle(); layout('candidate details');
    check(Number(query('[data-act="hire"]').dataset.id) === chosenCandidate.id, 'card opens chosen candidate');
    check(document.activeElement === query('#panelTitle'), 'candidate detail receives keyboard focus');
    let detailText = '';
    for (let page = 0; page < 20; page++) {
      detailText += query('#panelContent').textContent;
      const next = query('#panelPager [data-value="1"]');
      if (!visible(next) || next.disabled) break;
      click(next); await settle(); layout('candidate detail page');
    }
    check(Object.keys(chosenCandidate.skills).every(key => detailText.includes(EmployeeConfig.SKILLS[key].label)), 'all skills are part of candidate detail');
    click('[data-ui="candidate-back"]'); await settle();
    check(document.activeElement.dataset.value === String(chosenCandidate.id), 'return focuses same candidate');
    click(`[data-ui="candidate-details"][data-value="${chosenCandidate.id}"]`); await settle();
    act('hire');
    await settle();
    check(S.employees.length === 1, 'hire control');
    check(!query('#forceMajeureModal').hidden, 'first hire event');
    layout('event');
    const oldHour = S.hour; tick(); check(S.hour === oldHour, 'event pauses tick');
    await ignoreEvent();
    check(paused, 'event restores pause');
    await open('tasks'); layout('tasks');
    act('assign');
    check(!!sel().task, 'assign control');
    await open('emp'); layout('employee');
    act('rest'); check(sel().status === 'rest', 'rest control');
    act('back'); check(sel().status === 'work', 'back control');
    const restButton = query('[data-act="rest"]');
    restButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7 }));
    restButton.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 7 }));
    check(sel().status === 'rest', 'pointer activates rest once');
    const backButton = query('[data-act="back"]'); backButton.focus();
    backButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7 }));
    sel().energy = 96; workEmployee(sel()); render();
    check(document.activeElement === backButton && backButton.dataset.act === 'rest', 'auto return preserves focused rest control');
    backButton.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 7 }));
    check(sel().status === 'work', 'changed action is not accidentally activated on pointer release');
    const workingAvatar = query('.office-seat.work .avatar');
    check(!!workingAvatar && getComputedStyle(workingAvatar).animationName === (config.get('reduced') === '1' ? 'none' : 'work-shake'), 'animation respects reduced motion');
    S.money = 100000;
    render(); await settle();
    for (let i = 0; i < 3; i++) act('expand');
    check(S.desks === 10, 'expansion to ten desks');
    await open('hire');
    while (S.employees.length < 10) {
      if (!S.candidates.length) { act('refresh'); await settle(); }
      click('[data-ui="candidate-details"]'); await settle();
      act('hire'); await settle(); await ignoreEvent();
      await open('hire');
    }
    check(officePage === 2, 'third room selected after hire');
    act('officePrev'); act('officePrev');
    check(officePage === 0, 'room previous control');
    const person = S.employees.find(employee => employee.desk === 0);
    person.name = 'Александра Александрова Северная';
    person.skills = { backend: 5, frontend: 5, ui: 5, marketing: 5 };
    S.selected = person.id;
    render(); await settle();
    await open('emp'); layout('long-name employee');
    check(!/Тир\s+\d\s*\/\s*5/.test(document.body.innerText), 'redundant tier text absent');
    for (const section of ['tasks', 'hire', 'log', 'menu', 'emp']) {
      await open(section); layout('section ' + section);
      const tabs = [...document.querySelectorAll('#panelTabs button')];
      for (const tab of tabs) { click(tab); await settle(); layout(section + ' tab ' + tab.textContent); }
    }
    await open('log');
    for (let i = 0; i < 40; i++) log('Подробное событие номер ' + i + ': ' + 'Сотрудник завершил задачу и рассказал о результате. '.repeat(5));
    render(); await settle(); layout('full journal');
    const next = [...document.querySelectorAll('#panelPager button')].find(button => !button.disabled && /→|›|след|впер/i.test(button.textContent + ' ' + button.getAttribute('aria-label')));
    check(!!next, 'journal has pagination');
    click(next); await settle(); layout('journal next page');
    const focused = query('#panelPager button:not(:disabled)');
    focused.focus();
    const focusBefore = document.activeElement;
    const pagerBefore = query('#panelPager').textContent;
    S.speed = 4; paused = false; restartTimer();
    await new Promise(resolve => setTimeout(resolve, 1100));
    pauseGame(); await ignoreEvent(); pauseGame();
    check(query('#panelPager').textContent === pagerBefore, 'ticks preserve journal page');
    check(document.activeElement === focusBefore,
      'ticks preserve focus ' + JSON.stringify({ before: focusBefore.outerHTML, connected: focusBefore.isConnected, after: document.activeElement.outerHTML.slice(0, 250) }));
    await open('emp');
    const id = sel().id;
    Speech.clear();
    showCharacterLine(sel(), 'taskStart', flavorContext(sel(), C.tasks.code), { force: true, priority: 20 });
    check(!!Speech.getBubble(id), 'employee speaks before firing');
    // Employee management may be a subtab; locate by visible label.
    const management = query('#panelTabs [data-ui="tab"][data-value="manage"]');
    if (management) { click(management); await settle(); }
    await reachAction('fire'); await settle();
    check(!S.employees.some(employee => employee.id === id), 'fire control');
    check(!!sel() && !query('#panelContent').textContent.includes('Команда пока пуста'), 'remaining employee selected after firing');
    check(!Speech.getBubble(id), 'firing removes active speech');
    await wait(() => !API.busy, 'save idle'); clearTimeout(API.saveTimer);
    await pushSave({ silent: false });
    check(!API.hold, 'save succeeds');
    const identities = JSON.stringify(S.employees.map(({ id, name, gender, appearance }) => ({ id, name, gender, appearance })));
    check(await loadFromServer() === 'ok', 'load from server');
    check(identities === JSON.stringify(S.employees.map(({ id, name, gender, appearance }) => ({ id, name, gender, appearance }))), 'identities preserved');
    S.selected = S.employees[0].id; officePage = Math.floor(S.employees[0].desk / 4); Speech.syncVisibility(); render();
    const previousHold = API.hold;
    API.hold = 'conflict'; render(); await settle();
    click('#saveIndicator'); await settle(); layout('save conflict');
    check(query('#panelShell').dataset.section === 'menu' && !!query('#panelTabs [data-value="notices"]'), 'conflict controls are reachable');
    API.hold = previousHold; render();
    const enlarged = document.createElement('style');
    enlarged.textContent = '.panel-content,.panel-content *{font-size:20px!important;line-height:1.45!important}';
    document.head.append(enlarged); UI.scheduleLayout(); await settle();
    for (const section of ['emp', 'tasks', 'hire', 'log', 'menu']) {
      await open(section); layout('large text ' + section);
      check(!query('#panelTabs [data-value="skills"]'), 'no separate skills tab in ' + section);
      if (section === 'hire') {
        act('refresh'); await settle(); layout('three larger candidate cards');
        check([...document.querySelectorAll('[data-ui="candidate-details"]')].filter(visible).length === S.candidates.length, 'entire pool visible with larger text');
        click('[data-ui="candidate-details"]'); await settle(); layout('large candidate details');
      }
    }
    enlarged.remove(); UI.scheduleLayout(); await settle();
    if (config.get('view') === 'office') {
      if (visible(query('#panelShell'))) click('#panelShell [data-ui="close"]');
    } else {
      await open(config.get('view') || 'emp');
      if (config.get('view') === 'hire') { act('refresh'); await settle(); layout('fresh pool screenshot'); }
      if (config.get('view') === 'emp' || !config.get('view')) click('#panelTabs [data-value="state"]');
    }
    await settle(); layout('restored');
    if (visible(query('#panelShell'))) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(); check(!visible(query('#panelShell')), 'Escape returns to office');
      await open(config.get('view') || 'emp');
    }
    check(errors.length === 0, 'no JavaScript errors');
    parent.postMessage({ compactUI: true, success: true, width: innerWidth, height: innerHeight, difficulty: S.difficulty, checks: checks.length, errors }, '*');
  } catch (error) {
    parent.postMessage({ compactUI: true, success: false, width: innerWidth, height: innerHeight, error: error.stack, checks, errors }, '*');
  }
})();
