const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { verifyChain } = require('../src/audit');
const { seedPracticeQuestions } = require('../src/practiceBank');

let server, url, db, coord, A, B;
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
const login = async email => (await (await call('/api/auth/login', 'POST', { email, password: 'password123' })).json()).token;
const mk = async n => {
  await call('/api/auth/register', 'POST', { name: n, email: n.toLowerCase() + '@t.com', password: 'password123' });
  return login(n.toLowerCase() + '@t.com');
};
const R = '/api/resume';
const rows = a => db.prepare('select * from audit_log where action = ? order by id').all(a);
const setLevel = (email, lvl) => db.prepare(`insert into student_profiles(user_id, level, level_source)
  select id, ?, 'system_assessment' from users where email = ?
  on conflict(user_id) do update set level = excluded.level, level_source = excluded.level_source`).run(lvl, email);
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
const edu = { institution: 'ABC College', degree: 'B.Tech CSE', start_year: 2022, end_year: 2026, grade: '8.5 CGPA' };

test('setup users', async () => {
  db.prepare("insert into users(name,email,password_hash,role) values('Coord','coord@t.com',?,'coordinator')").run(hashPassword('password123'));
  coord = await login('coord@t.com');
  A = await mk('Anu'); B = await mk('Bob');
  assert.ok(coord && A && B);
});

test('all endpoints require auth and student role', async () => {
  for (const [m, p] of [['GET', ''], ['PUT', ''], ['GET', '/export']]) {
    assert.strictEqual((await call(R + p, m)).status, 401, `${m} ${p} anon`);
    assert.strictEqual((await call(R + p, m, null, coord)).status, 403, `${m} ${p} coordinator`);
  }
});

test('empty resume: identity present, sections empty, no verified data', async () => {
  const b = await (await call(R, 'GET', null, A)).json();
  assert.strictEqual(b.self_reported.source, 'self_reported');
  assert.strictEqual(b.self_reported.name, 'Anu');
  assert.strictEqual(b.self_reported.email, 'anu@t.com');
  assert.strictEqual(b.self_reported.headline, null);
  assert.deepStrictEqual([b.self_reported.education, b.self_reported.projects, b.self_reported.experience, b.self_reported.certifications], [[], [], [], []]);
  assert.strictEqual(b.verified.source, 'system_verified');
  assert.strictEqual(b.verified.level, null);
  assert.strictEqual(b.verified.readiness.band, 'no_data');
  assert.strictEqual(b.verified.readiness.score, null);
  assert.deepStrictEqual(b.verified.categories, []);
});

test('invalid input is rejected and nothing is stored or audited', async () => {
  const bads = [{}, { level: 'Advanced' }, { headline: 5 }, { headline: 'x'.repeat(121) }, { summary: 'x'.repeat(1001) },
    { education: 'x' }, { education: [{}] }, { education: [{ institution: 'I', degree: '' }] },
    { education: [{ institution: 'I', degree: 'D', start_year: 2024, end_year: 2020 }] },
    { education: Array(6).fill({ institution: 'I', degree: 'D' }) },
    { projects: [{ title: 'P', link: 'javascript:alert(1)' }] }, { projects: [{ title: 'P', tech: 'js' }] },
    { projects: [{ title: 'P', tech: Array(11).fill('a') }] }, { experience: [{ organization: 'O' }] },
    { certifications: [{ name: 'C', year: '2020' }] }, { certifications: [null] }];
  for (const bad of bads) assert.strictEqual((await call(R, 'PUT', bad, A)).status, 400, JSON.stringify(bad).slice(0, 70));
  assert.strictEqual((await call(R, 'PUT', undefined, A)).status, 400);
  assert.strictEqual(db.prepare('select count(*) n from resumes').get().n, 0);
  assert.strictEqual(rows('resume.update').length, 0);
});

test('valid save: trimmed, stored, unknown keys ignored, audited with field names only', async () => {
  const res = await call(R, 'PUT', { headline: ' Aspiring software engineer ', summary: 'Final-year CSE student.',
    education: [edu], projects: [{ title: 'IntelliPlace', description: 'Placement system', tech: ['Node.js', 'SQLite'], link: 'https://github.com/x/y' }],
    level: 'Advanced' }, A);
  assert.strictEqual(res.status, 200);
  const b = await res.json();
  assert.strictEqual(b.self_reported.headline, 'Aspiring software engineer');
  assert.deepStrictEqual(b.self_reported.projects[0].tech, ['Node.js', 'SQLite']);
  assert.strictEqual(b.self_reported.education[0].institution, 'ABC College');
  assert.strictEqual(b.verified.level, null);
  const r = rows('resume.update');
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(JSON.parse(r[0].details).fields, ['headline', 'summary', 'education', 'projects']);
});

test('partial updates only change the sent sections; empty text clears', async () => {
  let b = await (await call(R, 'PUT', { summary: '' }, A)).json();
  assert.strictEqual(b.self_reported.summary, null);
  assert.strictEqual(b.self_reported.headline, 'Aspiring software engineer');
  assert.strictEqual(b.self_reported.education.length, 1);
  const res = await call(R, 'PUT', { certifications: [{ name: 'AWS Cloud Practitioner', issuer: 'Amazon', year: 2025 }],
    experience: [{ organization: 'Acme', role: 'Intern', start_year: 2025, end_year: 2025, description: 'Built dashboards' }] }, A);
  assert.strictEqual(res.status, 200);
  b = await (await call(R, 'GET', null, A)).json();
  assert.strictEqual(b.self_reported.certifications[0].year, 2025);
  assert.strictEqual(b.self_reported.experience[0].role, 'Intern');
  assert.strictEqual(b.self_reported.projects.length, 1);
  assert.strictEqual(rows('resume.update').length, 3);
});

test('profile details flow into the resume', async () => {
  const res = await call('/api/student/profile', 'PUT', { department: 'CSE', year: 3, cgpa: 8.5, phone: '9876543210', skills: ['SQL', 'Node.js'] }, A);
  assert.strictEqual(res.status, 200);
  const s = (await (await call(R, 'GET', null, A)).json()).self_reported;
  assert.deepStrictEqual([s.department, s.year, s.cgpa, s.phone], ['CSE', 3, 8.5, '9876543210']);
  assert.deepStrictEqual(s.skills, ['SQL', 'Node.js']);
});

test('verified block cannot be set through the resume; it reflects graded results', async () => {
  const res = await call(R, 'PUT', { headline: 'H2', level: 'Advanced', verified: { level: 'Advanced' }, readiness: { score: 100 } }, A);
  assert.strictEqual(res.status, 200);
  const b = await res.json();
  assert.strictEqual(b.verified.level, null);
  assert.strictEqual(b.verified.readiness.score, null);
  const uid = db.prepare("select id from users where email = 'anu@t.com'").get().id;
  setLevel('anu@t.com', 'Beginner');
  graded(uid, 'aptitude', 2);
  const g = (await (await call(R, 'GET', null, A)).json()).verified;
  assert.strictEqual(g.level, 'Beginner');
  assert.deepStrictEqual([g.readiness.score, g.readiness.band, g.readiness.confidence], [66.7, 'developing', 'low']);
  assert.deepStrictEqual(g.categories, [{ category: 'aptitude', accuracy: 66.7, questions: 3 }]);
});

test('export: HTML-escaped, labelled, verified section optional, audited', async () => {
  await call(R, 'PUT', { headline: '<script>alert(1)</script>',
    projects: [{ title: 'Tom & "Jerry"', link: 'https://github.com/x/y', tech: ['Node.js'] }] }, A);
  const res = await call(R + '/export', 'GET', null, A);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('cache-control'), /no-store/);
  const html = await res.text();
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Tom &amp; &quot;Jerry&quot;'));
  assert.ok(html.includes('href="https://github.com/x/y"'));
  assert.ok(html.includes('<title>Anu - Resume</title>'));
  for (const t of ['Verified by IntelliPlace', 'Beginner', '66.7', 'anu@t.com', 'SQL', 'ABC College', 'AWS Cloud Practitioner'])
    assert.ok(html.includes(t), t);
  const nov = await (await call(R + '/export?verified=0', 'GET', null, A)).text();
  assert.ok(!nov.includes('Verified by IntelliPlace'));
  assert.ok(!nov.includes('Beginner'));
  assert.ok(nov.includes('ABC College'));
  const r = rows('resume.export');
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r.map(x => JSON.parse(x.details).verified), [true, false]);
});

test('export for a student with no resume still works', async () => {
  const res = await call(R + '/export', 'GET', null, B);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Bob'));
  assert.ok(html.includes('No verified results yet'));
  assert.ok(!html.includes('ABC College'));
});

test('students only ever see their own resume', async () => {
  const b = (await (await call(R, 'GET', null, B)).json()).self_reported;
  assert.strictEqual(b.name, 'Bob');
  assert.strictEqual(b.headline, null);
  assert.deepStrictEqual(b.projects, []);
});

test('audit chain valid and holds no resume content', () => {
  assert.strictEqual(verifyChain(db).valid, true);
  const all = JSON.stringify(db.prepare('select * from audit_log').all());
  assert.ok(!/Aspiring|Jerry|alert|ABC College/.test(all));
});
