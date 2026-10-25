'use strict';

/*
 * Минимальная имитация DOM для тестов модулей, которые рисуют окна через DecisionDialog.
 * Поддерживает только то, что реально использует игра: getElementById, createElement,
 * replaceChildren/appendChild, addEventListener и click().
 */
class FakeElement {
  constructor() { this.children = []; this.listeners = new Map(); this.style = {}; this.hidden = true; this.textContent = ''; }
  replaceChildren(...children) { this.children = children; }
  appendChild(child) { this.children.push(child); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  click() { if (!this.disabled) this.listeners.get('click')?.(); }
}

function createFakeDocument() {
  const elements = new Map();
  return {
    getElementById: id => { if (!elements.has(id)) elements.set(id, new FakeElement()); return elements.get(id); },
    createElement: () => new FakeElement(),
    body: { classList: { add() {}, remove() {} } }
  };
}

/** Ручные «часы» для setTimeout: тест сам решает, когда сработают отложенные вызовы. */
function createFakeTimers() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    size: () => timers.size,
    advance(duration) {
      const end = now + duration;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].callback();
      }
      now = end;
    }
  };
}

module.exports = { FakeElement, createFakeDocument, createFakeTimers };
