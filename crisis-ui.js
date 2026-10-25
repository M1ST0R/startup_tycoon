'use strict';

/*
 * CrisisUI — отображение финансового кризиса в компактном интерфейсе.
 * Правила и числа живут в crisis.js / employee-config.js; здесь только DOM:
 *   • summary(state)       — строки панели «Кризис» (долг, дебаффы, увольнения, обман инвестора);
 *   • stripText(state)     — короткая строка для красной полосы под шапкой;
 *   • renderGameOver(state) — экран поражения.
 *
 * Все зависимости передаются снаружи (h — конструктор элементов, fmt — формат денег).
 */
(function attachCrisisUI(root) {
  const $ = id => document.getElementById(id);

  function create({ h, fmt, Crisis, EmployeeConfig }) {
    const cfg = EmployeeConfig.CRISIS;

    const line = (icon, text, active) => h('p', { class: `crisis-row${active ? ' on' : ''}`, 'data-key': `crisis-${icon}` },
      h('span', { class: 'ci', 'aria-hidden': 'true' }, icon), text);

    /** Блоки для вкладки «Компания»; пустой массив, пока деньги не закончились. */
    function summary(state) {
      const info = Crisis.summary(state);
      if (!info.broke) return [];
      return [
        h('div', { class: 'crisis-head', 'data-key': 'crisis-head' },
          h('b', {}, info.debt > 0 ? `Компания в долгу: ${fmt(info.debt)}` : 'Деньги закончились'),
          h('span', { class: 'mute' }, `День без денег: ${info.days}`)),
        line('🙁', info.moodDrain > 0
          ? `Долг выше ${fmt(cfg.freeDebt)}: настроение сотрудников −${info.moodDrain.toFixed(2)} в час`
          : `Долг до ${fmt(cfg.freeDebt)}: настроение пока не страдает`, info.moodDrain > 0),
        line('🐢', info.speedMultiplier < 1
          ? `Давно нет денег: скорость работы ×${info.speedMultiplier.toFixed(2)}`
          : `С ${cfg.speedPenaltyStartDay}-го дня без денег сотрудники начнут работать медленнее`, info.speedMultiplier < 1),
        line('🚪', info.quitPhase
          ? `Каждые ${cfg.quitRollHours} ч сотрудники могут уволиться из-за долгов по зарплате (следующая проверка через ${info.hoursToQuitRoll} ч)`
          : `С ${cfg.quitStartDay}-го дня без денег сотрудники начнут увольняться`, info.quitPhase),
        ...(info.concealing ? [line('🕵️', 'Вы скрываете проблему от инвестора: при запросе отчёта вас могут разоблачить', true)] : [])
      ];
    }

    /** Текст красной полосы под шапкой; null — кризиса нет. */
    function stripText(state) {
      const info = Crisis.summary(state);
      if (!info.broke) return null;
      return `${info.debt > 0 ? `Долг ${fmt(info.debt)}` : 'Деньги закончились'} · день без денег ${info.days}`;
    }

    /** Экран поражения: показывается поверх игры, пока в состоянии есть gameOver и не открыт выбор сложности. */
    function renderGameOver(state) {
      const screen = $('gameOverScreen'), over = state && state.gameOver;
      screen.hidden = !(over && $('difficultySetup').hidden);
      if (!over) return;
      const reason = Crisis.GAME_OVER_REASONS[over.reason];
      $('goIcon').textContent = reason.icon;
      $('goTitle').textContent = reason.title;
      $('goText').textContent = reason.text;
      $('goStats').replaceChildren(...[
        ['Дней прожито', over.day], ['Клиентов', over.customers], ['Репутация', `${over.rep} / 100`], ['Продукт', `${over.product}%`]
      ].map(([label, value]) => h('li', {}, h('span', { class: 'mute' }, label), h('b', {}, String(value)))));
    }

    return Object.freeze({ summary, stripText, renderGameOver });
  }

  root.CrisisUI = Object.freeze({ create });
})(window);
