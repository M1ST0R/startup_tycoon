'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { openDb } = require('./db');
const { makeAuth, parseUsername, validPassword } = require('./auth');
const { normalizeState } = require('./gamestate');

const env = process.env.NODE_ENV || 'development';
const cfg = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3000,
  dbPath: path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'game.db')),
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : env === 'production',
  trustProxy: Number(process.env.TRUST_PROXY) || 0
};

const limiter = (limit, windowMs, extra = {}) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false, ...extra,
  handler: (req, res) => res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' })
});
const apiLimiter = limiter(300, 60 * 1000);
const loginLimiter = limiter(10, 15 * 60 * 1000, { skipSuccessfulRequests: true });  // 10 неудачных входов за 15 минут с одного IP
const registerLimiter = limiter(5, 60 * 60 * 1000);                                  // 5 регистраций в час с одного IP

async function main() {
  const db = openDb(cfg.dbPath);
  const auth = makeAuth(db, cfg);
  await auth.init();

  const getSave = db.prepare('SELECT data, rev, updated_at FROM saves WHERE user_id = ?');
  const getRev = db.prepare('SELECT rev FROM saves WHERE user_id = ?');
  const upsertSave = db.prepare(`INSERT INTO saves (user_id, data, rev, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, rev = excluded.rev, updated_at = excluded.updated_at`);
  // Транзакция better-sqlite3 синхронная: проверка rev и запись выполняются атомарно.
  const writeSave = db.transaction((userId, json, rev, force) => {
    const cur = getRev.get(userId), curRev = cur ? cur.rev : 0;
    if (!force && rev !== curRev) return { conflict: true, rev: curRev };
    upsertSave.run(userId, json, curRev + 1, Date.now());
    return { rev: curRev + 1 };
  });

  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY'
    });
    next();
  });

  /* ---------- API ---------- */
  const api = express.Router();
  api.use(apiLimiter);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Запросы, меняющие данные, принимаются только с нашего же сайта (проверка Origin).
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.get('host'); } catch (err) { /* некорректный Origin */ }
      if (!ok) return res.status(403).json({ error: 'Запрос отклонён' });
    }
    next();
  });
  api.use(express.json({ limit: '256kb' }));
  api.use(auth.session);

  const needJson = (req, res, next) =>
    req.is('application/json') && req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? next() : res.status(415).json({ error: 'Ожидается JSON' });

  api.get('/me', (req, res) => {
    res.json(req.auth ? { user: { username: req.auth.username }, csrfToken: req.auth.csrf } : { user: null, csrfToken: null });
  });

  api.post('/register', registerLimiter, needJson, async (req, res, next) => {
    try {
      const u = parseUsername(req.body.username);
      if (!u) return res.status(400).json({ error: 'Имя пользователя: 3–20 символов, латинские буквы, цифры и _' });
      if (!validPassword(req.body.password)) return res.status(400).json({ error: 'Пароль: от 8 до 128 символов' });
      const hash = await auth.hashPassword(req.body.password);
      let id;
      try { id = auth.q.insertUser.run(u.display, u.norm, hash, Date.now()).lastInsertRowid; }
      catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Это имя пользователя недоступно' });
        throw err;
      }
      if (req.auth) auth.destroySession(req, res);
      const csrfToken = auth.createSession(res, Number(id));
      res.status(201).json({ user: { username: u.display }, csrfToken });
    } catch (err) { next(err); }
  });

  api.post('/login', loginLimiter, needJson, async (req, res, next) => {
    try {
      const u = parseUsername(req.body.username);
      const row = u ? auth.q.findUser.get(u.norm) : null;
      const pw = typeof req.body.password === 'string' ? req.body.password.slice(0, 128) : '';
      const ok = await auth.verifyPassword(row && row.password_hash, pw);   // всегда считаем хэш — время ответа не выдаёт, есть ли такой аккаунт
      if (!ok) return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
      if (req.auth) auth.destroySession(req, res);                          // новая сессия при каждом входе
      const csrfToken = auth.createSession(res, row.id);
      res.json({ user: { username: row.username }, csrfToken });
    } catch (err) { next(err); }
  });

  api.post('/logout', auth.requireAuth, auth.requireCsrf, (req, res) => {
    auth.destroySession(req, res);
    res.status(204).end();
  });

  // Пользователь определяется ТОЛЬКО по сессии: никакого userId от клиента.
  api.get('/save', auth.requireAuth, (req, res) => {
    const row = getSave.get(req.auth.userId);
    if (!row) return res.json({ save: null });
    let state = null;
    try { state = JSON.parse(row.data); } catch (err) { /* клиент покажет «повреждено» */ }
    res.json({ save: { state, rev: row.rev, updatedAt: row.updated_at } });
  });

  api.put('/save', auth.requireAuth, auth.requireCsrf, needJson, (req, res) => {
    const { state, rev, force } = req.body;
    if (force !== undefined && typeof force !== 'boolean') return res.status(400).json({ error: 'Некорректный запрос' });
    if (!force && !(Number.isInteger(rev) && rev >= 0)) return res.status(400).json({ error: 'Некорректный запрос' });
    let clean;
    try { clean = normalizeState(state); } catch (err) { return res.status(400).json({ error: 'Некорректные данные сохранения' }); }
    const r = writeSave(req.auth.userId, JSON.stringify(clean), rev, !!force);
    if (r.conflict) return res.status(409).json({ error: 'Сохранение изменилось в другом месте', rev: r.rev });
    res.json({ ok: true, rev: r.rev });
  });

  api.use((req, res) => res.status(404).json({ error: 'Не найдено' }));
  app.use('/api', api);

  /* ---------- Статические файлы клиента ---------- */
  app.use(express.static(path.join(__dirname, '..', 'public'), { dotfiles: 'ignore' }));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
    console.error('Ошибка сервера:', err.message);   // тела запросов (и пароли) не логируем
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  setInterval(() => auth.purgeExpired(), 60 * 60 * 1000).unref();
  const server = app.listen(cfg.port, cfg.host, () =>
    console.log(`Сервер запущен: http://${cfg.host}:${cfg.port} (${env}, cookie Secure: ${cfg.secureCookies})`));
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

main().catch(err => { console.error('Не удалось запустить сервер:', err.message); process.exit(1); });
