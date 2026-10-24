'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/* Миграции применяются по порядку; номер версии хранится в PRAGMA user_version.
   Чтобы изменить схему, добавьте в конец массива новую строку — старые не правьте. */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL,            -- как ввёл игрок (для показа)
    username_norm TEXT    NOT NULL UNIQUE,     -- нормализованное имя (для уникальности и входа)
    password_hash TEXT    NOT NULL,            -- Argon2id, пароль в открытом виде не хранится
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,            -- SHA-256 от токена из cookie
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user    ON sessions(user_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);
  CREATE TABLE saves (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT    NOT NULL,               -- JSON состояния игры
    rev        INTEGER NOT NULL,               -- номер версии для защиты от конфликтов
    updated_at INTEGER NOT NULL
  );
  `
];

function migrate(db) {
  let v = db.pragma('user_version', { simple: true });
  for (; v < MIGRATIONS.length; v++) {
    db.transaction(() => { db.exec(MIGRATIONS[v]); db.pragma(`user_version = ${v + 1}`); })();
  }
}

/** Открывает базу, создаёт папку и применяет миграции. */
function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

module.exports = { openDb };
