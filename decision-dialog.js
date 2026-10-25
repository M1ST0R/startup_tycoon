'use strict';

/*
 * DecisionDialog — единая очередь модальных окон «вопрос + варианты ответа».
 * Через неё идут и форс-мажоры, и кризисные решения (признание инвестору и т. п.).
 *
 * Гарантии:
 *   • одновременно открыто не больше одного окна, остальные ждут в очереди (выше priority — раньше);
 *   • пока окно открыто, игра стоит на паузе: pause(true) при показе и pause(false) при закрытии
 *     (любое окно с вопросом ставит игру на паузу, отказаться от этого нельзя);
 *   • окна можно снимать целиком или по владельцу (`owner`) без вызова pause(false) — так игра
 *     не возобновляется «чужим» таймером при смене сессии; паузой в этом случае управляет вызывающий код;
 *   • устаревшие кнопки уже закрытого/снятого окна ничего не делают.
 *
 * Описание окна (spec):
 *   id, owner, priority = 0, kind { icon, label, color }, title, description,
 *   choices [{ label, disabled?, secondary?, run? }] — run() возвращает false, если выбор не применён
 *     (окно остаётся открытым), иначе окно закрывается;
 *   description и choices можно передать функциями — они вычисляются в момент показа, а не постановки в очередь;
 *   isValid?() — проверка перед показом: окно, потерявшее смысл, молча снимается;
 *   onDrop?() — вызывается, когда окно снято из очереди как неактуальное;
 *   onClose?() — вызывается после закрытия показанного окна.
 */
(function attachDecisionDialog(root) {
  const DEFAULT_IDS = Object.freeze({
    modal: 'decisionModal', icon: 'dlgIcon', kind: 'dlgType', title: 'dlgTitle', description: 'dlgDescription', choices: 'dlgChoices'
  });
  const DEFAULT_KIND = Object.freeze({ icon: '⚠️', label: 'Решение', color: '#ffcf4a' });

  function create(options = {}) {
    const doc = options.document || root.document;
    const ids = { ...DEFAULT_IDS, ...(options.ids || {}) };
    const pause = typeof options.pause === 'function' ? options.pause : () => {};
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    const el = key => doc.getElementById(ids[key]);

    let queue = [];
    let active = null;
    let activePaused = false;
    let nextTimer = null;
    let sequence = 0;

    const has = id => (!!active && active.id === id) || queue.some(spec => spec.id === id);
    const isValid = spec => !spec.isValid || spec.isValid(spec);
    const resolveValue = value => (typeof value === 'function' ? value() : value);

    function scheduleNext() {
      if (nextTimer !== null) return;
      nextTimer = setTimeout(() => { nextTimer = null; showNext(); }, 0);
    }

    function hide() { el('modal').hidden = true; }

    function present(spec) {
      const kind = { ...DEFAULT_KIND, ...(spec.kind || {}) };
      el('icon').textContent = kind.icon;
      el('kind').textContent = kind.label;
      el('kind').style.color = kind.color;
      el('title').textContent = spec.title;
      el('description').textContent = resolveValue(spec.description) || '';
      const box = el('choices');
      box.replaceChildren();
      for (const choice of resolveValue(spec.choices)) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = choice.secondary ? 'btn sec' : 'btn';
        button.textContent = choice.label;
        button.disabled = !!choice.disabled;
        button.addEventListener('click', () => settle(spec, choice));
        box.appendChild(button);
      }
      el('modal').hidden = false;
    }

    function showNext() {
      if (active) return;
      queue = queue.filter(spec => {
        const valid = isValid(spec);
        if (!valid && spec.onDrop) spec.onDrop(spec);
        return valid;
      });
      if (!queue.length) return;
      queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      active = queue.shift();
      present(active);
      activePaused = true;
      pause(true);
    }

    function close(spec) {
      if (active !== spec) return false;
      const restorePause = activePaused;
      active = null;
      activePaused = false;
      hide();
      if (spec.onClose) spec.onClose(spec);
      if (restorePause) pause(false);
      onChange();
      if (queue.length) scheduleNext();
      return true;
    }

    function settle(spec, choice) {
      if (active !== spec || choice.disabled) return;
      let applied;
      try {
        applied = choice.run ? choice.run(spec) : undefined;
      } catch (error) {
        close(spec);          // сбой обработчика не должен оставлять игру на вечной паузе
        throw error;
      }
      if (applied !== false) close(spec);
    }

    /** Ставит окно в очередь. Окно с уже существующим id игнорируется. */
    function enqueue(spec) {
      if (!spec || typeof spec.id !== 'string' || !(Array.isArray(spec.choices) || typeof spec.choices === 'function') || has(spec.id)) return false;
      queue.push({ priority: 0, owner: '', ...spec, sequence: ++sequence });
      showNext();
      return true;
    }

    /**
     * Снимает окна: все или только указанного владельца. Паузу НЕ возвращает —
     * это делает код, который сбрасывает сессию целиком.
     */
    function clear(owner) {
      const mine = spec => owner === undefined || spec.owner === owner;
      queue = queue.filter(spec => !mine(spec));
      if (active && mine(active)) {
        active = null;
        activePaused = false;
        hide();
      }
      if (nextTimer !== null && !queue.length) { clearTimeout(nextTimer); nextTimer = null; }
      else if (!active && queue.length) scheduleNext();
    }

    return Object.freeze({
      enqueue, clear, has,
      isOpen: () => active !== null,
      get pending() { return queue.length + (active ? 1 : 0); }
    });
  }

  root.DecisionDialog = Object.freeze({ create, DEFAULT_IDS });
})(typeof window !== 'undefined' ? window : globalThis);
