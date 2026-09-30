const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { verifyChain } = require('../src/audit');
const { PRACTICE, seedPracticeQuestions } = require('../src/practiceBank');

let server, url, db, coord, A, B, P, E, sidA, qsA;
test.before(async () => {
  db = createDb();
  seedPracticeQuestions(db);
  server = createApp(db).listen(0);
  await new Promise(r => server.once('listening', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (path, method = 'GET', body, token) => fetch(url + path, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined
});
const S = '/api/student';
const login = async (email) => (await (await call('/api/auth/login', 'POST', { email, password: 'password123' })).json()).token;
const mk = async n => {
  await call('/api/auth/register', 'POST', { name: n, email: n.toLowerCase() + '@t.com', password: 'password123' });
  return login(n.toLowerCase() + '@t.com');
};
const setLevel = (email, lvl) => db.prepare(`insert into student_profiles(user_id, level, level_source)
  select id, ?, 'system_assessment' from users where email = ?
  on conflict(user_id) do update set level = excluded.level, level_source = excluded.level_source`).run(lvl, email);
const rows = a => db.prepare('select * from audit_log where action = ? order by id').all(a);
const key = Object.fromEntries(PRACTICE.map(q => [q.text, q.correct]));
async function fill(t, sid, qs, nCorrect) {
  let i = 0;
  for (const q of qs) {
    const c = key[q.text];
    await call(S + `/practice/${sid}/answer`, 'PUT',
      { questionId: q.id, selectedIndex: i < nCorrect ? c : (c + 1) % q.options.length }, t);
    i++;
  }
}
async function run(t, cat, n) {
  const s = await (await call(S + '/practice/start', 'POST', { category: cat }, t)).json();
  await fill(t, s.session_id, s.questions, n);
  return (await call(S + `/practice/${s.session_id}/submit`, 'POST', null, t)).json();
}

test('bank: 3 questions per category and difficulty, valid keys, seed idempotent', () => {
  assert.strictEqual(PRACTICE.length, 18);
  for (const c of ['aptitude', 'programming'])
    for (const d of ['Beginner', 'Intermediate', 'Advanced'])
      assert.strictEqual(db.prepare("select count(*) n from questions where purpose = 'practice' and category = ? and difficulty = ?").get(c, d).n, 3);
  assert.ok(PRACTICE.every(q => q.options.length === 4 && q.correct >= 0 && q.correct < 4));
  seedPracticeQuestions(db);
  assert.strictEqual(db.prepare("select count(*) n from questions where purpose = 'practice'").get().n, 18);
});

test('setup users', async () => {
  db.prepare("insert into users(name,email,password_hash,role) values('Coord','coord@t.com',?,'coordinator')").run(hashPassword('password123'));
  coord = await login('coord@t.com');
  A = await mk('Anu'); B = await mk('Bob'); P = await mk('Pat'); E = await mk('Eve');
  setLevel('anu@t.com', 'Beginner'); setLevel('pat@t.com', 'Intermediate'); setLevel('eve@t.com', 'Beginner');
  assert.ok(coord && A && B && P && E);
});

test('all endpoints require auth and student role', async () => {
  for (const [m, p] of [['POST', '/practice/start'], ['GET', '/practice/current'], ['GET', '/practice/history'],
    ['GET', '/performance'], ['PUT', '/practice/1/answer'], ['POST', '/practice/1/submit']]) {
    assert.strictEqual((await call(S + p, m)).status, 401, `${m} ${p} anon`);
    assert.strictEqual((await call(S + p, m, null, coord)).status, 403, `${m} ${p} coordinator`);
  }
});

test('start requires a verified level', async () => {
  assert.strictEqual((await call(S + '/practice/start', 'POST', { category: 'aptitude' }, B)).status, 403);
  assert.deepStrictEqual(await (await call(S + '/practice/current', 'GET', null, B)).json(), { status: 'none' });
});

test('start validation', async () => {
  for (const bad of [{}, { category: 'history' }, { category: 5 }, { category: 'aptitude', difficulty: 'Expert' }])
    assert.strictEqual((await call(S + '/practice/start', 'POST', bad, A)).status, 400, JSON.stringify(bad));
  assert.strictEqual((await call(S + '/practice/start', 'POST', { category: 'aptitude', difficulty: 'Advanced' }, A)).status, 403);
  assert.strictEqual(db.prepare("select count(*) n from attempts where kind = 'practice'").get().n, 0);
});

test('start: level-matched, timed, no answer key leaked', async () => {
  const res = await call(S + '/practice/start', 'POST', { category: 'aptitude' }, A);
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.status, 'in_progress');
  assert.strictEqual(b.difficulty, 'Beginner');
  assert.strictEqual(b.category, 'aptitude');
  assert.strictEqual(b.questions.length, 3);
  assert.ok(b.remaining_seconds > 1190 && b.remaining_seconds <= 1200);
  assert.ok(!JSON.stringify(b).includes('correct'));
  for (const q of b.questions) {
    const row = db.prepare('select purpose, category, difficulty from questions where id = ?').get(q.id);
    assert.deepStrictEqual({ ...row }, { purpose: 'practice', category: 'aptitude', difficulty: 'Beginner' });
  }
  sidA = b.session_id; qsA = b.questions;
});

test('start again resumes the active session', async () => {
  const res = await call(S + '/practice/start', 'POST', { category: 'programming' }, A);
  assert.strictEqual(res.status, 200);
  const b = await res.json();
  assert.strictEqual(b.session_id, sidA);
  assert.strictEqual(b.category, 'aptitude');
  assert.strictEqual(db.prepare("select count(*) n from attempts where kind = 'practice'").get().n, 1);
});

test('autosave, validation and ownership', async () => {
  const q0 = qsA[0], path = S + `/practice/${sidA}/answer`;
  assert.strictEqual((await (await call(path, 'PUT', { questionId: q0.id, selectedIndex: 1 }, A)).json()).saved, true);
  await call(path, 'PUT', { questionId: q0.id, selectedIndex: 2 }, A);
  const cur = await (await call(S + '/practice/current', 'GET', null, A)).json();
  assert.strictEqual(cur.answers[q0.id], 2);
  assert.strictEqual(db.prepare('select count(*) n from attempt_answers where attempt_id = ?').get(sidA).n, 1);
  assert.strictEqual((await call(path, 'PUT', { questionId: q0.id, selectedIndex: 9 }, A)).status, 400);
  assert.strictEqual((await call(path, 'PUT', { questionId: q0.id, selectedIndex: '1' }, A)).status, 400);
  assert.strictEqual((await call(path, 'PUT', { questionId: 99999, selectedIndex: 0 }, A)).status, 400);
  assert.strictEqual((await call(path, 'PUT', undefined, A)).status, 400);
  assert.strictEqual((await call(path, 'PUT', { questionId: q0.id, selectedIndex: 0 }, B)).status, 404);
  assert.strictEqual((await call(S + '/practice/abc/answer', 'PUT', { questionId: q0.id, selectedIndex: 0 }, A)).status, 404);
  assert.strictEqual((await call(S + `/practice/${sidA}/submit`, 'POST', null, B)).status, 404);
});

test('submit grades on server, shows review, closes session, idempotent, audited once', async () => {
  await fill(A, sidA, qsA, 3);
  const res = await call(S + `/practice/${sidA}/submit`, 'POST', null, A);
  assert.strictEqual(res.status, 200);
  const b = await res.json();
  assert.strictEqual(b.status, 'completed');
  assert.strictEqual(b.score, 3);
  assert.strictEqual(b.total, 3);
  assert.strictEqual(b.review.length, 3);
  assert.ok(b.review.every(x => x.correct === true && Number.isInteger(x.correct_index)));
  assert.strictEqual((await (await call(S + `/practice/${sidA}/submit`, 'POST', null, A)).json()).score, 3);
  assert.strictEqual((await call(S + `/practice/${sidA}/answer`, 'PUT', { questionId: qsA[0].id, selectedIndex: 0 }, A)).status, 409);
  const r = rows('practice.submit');
  assert.strictEqual(r.length, 1);
  const d = JSON.parse(r[0].details);
  assert.strictEqual(d.score, 3);
  assert.strictEqual(d.auto, false);
  assert.strictEqual(rows('practice.start').length, 1);
});

test('one level above verified level is allowed, two is not', async () => {
  assert.strictEqual((await call(S + '/practice/start', 'POST', { category: 'programming', difficulty: 'Advanced' }, A)).status, 403);
  const res = await call(S + '/practice/start', 'POST', { category: 'programming', difficulty: 'Intermediate' }, A);
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.difficulty, 'Intermediate');
  for (const q of b.questions)
    assert.strictEqual(db.prepare('select difficulty from questions where id = ?').get(q.id).difficulty, 'Intermediate');
  const done = await (await call(S + `/practice/${b.session_id}/submit`, 'POST', null, A)).json();
  assert.strictEqual(done.score, 0);
});

test('expired session auto-finalizes with saved answers only', async () => {
  const s = await (await call(S + '/practice/start', 'POST', { category: 'aptitude' }, E)).json();
  await fill(E, s.session_id, s.questions.slice(0, 1), 1);
  db.prepare('update attempts set deadline = 1 where id = ?').run(s.session_id);
  assert.strictEqual((await call(S + `/practice/${s.session_id}/answer`, 'PUT',
    { questionId: s.questions[1].id, selectedIndex: key[s.questions[1].text] }, E)).status, 409);
  assert.deepStrictEqual(await (await call(S + '/practice/current', 'GET', null, E)).json(), { status: 'none' });
  const h = await (await call(S + '/practice/history', 'GET', null, E)).json();
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].score, 1);
  assert.strictEqual(h[0].total, 3);
  const last = rows('practice.submit').pop();
  assert.strictEqual(JSON.parse(last.details).auto, true);
});

test('history is per-student, newest first, without answer key', async () => {
  const h = await (await call(S + '/practice/history', 'GET', null, A)).json();
  assert.strictEqual(h.length, 2);
  assert.ok(h[0].id > h[1].id);
  assert.strictEqual(h[0].category, 'programming');
  assert.ok(!JSON.stringify(h).includes('correct'));
  assert.strictEqual((await (await call(S + '/practice/history', 'GET', null, B)).json()).length, 0);
});

test('performance: verified vs self-reported, accuracy, recommendations', async () => {
  await run(P, 'programming', 3);
  await run(P, 'programming', 3);
  await run(P, 'aptitude', 0);
  const b = await (await call(S + '/performance', 'GET', null, P)).json();
  assert.strictEqual(b.verified.source, 'system_verified');
  assert.strictEqual(b.verified.level, 'Intermediate');
  assert.strictEqual(b.verified.initial_assessment, null);
  assert.strictEqual(b.verified.total_sessions, 3);
  assert.deepStrictEqual([b.verified.practice.programming.sessions, b.verified.practice.programming.answered,
    b.verified.practice.programming.correct, b.verified.practice.programming.accuracy], [2, 6, 6, 100]);
  assert.deepStrictEqual([b.verified.practice.aptitude.answered, b.verified.practice.aptitude.correct,
    b.verified.practice.aptitude.accuracy], [3, 0, 0]);
  assert.match(b.verified.practice.programming.recommendation, /Advanced/);
  assert.match(b.verified.practice.aptitude.recommendation, /Review aptitude/);
  assert.strictEqual(b.verified.weakest_category, 'aptitude');
  assert.strictEqual(b.self_reported.source, 'self_reported');
  await call(S + '/profile', 'PUT', { level: 'Advanced', cgpa: 9 }, P);
  const c = await (await call(S + '/performance', 'GET', null, P)).json();
  assert.strictEqual(c.verified.level, 'Intermediate');
  assert.strictEqual(c.self_reported.cgpa, 9);
  const n = await (await call(S + '/performance', 'GET', null, B)).json();
  assert.strictEqual(n.verified.level, null);
  assert.strictEqual(n.verified.total_sessions, 0);
  assert.strictEqual(n.verified.weakest_category, null);
  assert.match(n.verified.practice.aptitude.recommendation, /initial assessment/);
});

test('audit chain valid after practice activity', () => {
  const v = verifyChain(db);
  assert.strictEqual(v.valid, true);
  assert.ok(v.count >= 20);
});
