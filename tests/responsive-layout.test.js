'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const compactUI = fs.readFileSync(path.join(root, 'compact-ui.js'), 'utf8');

test('viewport and responsive breakpoints remain available for the complete interface', () => {
  assert.match(html, /name="viewport"[^>]*width=device-width[^>]*viewport-fit=cover/);
  assert.match(css, /@media\s*\(max-width:\s*650px\)/);
  assert.match(css, /@media\s*\(max-width:\s*380px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1024px\)\s*and\s*\(min-height:\s*501px\)/);
  assert.match(css, /@media\s*\(min-width:\s*560px\)\s*and\s*\(max-height:\s*500px\)/);
});

test('new campaign asks for one startup type on the existing difficulty screen', () => {
  assert.match(html, /id="difficultySetup"/);
  assert.match(html, /id="startupTypeOptions" class="startup-type-options"/);
  for (const type of ['webService', 'mobileApp', 'gameStudio', 'saas']) {
    assert.match(html, new RegExp(`data-act="startup-select" data-v="${type}"`));
  }
  assert.equal((html.match(/class="startup-type-option(?: selected)?"/g) || []).length, 4);
  assert.match(css, /\.startup-type-options\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/s);
  assert.match(css, /@media\(max-width:650px\)[\s\S]*?\.startup-type-options\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(html, /id="projectDialog"/);
  assert.doesNotMatch(html, /data-value="projects"/);
});

test('top product bar is accessible and reflects the continuous product-quality value', () => {
  assert.match(html, /id="sProdProgress" class="stat-progress-fill"/);
  assert.match(html, /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"/);
  assert.match(compactUI, /const productProgress = Math\.max\(0, Math\.min\(100, Number\(s\.product\) \|\| 0\)\)/);
  assert.match(compactUI, /Качество единого продукта/);
  assert.match(compactUI, /sProdProgress/);
  assert.match(compactUI, /d\.StartupSystem\.stageOf\(s\.startupStage\)/);
});

test('startup section is scrollable within existing panel rather than using a separate project dialog', () => {
  assert.match(compactUI, /section === 'startup'/);
  assert.match(compactUI, /Условия|Нужно качество продукта|До этап/);
  assert.match(compactUI, /Доход \/ день/);
  assert.doesNotMatch(compactUI, /ProjectSystem|activeProject|completedProjects/);
});
