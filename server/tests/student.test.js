const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { QUESTIONS, seedInitialQuestions } = require('../src/seed');
const { levelFor } = require('../src/routes/student');

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
const P = '/api/student';
const key = Object.fromEntries(QUESTIONS.map(q => [q.text, q.correct]));
async function login(email) {
  const l = await call('/api/auth/login', 'POST', { email, password: 'password123' });
  return (await l.json()).token;
}
async function makeStudent(name) {
  const email = name.toLowerCase() + '@t.com';
  await call('/api/auth/register', 'POST', { name, email, password: 'password123' });
  return login(email);
}
const start = t => call(P + '/assessment/initial/start', 'POST', null, t);
const submit = t => call(P + '/assessment/initial/submit', 'POST', null, t);
const put = (t, b) => call(P + '/assessment/initial/answer', 'PUT', b, t);
async function answer(t, qs, nCorrect) {
  let i = 0;
  for (const q of qs) {
    const c = key[q.text];
    await put(t, { questionId: q.id, selectedIndex: i < nCorrect ? c : (c + 1) % q.options.length });
    i++;
  }
}

let A, B, C, D, coord, qsA;

test('setup users', async () => {
  A = await makeStudent('Anu'); B = await makeStudent('Bob');
  C = await makeStudent('Chitra'); D = await makeStudent('Dev');
  db.prepare("insert into users(name,email,password_hash,role) values('Coord','coord@t.com',?,'coordinator')")
    .run(hashPassword('password123'));
  coord = await login('coord@t.com');
  assert.ok(A && B && C && D && coord);
});

test('levelFor thresholds', () => {
  assert.strictEqual(levelFor(0, 10), 'Beginner');
  assert.strictEqual(levelFor(3, 10), 'Beginner');
  assert.strictEqual(levelFor(4, 10), 'Intermediate');
  assert.strictEqual(levelFor(7, 10), 'Intermediate');
  assert.strictEqual(levelFor(8, 10), 'Advanced');
  assert.strictEqual(levelFor(0, 0), 'Beginner');
});

test('auth and student role enforced', async () => {
  for (const [m, p] of [['GET', '/profile'], ['PUT', '/profile'], ['GET', '/assessment/initial'],
    ['POST', '/assessment/initial/start'], ['PUT', '/assessment/initial/answer'], ['POST', '/assessment/initial/submit']]) {
    assert.strictEqual((await call(P + p, m)).status, 401, `${m} ${p} unauth`);
    assert.strictEqual((await call(P + p, m, null, coord)).status, 403, `${m} ${p} coordinator`);
  }
});

test('profile: empty, then update persists', async () => {
  let b = await (await call(P + '/profile', 'GET', null, A)).json();
  assert.strictEqual(b.department, null);
  assert.deepStrictEqual(b.skills, []);
  const res = await call(P + '/profile', 'PUT',
    { department: ' CSE ', year: 3, cgpa: 8.5, phone: '+91 98765 43210', skills: ['Java', ' SQL '] }, A);
  assert.strictEqual(res.status, 200);
  b = await (await call(P + '/profile', 'GET', null, A)).json();
  assert.strictEqual(b.department, 'CSE');
  assert.strictEqual(b.year, 3);
  assert.strictEqual(b.cgpa, 8.5);
  assert.deepStrictEqual(b.skills, ['Java', 'SQL']);
  assert.ok(b.self_reported.includes('cgpa'));
});

test('profile: level cannot be set by client', async () => {
  const res = await call(P + '/profile', 'PUT', { level: 'Advanced', year: 3 }, A);
  assert.strictEqual(res.status, 200);
  const b = await res.json();
  assert.strictEqual(b.level, null);
  assert.strictEqual(b.level_source, null);
});

test('profile: invalid input returns 400', async () => {
  for (const bad of [{}, { year: 9 }, { year: '3' }, { cgpa: 11 }, { cgpa: 'x' }, { phone: 'abc' },
    { skills: 'java' }, { skills: [1] }, { department: '' }]) {
    assert.strictEqual((await call(P + '/profile', 'PUT', bad, A)).status, 400, JSON.stringify(bad));
  }
});

test('start: 201, timed, no answer key leaked', async () => {
  const res = await start(A);
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.status, 'in_progress');
  assert.strictEqual(b.questions.length, QUESTIONS.length);
  assert.ok(b.remaining_seconds > 880 && b.remaining_seconds <= 900);
  assert.ok(!JSON.stringify(b).includes('correct'));
  qsA = b.questions;
  globalThis.attemptA = b.attempt_id;
});

test('start again resumes same attempt', async () => {
  const res = await start(A);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).attempt_id, globalThis.attemptA);
});

test('autosave: saved, overwritten, visible on reload', async () => {
  const q0 = qsA[0];
  let r = await put(A, { questionId: q0.id, selectedIndex: 0 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).saved, true);
  await put(A, { questionId: q0.id, selectedIndex: 1 });
  const g = await (await call(P + '/assessment/initial', 'GET', null, A)).json();
  assert.strictEqual(g.status, 'in_progress');
  assert.strictEqual(g.answers[q0.id], 1);
  assert.strictEqual(db.prepare('select count(*) c from attempt_answers where attempt_id = ?').get(g.attempt_id).c, 1);
});

test('answer validation', async () => {
  const q0 = qsA[0];
  assert.strictEqual((await put(A, { questionId: q0.id, selectedIndex: 9 })).status, 400);
  assert.strictEqual((await put(A, { questionId: q0.id, selectedIndex: '1' })).status, 400);
  assert.strictEqual((await put(A, { questionId: 99999, selectedIndex: 0 })).status, 400);
  assert.strictEqual((await put(A, undefined)).status, 400);
  assert.strictEqual((await put(B, { questionId: q0.id, selectedIndex: 0 })).status, 404);
});

test('submit grades on server: all correct = Advanced', async () => {
  await answer(A, qsA, QUESTIONS.length);
  const res = await submit(A);
  assert.strictEqual(res.status, 200);
  const b = await res.json();
  assert.strictEqual(b.status, 'completed');
  assert.strictEqual(b.score, QUESTIONS.length);
  assert.strictEqual(b.level, 'Advanced');
});

test('after submit: level verified, answers closed, restart blocked, submit idempotent', async () => {
  const p = await (await call(P + '/profile', 'GET', null, A)).json();
  assert.strictEqual(p.level, 'Advanced');
  assert.strictEqual(p.level_source, 'system_assessment');
  assert.strictEqual((await put(A, { questionId: qsA[0].id, selectedIndex: 0 })).status, 409);
  assert.strictEqual((await start(A)).status, 409);
  const again = await submit(A);
  assert.strictEqual(again.status, 200);
  assert.strictEqual((await again.json()).score, QUESTIONS.length);
});

test('scoring: none correct = Beginner, 6 correct = Intermediate', async () => {
  const qb = (await (await start(B)).json()).questions;
  await answer(B, qb, 0);
  const rb = await (await submit(B)).json();
  assert.strictEqual(rb.score, 0);
  assert.strictEqual(rb.level, 'Beginner');
  const qc = (await (await start(C)).json()).questions;
  await answer(C, qc, 6);
  const rc = await (await submit(C)).json();
  assert.strictEqual(rc.score, 6);
  assert.strictEqual(rc.level, 'Intermediate');
});

test('expired attempt auto-finalizes with saved answers only', async () => {
  const qd = (await (await start(D)).json()).questions;
  await answer(D, qd.slice(0, 3), 3);
  db.prepare("update attempts set deadline = 1 where user_id = (select id from users where email = 'dev@t.com')").run();
  assert.strictEqual((await put(D, { questionId: qd[5].id, selectedIndex: key[qd[5].text] })).status, 409);
  const g = await (await call(P + '/assessment/initial', 'GET', null, D)).json();
  assert.strictEqual(g.status, 'completed');
  assert.strictEqual(g.score, 3);
  assert.strictEqual(g.level, 'Beginner');
});
