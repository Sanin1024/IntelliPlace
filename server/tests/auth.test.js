const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

let server, base, db;
test.before(async () => {
  db = createDb();
  server = createApp(db).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (path, method = 'GET', body, token) => fetch(base + path, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined
});
const reg = { name: 'Asha', email: 'Asha@Example.com', password: 'password123' };
let token;

test('register creates student, lowercases email, hides hash', async () => {
  const res = await call('/api/auth/register', 'POST', { ...reg, role: 'admin' });
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.email, 'asha@example.com');
  assert.strictEqual(b.role, 'student');
  assert.strictEqual(b.password_hash, undefined);
});
test('password stored hashed', () => {
  const u = db.prepare('select password_hash from users').get();
  assert.ok(u.password_hash.startsWith('scrypt$'));
  assert.ok(!u.password_hash.includes('password123'));
});
test('duplicate email (any case) returns 409', async () => {
  assert.strictEqual((await call('/api/auth/register', 'POST', reg)).status, 409);
});
test('invalid registration inputs return 400', async () => {
  for (const bad of [{ ...reg, email: 'x', name: 'A' }, { ...reg, email: 'b@c.com', password: 'short' },
    { ...reg, email: 'b@c.com', name: '' }, {}]) {
    assert.strictEqual((await call('/api/auth/register', 'POST', bad)).status, 400);
  }
});
test('login succeeds and returns token', async () => {
  const res = await call('/api/auth/login', 'POST', { email: 'asha@example.com', password: 'password123' });
  assert.strictEqual(res.status, 200);
  token = (await res.json()).token;
  assert.ok(token && token.length === 64);
});
test('wrong password and unknown email give same 401', async () => {
  const a = await call('/api/auth/login', 'POST', { email: 'asha@example.com', password: 'wrongpass1' });
  const b = await call('/api/auth/login', 'POST', { email: 'no@one.com', password: 'wrongpass1' });
  assert.strictEqual(a.status, 401);
  assert.strictEqual(b.status, 401);
  assert.deepStrictEqual(await a.json(), await b.json());
});
test('me requires valid token', async () => {
  assert.strictEqual((await call('/api/auth/me')).status, 401);
  assert.strictEqual((await call('/api/auth/me', 'GET', null, 'garbage')).status, 401);
  const res = await call('/api/auth/me', 'GET', null, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).email, 'asha@example.com');
});
test('RBAC: no token 401, student 403, admin 200', async () => {
  assert.strictEqual((await call('/api/admin/ping')).status, 401);
  assert.strictEqual((await call('/api/admin/ping', 'GET', null, token)).status, 403);
  db.prepare("insert into users(name,email,password_hash,role) values('Root','root@x.com',?, 'admin')")
    .run(hashPassword('adminpass123'));
  const l = await call('/api/auth/login', 'POST', { email: 'root@x.com', password: 'adminpass123' });
  const t = (await l.json()).token;
  assert.strictEqual((await call('/api/admin/ping', 'GET', null, t)).status, 200);
});
test('expired session rejected', async () => {
  db.prepare('update sessions set expires_at = 1').run();
  assert.strictEqual((await call('/api/auth/me', 'GET', null, token)).status, 401);
});
test('logout invalidates token', async () => {
  const l = await call('/api/auth/login', 'POST', { email: 'asha@example.com', password: 'password123' });
  const t = (await l.json()).token;
  assert.strictEqual((await call('/api/auth/logout', 'POST', null, t)).status, 200);
  assert.strictEqual((await call('/api/auth/me', 'GET', null, t)).status, 401);
});
