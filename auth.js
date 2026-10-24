'use strict';
const crypto = require('crypto');
const argon2 = require('argon2');

/* Параметры Argon2id (минимальная рекомендация OWASP: 19 МиБ памяти, 2 прохода, 1 поток) */
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const USER_RE = /^[A-Za-z0-9_]{3,20}$/;

/** Проверяет и нормализует имя: NFKC, обрезка пробелов, только латиница/цифры/_, регистр не важен. */
function parseUsername(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.normalize('NFKC').trim();
  return USER_RE.test(v) ? { display: v, norm: v.toLowerCase() } : null;
}
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 128;
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const rand = () => crypto.randomBytes(32).toString('base64url');

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function makeAuth(db, cfg) {
  const ttl = cfg.sessionDays * 86400000;
  const COOKIE = cfg.secureCookies ? '__Host-sid' : 'sid';   // __Host- требует Secure, Path=/ и отсутствия Domain
  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: cfg.secureCookies, path: '/' };
  let dummyHash = null;                                      // для выравнивания времени ответа при неизвестном имени

  const q = {
    insertUser: db.prepare('INSERT INTO users (username, username_norm, password_hash, created_at) VALUES (?, ?, ?, ?)'),
    findUser: db.prepare('SELECT id, username, password_hash FROM users WHERE username_norm = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    getSession: db.prepare('SELECT s.user_id, s.csrf_token, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
    delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at < ?')
  };

  return {
    q,
    async init() { dummyHash = await argon2.hash('timing-equalizer-password', ARGON); },
    hashPassword: p => argon2.hash(p, ARGON),
    /** Проверка пароля; для несуществующего пользователя проверяется фиктивный хэш. */
    async verifyPassword(hash, password) {
      try { return await argon2.verify(hash || dummyHash, password) && !!hash; } catch (err) { return false; }
    },
    /** Создаёт сессию, ставит cookie и возвращает CSRF-токен. */
    createSession(res, userId) {
      const token = rand(), csrf = rand(), now = Date.now();
      q.insertSession.run(sha256(token), userId, csrf, now, now + ttl);
      res.cookie(COOKIE, token, { ...cookieOpts, maxAge: ttl });
      return csrf;
    },
    destroySession(req, res) {
      if (req.auth) q.delSession.run(req.auth.tokenHash);
      res.clearCookie(COOKIE, cookieOpts);
    },
    purgeExpired: () => q.purge.run(Date.now()),
    /** Определяет пользователя по cookie. userId берётся только из серверной сессии. */
    session(req, res, next) {
      req.auth = null;
      const token = readCookie(req, COOKIE);
      if (token) {
        const th = sha256(token), row = q.getSession.get(th);
        if (row && row.expires_at > Date.now()) {
          req.auth = { userId: row.user_id, username: row.username, csrf: row.csrf_token, tokenHash: th };
        } else if (row) q.delSession.run(th);
      }
      next();
    },
    requireAuth(req, res, next) {
      if (!req.auth) return res.status(401).json({ error: 'Требуется вход' });
      next();
    },
    /** Защита от CSRF: токен сессии в заголовке X-CSRF-Token. */
    requireCsrf(req, res, next) {
      const a = Buffer.from(String(req.get('x-csrf-token') || '')), b = Buffer.from(req.auth.csrf);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Недействительный CSRF-токен' });
      next();
    }
  };
}

module.exports = { makeAuth, parseUsername, validPassword };
