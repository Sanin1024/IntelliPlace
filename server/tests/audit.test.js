const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { audit, verifyChain, digest } = require('../src/audit');
const { QUESTIONS, seedInitialQuestions } = require('../src/seed');

let server, base, db;
test.before(async () => {
  db = createDb();
  seedInitialQuestions(db);
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
const rows = a => db.prepare('select * from audit_log where action = ? order by id').all(a);
const total = () => db.prepare('select count(*) c from audit_log').get().c;
const login = async (email, password = 'password123') =>
  (await (await call('/api/auth/login', 'POST', { email, password })).json()).token;
const key = Object.fromEntries(QUESTIONS.map(q => [q.text, q.correct]));
let uid, token;

test('register is audited; duplicate is not', async () => {
  const res = await call('/api/auth/register', 'POST', { name: 'Asha', email: 'asha@a.com', password: 'password123' });
  uid = (await res.json()).id;
  const r = rows('user.register');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].actor_id, uid);
  assert.strictEqual(r[0].entity_id, String(uid));
  await call('/api/auth/register', 'POST', { name: 'Asha', email: 'asha@a.com', password: 'password123' });
  assert.strictEqual(rows('user.register').length, 1);
});

test('failed and successful logins are audited', async () => {
  await call('/api/auth/login', 'POST', { email: 'asha@a.com', password: 'wrongpass1' });
  await call('/api/auth/login', 'POST', { email: 'ghost@a.com', password: 'wrongpass1' });
  const f = rows('auth.login_failed');
  assert.strictEqual(f.length, 2);
  assert.strictEqual(f[0].actor_id, uid);
  assert.strictEqual(f[1].actor_id, null);
  token = await login('asha@a.com');
  assert.ok(token);
  assert.strictEqual(rows('auth.login').length, 1);
  assert.strictEqual(rows('auth.login')[0].actor_id, uid);
});

test('logout is audited once', async () => {
  const t = await login('asha@a.com');
  await call('/api/auth/logout', 'POST', null, t);
  assert.strictEqual(rows('auth.logout').length, 1);
  await call('/api/auth/logout', 'POST', null, t);
  assert.strictEqual(rows('auth.logout').length, 1);
});

test('profile update audited, invalid update not', async () => {
  const P = '/api/student/profile';
  assert.strictEqual((await call(P, 'PUT', { year: 3, cgpa: 8 }, token)).status, 200);
  const r = rows('profile.update');
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(JSON.parse(r[0].details).fields, ['year', 'cgpa']);
  assert.strictEqual((await call(P, 'PUT', { year: 99 }, token)).status, 400);
  assert.strictEqual(rows('profile.update').length, 1);
});

test('assessment start and submit audited once each', async () => {
  const A = '/api/student/assessment/initial';
  const s = await (await call(A + '/start', 'POST', null, token)).json();
  await call(A + '/start', 'POST', null, token);
  assert.strictEqual(rows('assessment.start').length, 1);
  for (const q of s.questions)
    await call(A + '/answer', 'PUT', { questionId: q.id, selectedIndex: key[q.text] }, token);
  await call(A + '/submit', 'POST', null, token);
  await call(A + '/submit', 'POST', null, token);
  const r = rows('assessment.submit');
  assert.strictEqual(r.length, 1);
  const d = JSON.parse(r[0].details);
  assert.strictEqual(d.score, QUESTIONS.length);
  assert.strictEqual(d.level, 'Advanced');
  assert.strictEqual(d.auto, false);
  assert.strictEqual(r[0].actor_id, uid);
});

test('expiry auto-submit is audited as auto', async () => {
  await call('/api/auth/register', 'POST', { name: 'Dev', email: 'dev@a.com', password: 'password123' });
  const t = await login('dev@a.com');
  await call('/api/student/assessment/initial/start', 'POST', null, t);
  db.prepare("update attempts set deadline = 1 where user_id = (select id from users where email = 'dev@a.com')").run();
  await call('/api/student/assessment/initial', 'GET', null, t);
  const r = rows('assessment.submit');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(JSON.parse(r[1].details).auto, true);
});

test('chain intact after real activity', () => {
  const v = verifyChain(db);
  assert.strictEqual(v.valid, true);
  assert.strictEqual(v.count, total());
  assert.ok(total() >= 10);
});

test('audit endpoints reject anonymous and students', async () => {
  for (const p of ['/api/admin/audit', '/api/admin/audit/verify']) {
    assert.strictEqual((await call(p)).status, 401);
    assert.strictEqual((await call(p, 'GET', null, token)).status, 403);
  }
});

test('admin can verify, list newest first, and limit is clamped', async () => {
  db.prepare("insert into users(name,email,password_hash,role) values('Root','root@a.com',?,'admin')")
    .run(hashPassword('adminpass123'));
  const t = await login('root@a.com', 'adminpass123');
  const v = await (await call('/api/admin/audit/verify', 'GET', null, t)).json();
  assert.strictEqual(v.valid, true);
  const three = await (await call('/api/admin/audit?limit=3', 'GET', null, t)).json();
  assert.strictEqual(three.length, 3);
  assert.ok(three[0].id > three[1].id && three[1].id > three[2].id);
  assert.strictEqual(three[0].action, 'auth.login');
  const bad = await (await call('/api/admin/audit?limit=abc', 'GET', null, t)).json();
  assert.strictEqual(bad.length, Math.min(total(), 50));
  const big = await (await call('/api/admin/audit?limit=99999', 'GET', null, t)).json();
  assert.strictEqual(big.length, Math.min(total(), 200));
});

test('audit_log is append-only at DB level', () => {
  assert.throws(() => db.prepare("update audit_log set action = 'x' where id = 1").run(), /append-only/);
  assert.throws(() => db.prepare('delete from audit_log where id = 1').run(), /append-only/);
});

test('no passwords, emails or tokens stored', () => {
  const all = JSON.stringify(db.prepare('select * from audit_log').all());
  assert.ok(!/password|@|token/i.test(all));
});

test('audit rows survive user deletion', () => {
  const before = total();
  db.prepare('delete from users where id = ?').run(uid);
  assert.strictEqual(total(), before);
  assert.strictEqual(verifyChain(db).valid, true);
});

const fresh = () => {
  const d = createDb();
  for (let i = 1; i <= 4; i++) audit(d, { actorId: 1, action: 'a' + i, details: { i } });
  return d;
};
const shape = v => [v.valid, v.broken_at, v.reason];

test('tamper: edited row is detected', () => {
  const d = fresh();
  assert.strictEqual(verifyChain(d).valid, true);
  d.exec('DROP TRIGGER audit_no_update');
  d.prepare("update audit_log set action = 'evil' where id = 2").run();
  assert.deepStrictEqual(shape(verifyChain(d)), [false, 2, 'hash_mismatch']);
});

test('tamper: deleted middle row is detected', () => {
  const d = fresh();
  d.exec('DROP TRIGGER audit_no_delete');
  d.prepare('delete from audit_log where id = 2').run();
  assert.deepStrictEqual(shape(verifyChain(d)), [false, 3, 'chain_break']);
});

test('tamper: deleted first row is detected', () => {
  const d = fresh();
  d.exec('DROP TRIGGER audit_no_delete');
  d.prepare('delete from audit_log where id = 1').run();
  assert.deepStrictEqual(shape(verifyChain(d)), [false, 2, 'chain_break']);
});

test('tamper: edited row with recomputed hash is caught at next row', () => {
  const d = fresh();
  d.exec('DROP TRIGGER audit_no_update');
  const r = d.prepare('select * from audit_log where id = 2').get();
  d.prepare('update audit_log set action = ?, hash = ? where id = 2')
    .run('evil', digest(r.prev_hash, { ...r, action: 'evil' }));
  assert.deepStrictEqual(shape(verifyChain(d)), [false, 3, 'chain_break']);
});

test('empty log verifies', () => {
  const v = verifyChain(createDb());
  assert.strictEqual(v.valid, true);
  assert.strictEqual(v.count, 0);
});
