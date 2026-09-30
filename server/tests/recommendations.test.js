const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { seedPracticeQuestions } = require('../src/practiceBank');
const { seedMockQuestions, createMock } = require('../src/mockBank');

let server, url, db, coord, mockId, D1, D2;
const T = {};
test.before(async () => {
  db = createDb();
  seedPracticeQuestions(db); seedMockQuestions(db);
  mockId = createMock(db, { title: 'M1', durationSec: 600, sections: [{ name: 'Aptitude', category: 'aptitude', count: 2 }] });
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
const login = async email => (await (await call('/api/auth/login', 'POST', { email, password: 'password123' })).json()).token;
const mk = async n => {
  await call('/api/auth/register', 'POST', { name: n, email: n.toLowerCase() + '@t.com', password: 'password123' });
  return login(n.toLowerCase() + '@t.com');
};
const setLevel = (email, lvl) => db.prepare(`insert into student_profiles(user_id, level, level_source)
  select id, ?, 'system_assessment' from users where email = ?
  on conflict(user_id) do update set level = excluded.level, level_source = excluded.level_source`).run(lvl, email);
const uidOf = email => db.prepare('select id from users where email = ?').get(email).id;
function graded(uid, cat, nCorrect) {
  const qs = db.prepare("select id, correct_index c from questions where purpose = 'practice' and category = ? and difficulty = 'Beginner' order by id limit 3").all(cat);
  const aid = Number(db.prepare("insert into attempts(user_id, kind, started_at, deadline, submitted_at, score, total, category, difficulty) values(?, 'practice', 1, 2, 3, ?, ?, ?, 'Beginner')")
    .run(uid, nCorrect, qs.length, cat).lastInsertRowid);
  qs.forEach((q, i) => {
    db.prepare('insert into attempt_questions(attempt_id, question_id, position) values(?, ?, ?)').run(aid, q.id, i + 1);
    db.prepare('insert into attempt_answers(attempt_id, question_id, selected_index, saved_at) values(?, ?, ?, 1)')
      .run(aid, q.id, i < nCorrect ? q.c : (q.c + 1) % 4);
  });
}
const recs = async t => (await call('/api/recommendations', 'GET', null, t)).json();
const types = b => b.recommendations.map(r => r.type);
const future = new Date(Date.now() + 7 * 864e5).toISOString();
const full = { department: 'CSE', year: 3, cgpa: 8, phone: '9876543210', skills: ['SQL'] };
const SOURCES = ['system_verified', 'self_reported', 'mixed'];
const wellFormed = b => b.recommendations.every(r => typeof r.title === 'string' && r.title && typeof r.reason === 'string' && r.reason
  && SOURCES.includes(r.source) && ['high', 'medium', 'low'].includes(r.priority));

test('setup users, profiles and graded history', async () => {
  db.prepare("insert into users(name,email,password_hash,role) values('Coord','coord@t.com',?,'coordinator')").run(hashPassword('password123'));
  coord = await login('coord@t.com');
  for (const n of ['R0', 'R1', 'R2', 'R3']) T[n] = await mk(n);
  for (const n of ['R1', 'R2']) assert.strictEqual((await call('/api/student/profile', 'PUT', full, T[n])).status, 200);
  setLevel('r1@t.com', 'Intermediate'); setLevel('r2@t.com', 'Advanced'); setLevel('r3@t.com', 'Beginner');
  graded(uidOf('r1@t.com'), 'aptitude', 0); graded(uidOf('r1@t.com'), 'programming', 3);
  graded(uidOf('r2@t.com'), 'aptitude', 3); graded(uidOf('r2@t.com'), 'programming', 3);
  db.prepare("insert into attempts(user_id, kind, started_at, deadline, submitted_at, score, total) values(?, 'mock', 1, 2, 3, 7, 8)").run(uidOf('r2@t.com'));
  assert.ok(coord && T.R0 && T.R1 && T.R2 && T.R3);
});

test('recommendations require auth and the student role', async () => {
  assert.strictEqual((await call('/api/recommendations')).status, 401);
  assert.strictEqual((await call('/api/recommendations', 'GET', null, coord)).status, 403);
});

test('no verified level: assessment first, profile completion, nothing else', async () => {
  const b = await recs(T.R0);
  assert.strictEqual(b.level, null);
  assert.deepStrictEqual(types(b), ['initial_assessment', 'complete_profile']);
  assert.deepStrictEqual(b.recommendations.map(r => r.priority), ['high', 'low']);
  assert.strictEqual(b.recommendations[0].source, 'system_verified');
  assert.strictEqual(b.recommendations[1].source, 'self_reported');
  assert.deepStrictEqual(b.recommendations[1].missing_fields, ['department', 'year', 'cgpa', 'phone', 'skills']);
  assert.ok(wellFormed(b));
});

test('weak category and missing mock are recommended from verified data', async () => {
  const b = await recs(T.R1);
  assert.strictEqual(b.level, 'Intermediate');
  assert.deepStrictEqual(types(b), ['practice', 'mock']);
  const [p, m] = b.recommendations;
  assert.deepStrictEqual([p.priority, p.category, p.source], ['high', 'aptitude', 'system_verified']);
  assert.match(p.reason, /0%/);
  assert.match(p.reason, /3 graded questions/);
  assert.match(p.action, /Intermediate/);
  assert.strictEqual(m.priority, 'medium');
  assert.deepStrictEqual(m.mocks, [{ id: mockId, title: 'M1' }]);
  assert.ok(wellFormed(b));
});

test('strong, complete student with a mock has nothing to fix', async () => {
  const b = await recs(T.R2);
  assert.strictEqual(b.level, 'Advanced');
  assert.deepStrictEqual(b.recommendations, []);
});

test('level but no activity: start practice in each area, take a mock, complete profile', async () => {
  const b = await recs(T.R3);
  assert.deepStrictEqual(types(b), ['practice', 'practice', 'mock', 'complete_profile']);
  assert.deepStrictEqual(b.recommendations.map(r => r.priority), ['medium', 'medium', 'medium', 'low']);
  assert.deepStrictEqual([b.recommendations[0].category, b.recommendations[1].category], ['aptitude', 'programming']);
  assert.ok(wellFormed(b));
});

test('create drives', async () => {
  const a = await call('/api/drives', 'POST', { company: 'Acme', role: 'SDE', required_level: 'Advanced', required_skills: ['Go'], deadline: future }, coord);
  const g = await call('/api/drives', 'POST', { company: 'Globex', role: 'Analyst', deadline: future }, coord);
  assert.strictEqual(a.status, 201);
  assert.strictEqual(g.status, 201);
  D1 = (await a.json()).id; D2 = (await g.json()).id;
});

test('drives: eligible drive becomes apply, skills gap is shown for a strong student', async () => {
  const b = await recs(T.R2);
  assert.deepStrictEqual(types(b), ['apply', 'drive_gap']);
  const [ap, gap] = b.recommendations;
  assert.deepStrictEqual([ap.drive_id, ap.priority, ap.source], [D2, 'medium', 'mixed']);
  assert.deepStrictEqual([gap.drive_id, gap.rule, gap.source, gap.priority], [D1, 'skills', 'self_reported', 'low']);
  assert.match(gap.reason, /Go/);
  assert.ok(wellFormed(b));
});

test('drives: level and skills gaps are separated by source and ordered by priority', async () => {
  const b = await recs(T.R1);
  assert.deepStrictEqual(types(b), ['practice', 'mock', 'apply', 'drive_gap', 'drive_gap']);
  const gaps = b.recommendations.filter(r => r.type === 'drive_gap');
  assert.deepStrictEqual(gaps.map(g => [g.rule, g.source]), [['level', 'system_verified'], ['skills', 'self_reported']]);
  assert.ok(gaps.every(g => g.drive_id === D1));
  assert.ok(wellFormed(b));
});

test('drives: no level gap is suggested before a level exists', async () => {
  const b = await recs(T.R0);
  assert.ok(types(b).includes('initial_assessment'));
  assert.ok(!b.recommendations.some(r => r.rule === 'level'));
  assert.ok(b.recommendations.some(r => r.rule === 'skills'));
});

test('applied, closed and expired drives are not recommended', async () => {
  assert.strictEqual((await call(`/api/drives/${D2}/apply`, 'POST', null, T.R2)).status, 201);
  assert.deepStrictEqual(types(await recs(T.R2)), ['drive_gap']);
  const d3 = await (await call('/api/drives', 'POST', { company: 'Initech', role: 'Tester', deadline: future }, coord)).json();
  db.prepare('update drives set deadline = 1 where id = ?').run(d3.id);
  assert.strictEqual((await call(`/api/drives/${D2}/close`, 'POST', null, coord)).status, 200);
  const b = await recs(T.R1);
  assert.deepStrictEqual(types(b), ['practice', 'mock', 'drive_gap', 'drive_gap']);
  assert.ok(!b.recommendations.some(r => r.drive_id === D2 || r.drive_id === d3.id));
});
