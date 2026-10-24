'use strict';

// Real Chrome smoke checks. All accounts, databases and browser profiles are temporary.
// Usage: node tests/compact-ui-browser.cjs [--case=320] [--view=hire]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = process.env.COMPACT_UI_ARTIFACTS || path.join(process.platform === 'win32' ? 'C:\\Temp' : os.tmpdir(), 'startup-tycoon-compact-ui');
fs.mkdirSync(output, { recursive: true });
const run = Date.now().toString();
const dbPath = path.join(output, `compact-${run}.db`);
const productionDb = path.join(root, 'data', 'game.db');
const beforeDb = fs.existsSync(productionDb) ? fs.statSync(productionDb).mtimeMs : null;
const appPort = 43192;
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const app = spawn(process.execPath, ['index.js'], {
  cwd: root, windowsHide: true,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(appPort), DB_PATH: dbPath, COOKIE_SECURE: 'false' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let appLog = '';
app.stdout.on('data', value => { appLog += value; });
app.stderr.on('data', value => { appLog += value; });
const resourceErrors = [];
const heldLoads = new Map();
const proxy = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__hold') {
    // Hold the page load while real animation frames, resize events and async tests run.
    // Virtual-time-budget does not reliably deliver requestAnimationFrame in Chrome CLI.
    const finish = () => {
      clearTimeout(timeout); heldLoads.delete(url.searchParams.get('case'));
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    };
    const timeout = setTimeout(finish, 45000);
    heldLoads.set(url.searchParams.get('case'), finish);
    return;
  }
  if (url.pathname === '/__done') {
    heldLoads.get(url.searchParams.get('case'))?.();
    res.end('ok'); return;
  }
  if (url.pathname === '/__compact-check.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    return res.end(fs.readFileSync(path.join(__dirname, 'compact-ui-inpage.js')));
  }
  if (url.pathname === '/__compact') {
    const width = Number(url.searchParams.get('width'));
    const height = Number(url.searchParams.get('height'));
    assert.ok(width >= 320 && width <= 3000 && height >= 320 && height <= 2000);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace('</body>', '<script src="/__compact-check.js"></script></body>');
    const escaped = html.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#0d1117}iframe{border:0;display:block}pre{color:#fff;white-space:pre-wrap}</style>
      <script>addEventListener('message',e=>{if(e.data&&e.data.compactUI){document.getElementById('result').textContent=JSON.stringify(e.data);fetch('/__done?case=${width}')}})</script>
      <iframe title="Test viewport" width="${width}" height="${height}" srcdoc="${escaped}"></iframe><pre id="result">pending</pre><img hidden src="/__hold?case=${width}" alt="">`);
  }
  const upstream = http.request({ hostname: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers: req.headers }, incoming => {
    if (/\.(?:js|css|png|json)(?:\?|$)/.test(req.url) && ![200, 304].includes(incoming.statusCode)) {
      resourceErrors.push({ url: req.url, status: incoming.statusCode });
    }
    res.writeHead(incoming.statusCode, incoming.headers);
    incoming.pipe(res);
  });
  upstream.on('error', error => { res.statusCode = 502; res.end(error.message); });
  req.pipe(upstream);
});

async function chrome(args) {
  const child = spawn(chromePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let html = '', log = '';
  child.stdout.on('data', value => { html += value; });
  child.stderr.on('data', value => { log += value; });
  const timeout = setTimeout(() => child.kill(), 90000);
  const [code] = await once(child, 'exit');
  clearTimeout(timeout);
  assert.equal(code, 0, log);
  return { html, log };
}

(async () => {
  const reports = [];
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (app.exitCode !== null) throw new Error(appLog || 'Server exited');
      try { ready = (await fetch(`http://127.0.0.1:${appPort}/api/me`)).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Temporary server did not start');
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const proxyPort = proxy.address().port;
    const only = process.argv.find(value => value.startsWith('--case='))?.split('=')[1];
    const view = process.argv.find(value => value.startsWith('--view='))?.split('=')[1] || 'emp';
    const cases = [[320, 568, 'easy'], [390, 844, 'medium'], [844, 390, 'medium'], [1366, 768, 'medium'], [1920, 1080, 'hardcore']]
      .filter(([width]) => !only || String(width) === only);
    assert.ok(cases.length, 'Unknown --case');
    for (const [width, height, difficulty] of cases) {
      const label = `${width}x${height}`;
      const reduced = width === 1920;
      const url = `http://127.0.0.1:${proxyPort}/__compact?width=${width}&height=${height}&difficulty=${difficulty}&user=ui${run.slice(-7)}_${width}&view=${view}&reduced=${reduced ? 1 : 0}`;
      const result = await chrome(['--headless', '--disable-gpu', '--no-first-run',
        `--user-data-dir=${path.join(output, `profile-${run}-${label}`)}`, `--window-size=${Math.max(width, 700)},${height + 180}`,
        '--disable-background-timer-throttling',
        ...(reduced ? ['--force-prefers-reduced-motion'] : []),
        `--screenshot=${path.join(output, `${label}.png`)}`, '--dump-dom', url]);
      fs.writeFileSync(path.join(output, `${label}.html`), result.html);
      fs.writeFileSync(path.join(output, `${label}.log`), result.log);
      const match = result.html.match(/<pre id="result">([^<]*)<\/pre>/);
      assert.ok(match && match[1] !== 'pending', 'Browser did not finish: ' + label);
      const report = JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&'));
      reports.push(report);
      console.log(JSON.stringify(report.success ? report : { ...report, checks: report.checks.slice(-5) }));
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ reports, resourceErrors, dbPath }, null, 2));
    }
    assert.deepEqual(resourceErrors, [], 'Missing client resources');
    const afterDb = fs.existsSync(productionDb) ? fs.statSync(productionDb).mtimeMs : null;
    assert.equal(afterDb, beforeDb, 'Production database changed');
    assert.ok(reports.every(report => report.success), 'At least one browser scenario failed');
    console.log('Compact UI browser checks passed. Artifacts: ' + output);
  } finally {
    fs.writeFileSync(path.join(output, 'server.log'), appLog);
    for (const finish of [...heldLoads.values()]) finish();
    proxy.closeAllConnections(); proxy.close();
    if (app.exitCode === null) { app.kill(); await once(app, 'exit'); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
