/* Быстрый индикатор дневного баланса (доходы − расходы) для верхней панели.
   Модуль ничего не знает об игре: получает числа и функцию форматирования, обновляет один DOM-элемент. */
(function (root) {
  'use strict';
  const ARROWS = Object.freeze({ up: '⬆️', down: '⬇️', flat: '➡️' });

  /** Чистая функция: сводит доходы и расходы за день к модели отображения. */
  function describe(income, expenses) {
    const net = Math.floor(income) - Math.floor(expenses);
    const trend = net > 0 ? 'up' : net < 0 ? 'down' : 'flat';
    return { income, expenses, net, trend, arrow: ARROWS[trend] };
  }

  /** Обновляет элемент: стрелка + сумма, цвет задаётся классом up / down / flat. */
  function render(el, income, expenses, format) {
    if (!el) return;
    const model = describe(income, expenses);
    const sign = model.trend === 'up' ? '+' : '';
    el.textContent = `${model.arrow} ${sign}${format(model.net)}`;
    el.classList.toggle('up', model.trend === 'up');
    el.classList.toggle('down', model.trend === 'down');
    el.classList.toggle('flat', model.trend === 'flat');
    el.title = `Доход за день: ${format(income)} · Расходы за день: ${format(expenses)}`;
  }

  root.DailyBalance = Object.freeze({ describe, render });
})(typeof window !== 'undefined' ? window : globalThis);
