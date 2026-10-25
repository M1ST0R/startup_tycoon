const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('viewport meta and responsive breakpoints are present for the full game UI', () => {
  assert.match(html, /name="viewport"[^>]*width=device-width[^>]*viewport-fit=cover/);
  assert.match(css, /@media\s*\(max-width:\s*650px\)/);
  assert.match(css, /@media\s*\(max-width:\s*380px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1024px\)\s*and\s*\(min-height:\s*501px\)/);
  assert.match(css, /@media\s*\(min-width:\s*560px\)\s*and\s*\(max-height:\s*500px\)/);
});

test('project and shared dialogs are bounded by the dynamic viewport and can scroll', () => {
  assert.match(css, /\.project-modal\s*\{[^}]*width:min\(900px,calc\(100vw - 32px\)\)/s);
  assert.match(css, /\.dlg-backdrop\s*\{[^}]*overflow-y:auto/s);
  assert.match(css, /\.dlg-modal\s*\{[^}]*max-height:calc\(100dvh - 32px\)/s);
  assert.match(css, /\.project-modal\s*\{[^}]*max-height:calc\(100dvh - 32px\)/s);
});


test('project form keeps action buttons outside the independently scrollable fields area', () => {
  const projectDialog = html.match(/<div id="projectDialog"[\s\S]*?<\/div>\s*<div id="decisionModal"/);
  assert.ok(projectDialog, 'project dialog markup exists');
  assert.match(projectDialog[0], /class="project-modal-scroll"[\s\S]*id="projectPreview"[\s\S]*id="projectError"/);
  assert.match(projectDialog[0], /class="difficulty-actions project-modal-actions"[\s\S]*id="projectDialogCancel"[\s\S]*id="projectSubmit"/);
  assert.match(css, /\.project-modal-scroll\s*\{[^}]*overflow-y:auto/s);
  assert.match(css, /\.project-modal-actions\s*\{[^}]*flex:0 0 auto/s);
  assert.match(css, /#projectDialog \.project-modal\s*\{[^}]*max-height:calc\(100dvh - 32px\)[^}]*overflow:hidden/s);
});

test('top product indicator includes an accessible progress bar wired to project creation progress', () => {
  assert.match(html, /id="sProdProgress" class="stat-progress-fill"/);
  assert.match(html, /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"/);
  const ui = fs.readFileSync(path.join(root, 'compact-ui.js'), 'utf8');
  const projectSystem = fs.readFileSync(path.join(root, 'project-system.js'), 'utf8');
  assert.match(ui, /ProjectSystem\.creationProgress\(s\)/);
  assert.match(ui, /sProdProgress/);
  assert.match(projectSystem, /function creationProgress\(state\)/);
});


