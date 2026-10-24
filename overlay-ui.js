/* Compact, keyboard-accessible overlays. Game actions and save data remain in script.js. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (label, action) => {
    const node = make('button', 'btn sec', label);
    node.type = 'button'; node.addEventListener('click', action);
    return node;
  };
  const visible = node => !!node && !node.hidden && !!node.getClientRects().length;
  const focusable = node => Array.from(node.querySelectorAll('button,input,[tabindex="0"],a[href]'))
    .filter(item => visible(item) && !item.disabled && !item.closest('[inert]'));
  let observer, pending = false, refreshing = false, activeModal = null, lastAuthForm = null, authWasVisible = false;
  const returnFocus = new WeakMap();
  const pagers = [], auth = new Map();

  const styles = `
  #authView,.difficulty-screen,.fm-backdrop{height:var(--overlay-height,100dvh);max-height:var(--overlay-height,100dvh);inset:0;overflow:hidden;padding:12px;display:grid;place-items:center}
  #authView{position:fixed;background:var(--ink,#11161e)}
  #authView .authbox,.difficulty-card,.fm-modal{box-sizing:border-box;min-height:0;width:min(560px,100%);height:min(540px,calc(var(--overlay-height,100dvh) - 24px));max-height:none;overflow:hidden;margin:0;padding:20px;display:flex;flex-direction:column;gap:12px;border:1px solid var(--line,#303b4b);border-radius:18px;background:var(--panel,#1a222d);box-shadow:0 24px 80px #0006}
  #authView h1,.difficulty-card h2,.fm-modal h2{font-family:inherit;font-size:22px;line-height:1.2;letter-spacing:-.4px;margin:0;color:var(--text,#edf2f7)}
  #authView .auth-intro{margin:0;font-size:14px}
  #authView .tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0;flex:none}
  #authView form{display:flex;flex-direction:column;gap:10px;margin:0;flex:1;min-height:0}
  #authView label{font-size:13px;line-height:1.35;gap:5px;min-width:0}
  #authView input{height:44px;min-height:44px;font-size:16px;width:100%;padding:8px 10px}
  #authView .cu-auth-fields{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:12px}
  #authView .cu-auth-actions{display:grid;grid-template-columns:auto 1fr;gap:8px;flex:none}
  #authView .cu-auth-actions>button:only-child{grid-column:1/-1}
  #authView .cu-auth-count{font-size:12px;color:var(--mute,#a8b4c2);margin:0}
  #authView .cu-auth-feedback{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0}
  #authView #authMsg{margin:0;min-height:0;font-size:14px;line-height:1.5;overflow-wrap:anywhere}
  #authView .authbox[data-feedback] form,#authView .authbox[data-feedback] .auth-intro{display:none!important}
  #authView .authbox.cu-auth-compact{gap:8px;padding:12px}
  #authView .cu-auth-compact .auth-intro{display:none}
  #authView .cu-auth-compact h1{font-size:18px}
  #authView .cu-auth-compact .cu-auth-count{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  .difficulty-screen,.fm-backdrop{background:rgba(7,11,17,.8);backdrop-filter:blur(8px)}
  .difficulty-card{width:min(640px,100%);height:min(420px,calc(var(--overlay-height,100dvh) - 24px))}
  .difficulty-kicker,.difficulty-card>p.mute{display:none}
  .difficulty-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;flex:none}
  .difficulty-option{display:flex;align-items:center;justify-content:center;flex-direction:row;min-height:44px;padding:8px 5px;gap:5px;border-radius:9px;font:inherit}
  .difficulty-option b{font-size:13px}.difficulty-option .diff-emoji{font-size:17px}
  .difficulty-option small,.difficulty-option>span:last-child:not(.diff-emoji){display:none}
  .difficulty-option.selected{border-color:var(--sky,#79b9ff);background:var(--panel2,#253244);box-shadow:none}
  .difficulty-details{font-size:14px;line-height:1.5;min-height:0;margin:0;padding:0;background:none;color:var(--mute,#b2bfcc);overflow-wrap:anywhere}
  .difficulty-actions{display:flex;gap:8px;flex:none;margin:0}.difficulty-actions .btn{flex:1;padding:8px}
  .fm-modal{height:min(500px,calc(var(--overlay-height,100dvh) - 24px))}
  .fm-kicker{flex:none;margin:0;font-size:12px;line-height:1.3;gap:8px}
  .fm-modal #fmDescription{font-size:14px;line-height:1.45;color:var(--mute,#b2bfcc);margin:0;overflow-wrap:anywhere}
  #fmChoices{display:contents}.fm-modal #fmChoices>.btn{flex:none;width:100%;font-size:14px;white-space:normal;overflow-wrap:anywhere;min-height:44px;padding:9px 12px}
  .cu-paged-body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-start;gap:8px;overflow:hidden}
  .cu-paged-body>*{flex:none}
  .cu-pager{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;min-height:44px;font-size:12px;color:var(--mute,#a8b4c2)}
  .cu-pager .btn{width:44px;min-width:44px;padding:8px}
  .cu-pager [aria-live]{text-align:center;flex:1}
  #authView .btn,.difficulty-screen .btn,.fm-backdrop .btn{min-height:44px;min-width:44px}
  @media(max-height:430px){#authView .authbox,.difficulty-card,.fm-modal{padding:12px;gap:8px;border-radius:12px}.difficulty-card h2,.fm-modal h2{font-size:18px}.fm-kicker{display:none}}
  @media(prefers-reduced-motion:reduce){.difficulty-screen,.fm-backdrop{backdrop-filter:none}}
  `;

  // Page original nodes, including event buttons, so their listeners and identities survive.
  function createPager(body, getItems, textNodes) {
    const footer = make('div', 'cu-pager');
    const status = make('span'); status.setAttribute('aria-live', 'polite');
    const state = { body, getItems, textNodes: new Set(textNodes), page: 0, pages: [], sources: new WeakMap(), footer };
    const prev = button('←', () => { state.page--; draw(state); }); prev.setAttribute('aria-label', 'Предыдущая страница');
    const next = button('→', () => { state.page++; draw(state); }); next.setAttribute('aria-label', 'Следующая страница');
    footer.append(prev, status, next); body.after(footer);
    Object.assign(state, { prev, next, status }); pagers.push(state); return state;
  }

  function setText(state, node, text) {
    const source = state.sources.get(node);
    if (node.textContent !== text) node.textContent = text;
    if (source) source.shown = text;
  }

  function draw(state) {
    const items = state.getItems();
    state.page = Math.max(0, Math.min(state.page, state.pages.length - 1));
    const entries = state.pages[state.page] || [];
    for (const node of items) node.hidden = !entries.some(entry => entry.node === node);
    for (const entry of entries) if (entry.text != null) setText(state, entry.node, entry.text);
    state.footer.hidden = state.pages.length <= 1;
    state.prev.disabled = state.page === 0;
    state.next.disabled = state.page >= state.pages.length - 1;
    state.status.textContent = `${state.page + 1} / ${Math.max(1, state.pages.length)}`;
  }

  function measurePager(state) {
    if (!visible(state.body)) return;
    const items = state.getItems();
    if (state.items && (items.length !== state.items.length || items.some((item, index) => state.items[index] !== item))) state.page = 0;
    state.items = items;
    for (const node of items) {
      node.hidden = false;
      if (state.textNodes.has(node)) {
        let source = state.sources.get(node);
        if (!source || source.shown !== node.textContent) {
          state.page = 0;
          source = { full: node.textContent, shown: node.textContent }; state.sources.set(node, source);
        }
        setText(state, node, source.full);
      }
    }
    state.footer.hidden = true;
    const gap = parseFloat(getComputedStyle(state.body).gap) || 0;
    const total = items.reduce((sum, node) => sum + node.getBoundingClientRect().height + gap, -gap);
    if (total <= state.body.clientHeight + 1) {
      state.pages = [items.map(node => ({ node, text: state.sources.get(node)?.full }))]; draw(state); return;
    }
    state.footer.hidden = false;
    const capacity = Math.max(1, state.body.clientHeight);
    const entries = [];
    for (const node of items) {
      const source = state.sources.get(node);
      if (!source || node.getBoundingClientRect().height <= capacity) {
        entries.push({ node, text: source?.full, height: node.getBoundingClientRect().height }); continue;
      }
      // Long descriptions are split at word boundaries, retaining every word.
      const words = source.full.match(/\S+\s*/g) || [''];
      let offset = 0;
      while (offset < words.length) {
        let low = 1, high = words.length - offset, best = 1;
        while (low <= high) {
          const count = (low + high) >> 1;
          setText(state, node, words.slice(offset, offset + count).join(''));
          if (node.getBoundingClientRect().height <= capacity) { best = count; low = count + 1; }
          else high = count - 1;
        }
        const text = words.slice(offset, offset + best).join(''); setText(state, node, text);
        entries.push({ node, text, height: node.getBoundingClientRect().height }); offset += best;
      }
    }
    const pages = []; let page = [], used = 0;
    for (const entry of entries) {
      if (page.length && (used + gap + entry.height > capacity || page.some(item => item.node === entry.node))) {
        pages.push(page); page = []; used = 0;
      }
      used += (page.length ? gap : 0) + entry.height; page.push(entry);
    }
    if (page.length) pages.push(page);
    state.pages = pages; draw(state);
  }

  function prepareAuth() {
    const box = $('authView').querySelector('.authbox');
    box.querySelector(':scope > p.mute')?.classList.add('auth-intro');
    for (const id of ['formLogin', 'formRegister']) {
      const form = $(id), labels = Array.from(form.querySelectorAll('label')), submit = form.querySelector('[type="submit"]');
      const fields = make('div', 'cu-auth-fields'), count = make('p', 'cu-auth-count'), actions = make('div', 'cu-auth-actions');
      fields.append(...labels);
      const state = { form, labels, submit, fields, actions, count, page: 0, compact: false };
      state.back = button('Назад', () => { state.page--; updateAuth(state, true); });
      state.next = button('Далее', () => advanceAuth(state));
      actions.append(state.back, state.next, submit); form.append(count, fields, actions); auth.set(form, state);
      form.addEventListener('submit', event => {
        if (state.compact && state.page < state.labels.length - 1) {
          event.preventDefault(); event.stopImmediatePropagation(); advanceAuth(state);
        }
      }, true);
    }
    const feedback = make('div', 'cu-auth-feedback'), body = make('div', 'cu-paged-body');
    body.append($('authMsg')); feedback.append(body); box.append(feedback);
    const pager = createPager(body, () => [$('authMsg')], [$('authMsg')]);
    const dismiss = button('Вернуться', () => { $('authMsg').textContent = ''; refresh(); const form = Array.from(auth.keys()).find(visible); if (form) focusable(form)[0]?.focus(); });
    feedback.append(dismiss); feedback.hidden = true;
    Object.assign(prepareAuth, { box, feedback, pager });
  }

  function advanceAuth(state) {
    const input = state.labels[state.page].querySelector('input');
    let message = '';
    if (input.name === 'username' && !/^[A-Za-z0-9_]{3,20}$/.test(input.value.trim())) message = 'Имя пользователя: 3–20 символов, латинские буквы, цифры и _.';
    if (input.name === 'password' && (input.value.length < 8 || input.value.length > 128)) message = 'Пароль: от 8 до 128 символов.';
    if (message) { $('authMsg').textContent = message; refresh(); return; }
    state.page = Math.min(state.labels.length - 1, state.page + 1); updateAuth(state, true);
  }

  function updateAuth(state, focus) {
    state.page = Math.max(0, Math.min(state.labels.length - 1, state.page));
    state.labels.forEach((label, index) => { label.hidden = state.compact && index !== state.page; });
    state.count.hidden = !state.compact;
    state.count.textContent = `Шаг ${state.page + 1} из ${state.labels.length}`;
    state.back.hidden = !state.compact || !state.page;
    state.next.hidden = !state.compact || state.page === state.labels.length - 1;
    state.submit.hidden = state.compact && state.page !== state.labels.length - 1;
    state.actions.style.gridTemplateColumns = state.back.hidden ? '1fr' : 'auto 1fr';
    if (focus) state.labels[state.page].querySelector('input')?.focus({ preventScroll: true });
  }

  function prepareDialogs() {
    const difficulty = $('difficultySetup').querySelector('.difficulty-card');
    const detailsBody = make('div', 'cu-paged-body');
    const details = $('difficultyDetails'); details.before(detailsBody); detailsBody.append(details);
    createPager(detailsBody, () => [details], [details]);
    const fm = $('forceMajeureModal').querySelector('.fm-modal');
    const eventBody = make('div', 'cu-paged-body');
    const description = $('fmDescription'), choices = $('fmChoices');
    description.before(eventBody); eventBody.append(description, choices);
    createPager(eventBody, () => [description, ...choices.children], [description]);
  }

  function syncModalFocus() {
    const next = visible($('forceMajeureModal')) ? $('forceMajeureModal') : visible($('difficultySetup')) ? $('difficultySetup') : null;
    const game = $('gameView');
    game.inert = next === $('forceMajeureModal');
    for (const child of game.children) if (child !== $('difficultySetup')) child.inert = !!next;
    $('authView').inert = !!next;
    if (next === activeModal) return;
    const previous = activeModal; activeModal = next;
    if (next) {
      const element = document.activeElement;
      const attributes = ['id', 'data-ui', 'data-act', 'data-id', 'data-value', 'data-task', 'data-v']
        .filter(name => element?.hasAttribute(name)).map(name => [name, element.getAttribute(name)]);
      returnFocus.set(next, { element, attributes, inPanel: !!element?.closest('#panelShell') });
      queueMicrotask(() => { if (activeModal === next) (focusable(next)[0] || next).focus({ preventScroll: true }); });
    } else if (previous) {
      const saved = returnFocus.get(previous);
      queueMicrotask(() => {
        if (activeModal) return;
        let target = saved?.element;
        if (!visible(target) || target.closest('[inert]') || target.disabled) {
          const scope = saved?.inPanel && visible($('panelShell')) ? $('panelShell') : game;
          target = saved?.attributes.length ? focusable(scope).find(candidate => saved.attributes.every(([name, value]) => candidate.getAttribute(name) === value)) : null;
          if (!target && saved?.inPanel && visible($('panelShell'))) target = focusable($('panelShell'))[0];
          if (!target && visible($('bPause'))) target = $('bPause');
        }
        target?.focus({ preventScroll: true });
      });
    }
  }

  function observe() {
    for (const id of ['authView', 'difficultySetup', 'forceMajeureModal']) {
      observer.observe($(id), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    }
    observer.observe($('gameView'), { attributes: true, attributeFilter: ['hidden'] });
  }

  function refresh() {
    if (!observer || refreshing) return;
    refreshing = true; pending = false; observer.disconnect();
    const viewport = root.visualViewport;
    const height = Math.round(viewport ? viewport.height : root.innerHeight);
    document.documentElement.style.setProperty('--overlay-height', height + 'px');
    const { box, feedback } = prepareAuth;
    const compact = height < 650 || root.innerWidth < 480;
    box.classList.toggle('cu-auth-compact', compact);
    const message = $('authMsg').textContent;
    box.toggleAttribute('data-feedback', !!message); feedback.hidden = !message;
    const authVisible = visible($('authView'));
    const currentForm = Array.from(auth.keys()).find(form => !form.hidden);
    if (authVisible && (!authWasVisible || currentForm !== lastAuthForm)) {
      for (const state of auth.values()) state.page = 0;
    }
    lastAuthForm = currentForm; authWasVisible = authVisible;
    for (const state of auth.values()) {
      const wasCompact = state.compact; state.compact = compact;
      if (!wasCompact && compact) {
        const focused = state.labels.findIndex(label => label.contains(document.activeElement));
        if (focused >= 0) state.page = focused;
      }
      updateAuth(state, false);
    }
    for (const state of pagers) measurePager(state);
    syncModalFocus(); observe(); refreshing = false;
  }

  function schedule() {
    if (pending) return; pending = true;
    queueMicrotask(refresh);
  }

  function init() {
    if (!$('authView') || !$('difficultySetup') || !$('forceMajeureModal')) return;
    const style = make('style'); style.textContent = styles; document.head.append(style);
    prepareAuth(); prepareDialogs(); observer = new MutationObserver(schedule);
    root.addEventListener('resize', schedule);
    root.visualViewport?.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule);
    document.addEventListener('keydown', event => {
      if (!activeModal) return;
      if (event.key === 'Tab') {
        const list = focusable(activeModal), first = list[0], last = list[list.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !activeModal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
      if (event.key === 'Escape' && activeModal === $('difficultySetup') && visible($('cancelDifficulty'))) {
        event.preventDefault(); event.stopImmediatePropagation(); $('cancelDifficulty').click();
      }
    }, true);
    refresh();
  }
  root.CompactOverlays = Object.freeze({ refresh: schedule });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
