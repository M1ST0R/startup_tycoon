'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readCookie } = require('../auth');
const { secureCookiesEnabled } = require('../security-config');

test('malformed percent-encoded session cookie is treated as absent', () => {
  const req = { headers: { cookie: '__Host-sid=%E0%A4%A' } };
  assert.equal(readCookie(req, '__Host-sid'), null);
});

test('cookie parser still reads a valid encoded token and ignores unrelated cookies', () => {
  const req = { headers: { cookie: 'theme=dark; __Host-sid=abc_def-123' } };
  assert.equal(readCookie(req, '__Host-sid'), 'abc_def-123');
});

test('production always enables Secure cookies, even when env explicitly says false', () => {
  assert.equal(secureCookiesEnabled('production', 'false'), true);
  assert.equal(secureCookiesEnabled('production', undefined), true);
});

test('development only enables Secure cookies when explicitly configured', () => {
  assert.equal(secureCookiesEnabled('development', undefined), false);
  assert.equal(secureCookiesEnabled('development', 'false'), false);
  assert.equal(secureCookiesEnabled('development', 'true'), true);
});
