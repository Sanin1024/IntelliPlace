const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { verifyChain } = require('../src/audit');
const { seedInitialQuestions } = require('../src/seed');
const { seedPracticeQuestions } = require('../src/practiceBank');
const { seedMockQuestions } = require('../src/mockBank');
const { bandFor } = require('../src/readiness');

let server, url, db, coord, admin;
const T = {}, U = {};
test.before(async () => {
  db = createDb();
  seedInitialQuestions(db); seedPracticeQuestions(db); seedMockQuestions(db);
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
const A = '/api/analytics';
const uidOf = email => db.prepare('select id from users where email = ?').get(email).id;
const me = async t => (await call(A + '/me', 'GET', null, t)).json();
const setLevel = (email, lvl) => db.prepare(`insert into student_profiles(user_id, level, level_source)
  select id, ?, 'system_assessment' from users where email = ?
  on conflict(user_id) do update set level = excluded.level, level_source = excluded.level_source`).run(lvl, email);
const qid = (purpose, cat, n, diff) => {
  const p = [purpose, cat];
  let sql = 'select id from questions where purpose = ? and category = ?';
  if (diff) { sql += ' and difficulty = ?'; p.push(diff); }
  sql += ' order by id limit ?'; p.push(n);
  return db.prepare(sql).all(...p).map(r => r.id);
};
const initialIds = () => [...qid('initial', 'aptitude', 4), ...qid('initial', 'programming', 6)];
const practiceIds = cat => qid('practice', cat, 3, 'Beginner');
const mockIds = () => [...qid('mock', 'aptitude', 4), ...qid('mock', 'programming', 4)];
function mkAttempt(uid, kind, ids, nCorrect, x = {}) {
  const done = !x.open;
  const info = db.prepare(`insert into attempts(user_id, kind, started_at, deadline, submitted_at, score, total, category, difficulty)
    values(?, ?, 1, 2, ?, ?, ?, ?, ?)`)
    .run(uid, kind, done ? 3 : null, done ? nCorrect : null, done ? ids.length : null, x.category ?? null, x.difficulty ?? null);
  const aid = Number(info.lastInsertRowid);
  const insQ = db.prepare('insert into attempt_questions(attempt_id, question_id, position) values(?, ?, ?)');
  const insA = db.prepare('insert into attempt_answers(attempt_id, question_id, selected_index, saved_at) values(?, ?, ?, 1)');
  ids.forEach((q, i) => {
    insQ.run(aid, q, i + 1);
    if (done) {
      const c = db.prepare('select correct_index c from questions where id = ?').get(q).c;
      insA.run(aid, q, i < nCorrect ? c : (c + 1) % 4);
    }
  });
  return aid;
}
const auditRows = () => db.prepare("select * from audit_log where action = 'analytics.view_student' order by id").all();

test('setup users and fixtures', async () => {
  for (const [n, role] of [['Coord', 'coordinator'], ['Root', 'admin']])
    db.prepare('insert into users(name,email,password_hash,role) values(?,?,?,?)')
      .run(n, n.toLowerCase() + '@t.com', hashPassword('password123'), role);
  coord = await login('coord@t.com'); admin = await login('root@t.com');
  for (let i = 0; i <= 5; i++) {
    await call('/api/auth/register', 'POST', { name: 'S' + i, email: `s${i}@t.com`, password: 'password123' });
    T[i] = await login(`s${i}@t.com`); U[i] = uidOf(`s${i}@t.com`);
  }
  mkAttempt(U[0], 'practice', practiceIds('aptitude'), 0, { open: true, category: 'aptitude', difficulty: 'Beginner' });
  setLevel('s1@t.com', 'Intermediate');
  mkAttempt(U[1], 'initial', initialIds(), 8);
  mkAttempt(U[1], 'practice', practiceIds('aptitude'), 0, { category: 'aptitude', difficulty: 'Beginner' });
  mkAttempt(U[1], 'practice', practiceIds('programming'), 3, { category: 'programming', difficulty: 'Beginner' });
  mkAttempt(U[1], 'mock', mockIds(), 4);
  mkAttempt(U[1], 'mock', mockIds(), 6);
  setLevel('s2@t.com', 'Beginner');
  mkAttempt(U[2], 'practice', practiceIds('aptitude'), 0, { category: 'aptitude', difficulty: 'Beginner' });
  mkAttempt(U[2], 'practice', practiceIds('programming'), 3, { category: 'programming', difficulty: 'Beginner' });
  setLevel('s3@t.com', 'Beginner');
  mkAttempt(U[3], 'initial', initialIds(), 2);
  setLevel('s4@t.com', 'Advanced');
  mkAttempt(U[4], 'initial', initialIds(), 10);
  mkAttempt(U[4], 'practice', practiceIds('aptitude'), 3, { category: 'aptitude', difficulty: 'Beginner' });
  mkAttempt(U[4], 'practice', practiceIds('programming'), 3, { category: 'programming', difficulty: 'Beginner' });
  mkAttempt(U[4], 'mock', mockIds(), 8);
  setLevel('s5@t.com', 'Advanced');
  for (const n of [0, 8, 8, 8]) mkAttempt(U[5], 'mock', mockIds(), n);
  assert.ok(coord && admin && Object.keys(T).length === 6);
});

test('role enforcement', async () => {
  assert.strictEqual((await call(A + '/me')).status, 401);
  assert.strictEqual((await call(A + '/me', 'GET', null, coord)).status, 403);
  for (const p of ['/cohort', '/students', '/students/1']) {
    assert.strictEqual((await call(A + p)).status, 401, p + ' anon');
    assert.strictEqual((await call(A + p, 'GET', null, T[1])).status, 403, p + ' student');
  }
});

test('student with no graded data: null score, no_data, in-progress attempts ignored', async () => {
  const b = await me(T[0]);
  assert.strictEqual(b.verified.source, 'system_verified');
  assert.strictEqual(b.verified.level, null);
  assert.strictEqual(b.verified.readiness.score, null);
  assert.strictEqual(b.verified.readiness.band, 'no_data');
  assert.strictEqual(b.verified.readiness.confidence, null);
  assert.deepStrictEqual(b.verified.readiness.components, []);
  assert.deepStrictEqual(b.verified.readiness.missing, ['initial_assessment', 'practice', 'mock_tests']);
  assert.ok(b.verified.categories.every(c => c.questions === 0 && c.accuracy === null && c.weak === false));
  assert.deepStrictEqual(b.verified.weak_categories, []);
  assert.strictEqual(b.self_reported.source, 'self_reported');
  assert.strictEqual(b.self_reported.completeness_percent, 0);
});

test('all three components: weighted score, categories, weak areas', async () => {
  const b = (await me(T[1])).verified;
  const rd = b.readiness;
  assert.deepStrictEqual(rd.components.map(c => c.name), ['initial_assessment', 'practice', 'mock_tests']);
  assert.deepStrictEqual(rd.components.map(c => c.percent), [80, 50, 62.5]);
  assert.deepStrictEqual(rd.components.map(c => c.weight), [30, 30, 40]);
  assert.ok(rd.components.every(c => c.source === 'system_verified'));
  assert.strictEqual(rd.score, 64);
  assert.strictEqual(rd.band, 'developing');
  assert.strictEqual(rd.confidence, 'high');
  assert.deepStrictEqual(rd.missing, []);
  assert.strictEqual(b.level, 'Intermediate');
  const [apt, prog] = b.categories;
  assert.deepStrictEqual([apt.questions, apt.correct, apt.accuracy, apt.weak], [15, 12, 80, false]);
  assert.deepStrictEqual([prog.questions, prog.correct, prog.accuracy, prog.weak], [17, 9, 52.9, true]);
  assert.deepStrictEqual(b.weak_categories, ['programming']);
});

test('single component: weights renormalised, low confidence, bands', async () => {
  const s2 = (await me(T[2])).verified;
  assert.strictEqual(s2.readiness.score, 50);
  assert.strictEqual(s2.readiness.band, 'developing');
  assert.strictEqual(s2.readiness.confidence, 'low');
  assert.deepStrictEqual(s2.readiness.components.map(c => c.name), ['practice']);
  assert.deepStrictEqual(s2.readiness.missing, ['initial_assessment', 'mock_tests']);
  assert.deepStrictEqual(s2.weak_categories, ['aptitude']);
  assert.deepStrictEqual([s2.categories[0].accuracy, s2.categories[1].accuracy], [0, 100]);
  const s3 = (await me(T[3])).verified;
  assert.strictEqual(s3.readiness.score, 20);
  assert.strictEqual(s3.readiness.band, 'not_ready');
  assert.deepStrictEqual(s3.weak_categories, ['aptitude', 'programming']);
});

test('ready student, and only the last 3 mock attempts count', async () => {
  const s4 = (await me(T[4])).verified;
  assert.deepStrictEqual([s4.readiness.score, s4.readiness.band, s4.readiness.confidence], [100, 'ready', 'high']);
  assert.deepStrictEqual(s4.weak_categories, []);
  const s5 = (await me(T[5])).verified;
  assert.deepStrictEqual([s5.readiness.score, s5.readiness.band, s5.readiness.confidence], [100, 'ready', 'low']);
  assert.strictEqual(s5.readiness.components[0].percent, 100);
  assert.strictEqual(s5.readiness.components[0].detail.attempts_counted, 3);
});

test('self-reported data is separate and cannot change verified readiness or level', async () => {
  const res = await call('/api/student/profile', 'PUT',
    { cgpa: 10, level: 'Advanced', department: 'CSE', year: 3, phone: '9876543210', skills: ['SQL'] }, T[1]);
  assert.strictEqual(res.status, 200);
  await call('/api/student/profile', 'PUT', { department: 'cse' }, T[2]);
  await call('/api/student/profile', 'PUT', { department: 'ECE' }, T[3]);
  const b = await me(T[1]);
  assert.strictEqual(b.verified.readiness.score, 64);
  assert.strictEqual(b.verified.level, 'Intermediate');
  assert.strictEqual(b.self_reported.cgpa, 10);
  assert.strictEqual(b.self_reported.completeness_percent, 100);
  assert.strictEqual(b.self_reported.source, 'self_reported');
  assert.ok(!JSON.stringify(b.verified).includes('cgpa'));
});

test('performance endpoint includes mock summary; practice sessions unchanged', async () => {
  const b = await (await call('/api/student/performance', 'GET', null, T[1])).json();
  assert.deepStrictEqual(b.verified.mock, { attempts: 2, best_percent: 75, latest_percent: 75 });
  assert.strictEqual(b.verified.total_sessions, 2);
  const n = await (await call('/api/student/performance', 'GET', null, T[0])).json();
  assert.deepStrictEqual(n.verified.mock, { attempts: 0, best_percent: null, latest_percent: null });
  assert.strictEqual(n.verified.total_sessions, 0);
});

test('cohort summary for coordinator and admin', async () => {
  for (const t of [coord, admin]) {
    const res = await call(A + '/cohort', 'GET', null, t);
    assert.strictEqual(res.status, 200);
    const b = await res.json();
    assert.strictEqual(b.students, 6);
    assert.strictEqual(b.assessed, 5);
    assert.deepStrictEqual(b.level_distribution, { Beginner: 2, Intermediate: 1, Advanced: 2, unassessed: 1 });
    assert.strictEqual(b.readiness.source, 'system_verified');
    assert.deepStrictEqual(b.readiness.bands, { ready: 2, developing: 2, not_ready: 1, no_data: 1 });
    assert.strictEqual(b.readiness.average_score, 66.8);
    assert.deepStrictEqual(b.categories, [
      { category: 'aptitude', questions: 49, accuracy: 75.5, weak_students: 2 },
      { category: 'programming', questions: 55, accuracy: 67.3, weak_students: 2 }]);
    assert.strictEqual(b.self_reported.source, 'self_reported');
    const d = Object.fromEntries(b.self_reported.departments.map(x => [x.department.toLowerCase(), x.students]));
    assert.deepStrictEqual(d, { cse: 2, ece: 1, unspecified: 3 });
    assert.strictEqual(b.applications.total, 0);
    assert.strictEqual(b.drives.open, 0);
  }
});

test('student list: lowest readiness first, filters, clamping, no secrets', async () => {
  const all = await (await call(A + '/students', 'GET', null, coord)).json();
  assert.deepStrictEqual(all.map(x => x.email), ['s0@t.com', 's3@t.com', 's2@t.com', 's1@t.com', 's4@t.com', 's5@t.com']);
  assert.deepStrictEqual(all.map(x => x.readiness.score), [null, 20, 50, 64, 100, 100]);
  const s1 = all.find(x => x.email === 's1@t.com');
  assert.strictEqual(s1.level, 'Intermediate');
  assert.strictEqual(s1.readiness.band, 'developing');
  assert.deepStrictEqual(s1.weak_categories, ['programming']);
  assert.strictEqual(s1.self_reported.department, 'CSE');
  assert.ok(!/password|token/i.test(JSON.stringify(all)));
  const dev = await (await call(A + '/students?band=developing', 'GET', null, admin)).json();
  assert.deepStrictEqual(dev.map(x => x.email), ['s2@t.com', 's1@t.com']);
  assert.strictEqual((await call(A + '/students?band=bogus', 'GET', null, coord)).status, 400);
  assert.strictEqual((await (await call(A + '/students?limit=2', 'GET', null, coord)).json()).length, 2);
  assert.strictEqual((await (await call(A + '/students?limit=abc', 'GET', null, coord)).json()).length, 6);
  assert.strictEqual((await (await call(A + '/students?limit=99999', 'GET', null, coord)).json()).length, 6);
});

test('student detail: full view, audited per view, unknown or non-student ids 404 and not audited', async () => {
  const res = await call(`${A}/students/${U[1]}`, 'GET', null, coord);
  assert.strictEqual(res.status, 200);
  const b = await res.json();
  assert.strictEqual(b.student.email, 's1@t.com');
  assert.strictEqual(b.verified.readiness.score, 64);
  assert.strictEqual(b.self_reported.cgpa, 10);
  assert.strictEqual(b.applications, 0);
  assert.ok(!JSON.stringify(b).includes('password'));
  let rows = auditRows();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].actor_id, uidOf('coord@t.com'));
  assert.strictEqual(rows[0].entity_id, String(U[1]));
  assert.strictEqual((await call(`${A}/students/${U[2]}`, 'GET', null, admin)).status, 200);
  assert.strictEqual(auditRows().length, 2);
  for (const id of [uidOf('coord@t.com'), 9999, 'abc'])
    assert.strictEqual((await call(`${A}/students/${id}`, 'GET', null, coord)).status, 404, String(id));
  assert.strictEqual(auditRows().length, 2);
});

test('audit chain valid after analytics activity', () => {
  const v = verifyChain(db);
  assert.strictEqual(v.valid, true);
  assert.ok(v.count >= 8);
});

test('band thresholds', () => {
  assert.deepStrictEqual([null, 0, 39.9, 40, 69.9, 70, 100].map(bandFor),
    ['no_data', 'not_ready', 'not_ready', 'developing', 'developing', 'ready', 'ready']);
});
