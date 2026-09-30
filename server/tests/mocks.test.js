const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { verifyChain } = require('../src/audit');
const { MOCK_QUESTIONS, seedMockQuestions, seedSamples } = require('../src/mockBank');

let server, url, db, coord, A, B, acmeId, mockId, mock2Id, attemptId, qs;
test.before(async () => {
  db = createDb();
  seedMockQuestions(db);
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
const rows = a => db.prepare('select * from audit_log where action = ? order by id').all(a);
const key = Object.fromEntries(MOCK_QUESTIONS.map(q => [q.text, q.correct]));
const right = q => key[q.text];
const wrong = q => (key[q.text] + 1) % 4;
const M = '/api/mocks';
const future = new Date(Date.now() + 7 * 864e5).toISOString();
const good = { title: 'Acme Mock', duration_minutes: 30,
  sections: [{ name: 'Aptitude', category: 'aptitude', count: 4 }, { name: 'Programming', category: 'programming', count: 4 }] };
async function answerAll(t, id, questions, pick) {
  for (const q of questions)
    await call(`${M}/attempts/${id}/answer`, 'PUT', { questionId: q.id, selectedIndex: pick(q) }, t);
}

test('bank: 8 per category, valid keys, unique texts, seed idempotent', () => {
  assert.strictEqual(MOCK_QUESTIONS.length, 16);
  assert.strictEqual(new Set(MOCK_QUESTIONS.map(q => q.text)).size, 16);
  assert.ok(MOCK_QUESTIONS.every(q => q.options.length === 4 && q.correct >= 0 && q.correct < 4));
  for (const c of ['aptitude', 'programming'])
    assert.strictEqual(db.prepare("select count(*) n from questions where purpose = 'mock' and category = ?").get(c).n, 8);
  seedMockQuestions(db);
  assert.strictEqual(db.prepare("select count(*) n from questions where purpose = 'mock'").get().n, 16);
});

test('setup users', async () => {
  db.prepare("insert into users(name,email,password_hash,role) values('Coord','coord@t.com',?,'coordinator')").run(hashPassword('password123'));
  coord = await login('coord@t.com');
  A = await mk('Anu'); B = await mk('Bob');
  setLevel('anu@t.com', 'Intermediate');
  assert.ok(coord && A && B);
});

test('role enforcement on every endpoint', async () => {
  for (const [m, p] of [['GET', '/current'], ['POST', '/1/start'], ['GET', '/attempts/history'], ['GET', '/attempts/1'],
    ['PUT', '/attempts/1/answer'], ['POST', '/attempts/1/submit']]) {
    assert.strictEqual((await call(M + p, m)).status, 401, `${m} ${p} anon`);
    assert.strictEqual((await call(M + p, m, null, coord)).status, 403, `${m} ${p} coordinator`);
  }
  assert.strictEqual((await call('/api/companies/1/prep')).status, 401);
  assert.strictEqual((await call('/api/companies/1/prep', 'GET', null, coord)).status, 403);
  for (const p of [M, '/api/companies', '/api/companies/1/resources']) {
    assert.strictEqual((await call(p, 'POST', good)).status, 401, `${p} anon`);
    assert.strictEqual((await call(p, 'POST', good, A)).status, 403, `${p} student`);
  }
});

test('company create: validation, normalisation, duplicate 409, audited once', async () => {
  for (const bad of [{}, { name: '' }, { name: 5 }, { name: 'X', focus: 'aptitude' }, { name: 'X', focus: ['history'] }, { name: 'x'.repeat(101) }])
    assert.strictEqual((await call('/api/companies', 'POST', bad, coord)).status, 400, JSON.stringify(bad).slice(0, 40));
  const res = await call('/api/companies', 'POST', { name: ' Acme Technologies ', focus: ['aptitude', 'programming', 'aptitude'] }, coord);
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.name, 'Acme Technologies');
  assert.deepStrictEqual(b.focus, ['aptitude', 'programming']);
  acmeId = b.id;
  assert.strictEqual((await call('/api/companies', 'POST', { name: 'ACME technologies' }, coord)).status, 409);
  assert.strictEqual(rows('company.create').length, 1);
});

test('resources: validation, unknown company 404, unsafe links rejected, audited', async () => {
  const R = `/api/companies/${acmeId}/resources`;
  const bads = [{ title: '', kind: 'topic', content: 'x' }, { title: 't', kind: 'video', content: 'x' },
    { title: 't', kind: 'topic', content: '' }, { title: 't', kind: 'link', content: 'javascript:alert(1)' },
    { title: 't', kind: 'link', content: 'not a url' }, { title: 't', kind: 'topic', content: 'x'.repeat(2001) }];
  for (const bad of bads) assert.strictEqual((await call(R, 'POST', bad, coord)).status, 400, JSON.stringify(bad).slice(0, 60));
  const ok = { title: 'Aptitude topics', kind: 'topic', content: 'Percentages and ratios' };
  assert.strictEqual((await call('/api/companies/9999/resources', 'POST', ok, coord)).status, 404);
  assert.strictEqual((await call('/api/companies/abc/resources', 'POST', ok, coord)).status, 404);
  assert.strictEqual((await call(R, 'POST', ok, coord)).status, 201);
  const l = await call(R, 'POST', { title: 'Careers page', kind: 'link', content: 'https://example.com/prep' }, coord);
  assert.strictEqual(l.status, 201);
  assert.strictEqual((await l.json()).kind, 'link');
  assert.strictEqual(rows('resource.create').length, 2);
});

test('company list is visible to students with resource counts', async () => {
  assert.strictEqual((await call('/api/companies')).status, 401);
  const l = await (await call('/api/companies', 'GET', null, A)).json();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].name, 'Acme Technologies');
  assert.strictEqual(l[0].resource_count, 2);
  assert.deepStrictEqual(l[0].focus, ['aptitude', 'programming']);
});

test('mock create: invalid specs rejected and nothing partial is stored', async () => {
  const bads = [{ title: '' }, { duration_minutes: 0 }, { duration_minutes: 181 }, { duration_minutes: '30' },
    { company_id: '1' }, { company_id: 9999 }, { sections: [] }, { sections: 'x' }, { sections: [null] },
    { sections: [{ name: 'A', category: 'history', count: 2 }] }, { sections: [{ name: 'A', category: 'aptitude', count: 0 }] },
    { sections: [{ name: 'A', category: 'aptitude', count: 21 }] }, { sections: [{ name: '', category: 'aptitude', count: 2 }] },
    { sections: [{ name: 'A', category: 'aptitude', count: 9 }] },
    { sections: [{ name: 'A', category: 'aptitude', count: 5 }, { name: 'B', category: 'aptitude', count: 5 }] }];
  for (const patch of bads)
    assert.strictEqual((await call(M, 'POST', { ...good, ...patch }, coord)).status, 400, JSON.stringify(patch).slice(0, 60));
  assert.strictEqual((await call(M, 'POST', {}, coord)).status, 400);
  assert.strictEqual(db.prepare('select count(*) n from mock_tests').get().n, 0);
  assert.strictEqual(db.prepare('select count(*) n from mock_test_questions').get().n, 0);
});

test('mock create: fixed distinct questions per section, company link, audited', async () => {
  const res = await call(M, 'POST', { ...good, title: 'Acme Technologies Mock', company_id: acmeId, created_by: 999 }, coord);
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.company, 'Acme Technologies');
  assert.strictEqual(b.duration_minutes, 30);
  assert.strictEqual(b.total_questions, 8);
  assert.deepStrictEqual(b.sections, [{ name: 'Aptitude', questions: 4 }, { name: 'Programming', questions: 4 }]);
  mockId = b.id;
  assert.strictEqual(db.prepare('select count(distinct question_id) n from mock_test_questions where mock_id = ?').get(mockId).n, 8);
  assert.strictEqual(db.prepare(`select count(*) n from mock_test_questions mq join questions q on q.id = mq.question_id
    where mq.mock_id = ? and mq.section = 'Aptitude' and q.category = 'aptitude'`).get(mockId).n, 4);
  assert.strictEqual(db.prepare('select created_by from mock_tests where id = ?').get(mockId).created_by,
    db.prepare("select id from users where email = 'coord@t.com'").get().id);
  const r2 = await call(M, 'POST', { title: 'Quick Aptitude', duration_minutes: 10, sections: [{ name: 'Aptitude', category: 'aptitude', count: 3 }] }, coord);
  assert.strictEqual(r2.status, 201);
  const b2 = await r2.json();
  assert.strictEqual(b2.company, null);
  mock2Id = b2.id;
  assert.strictEqual(rows('mock.create').length, 2);
});

test('mock list: authenticated users, no answer key', async () => {
  assert.strictEqual((await call(M)).status, 401);
  const l = await (await call(M, 'GET', null, A)).json();
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[0].id, mockId);
  assert.ok(!JSON.stringify(l).includes('correct'));
  assert.strictEqual((await (await call(M, 'GET', null, coord)).json()).length, 2);
});

test('start gating: needs verified level, unknown mock 404', async () => {
  assert.strictEqual((await call(`${M}/${mockId}/start`, 'POST', null, B)).status, 403);
  assert.strictEqual((await call(`${M}/9999/start`, 'POST', null, A)).status, 404);
  assert.strictEqual((await call(`${M}/abc/start`, 'POST', null, A)).status, 404);
  assert.strictEqual(db.prepare("select count(*) n from attempts where kind = 'mock'").get().n, 0);
});

test('start: 201, timed, sectioned, no answer key leaked, audited', async () => {
  const res = await call(`${M}/${mockId}/start`, 'POST', null, A);
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.status, 'in_progress');
  assert.strictEqual(b.mock_id, mockId);
  assert.strictEqual(b.questions.length, 8);
  assert.strictEqual(b.questions.filter(q => q.section === 'Aptitude').length, 4);
  assert.strictEqual(b.questions.filter(q => q.section === 'Programming').length, 4);
  assert.ok(b.remaining_seconds > 1790 && b.remaining_seconds <= 1800);
  assert.ok(!JSON.stringify(b).includes('correct'));
  attemptId = b.attempt_id; qs = b.questions;
  assert.strictEqual(db.prepare('select count(*) n from attempt_questions where attempt_id = ?').get(attemptId).n, 8);
  assert.strictEqual(rows('mock.start').length, 1);
});

test('start again or another mock resumes the active attempt', async () => {
  for (const id of [mockId, mock2Id]) {
    const res = await call(`${M}/${id}/start`, 'POST', null, A);
    assert.strictEqual(res.status, 200);
    const b = await res.json();
    assert.strictEqual(b.attempt_id, attemptId);
    assert.strictEqual(b.mock_id, mockId);
  }
  assert.strictEqual(db.prepare("select count(*) n from attempts where kind = 'mock'").get().n, 1);
  assert.strictEqual((await (await call(`${M}/current`, 'GET', null, A)).json()).attempt_id, attemptId);
  assert.deepStrictEqual(await (await call(`${M}/current`, 'GET', null, B)).json(), { status: 'none' });
});

test('autosave, validation and ownership', async () => {
  const q0 = qs[0], p = `${M}/attempts/${attemptId}/answer`;
  assert.strictEqual((await (await call(p, 'PUT', { questionId: q0.id, selectedIndex: 1 }, A)).json()).saved, true);
  await call(p, 'PUT', { questionId: q0.id, selectedIndex: 2 }, A);
  const cur = await (await call(`${M}/current`, 'GET', null, A)).json();
  assert.strictEqual(cur.answers[q0.id], 2);
  assert.strictEqual(db.prepare('select count(*) n from attempt_answers where attempt_id = ?').get(attemptId).n, 1);
  assert.strictEqual((await call(p, 'PUT', { questionId: q0.id, selectedIndex: 9 }, A)).status, 400);
  assert.strictEqual((await call(p, 'PUT', { questionId: q0.id, selectedIndex: '1' }, A)).status, 400);
  assert.strictEqual((await call(p, 'PUT', { questionId: 99999, selectedIndex: 0 }, A)).status, 400);
  assert.strictEqual((await call(p, 'PUT', undefined, A)).status, 400);
  assert.strictEqual((await call(p, 'PUT', { questionId: q0.id, selectedIndex: 0 }, B)).status, 404);
  assert.strictEqual((await call(`${M}/attempts/abc/answer`, 'PUT', { questionId: q0.id, selectedIndex: 0 }, A)).status, 404);
  assert.strictEqual((await call(`${M}/attempts/${attemptId}/submit`, 'POST', null, B)).status, 404);
});

test('submit grades on server with per-section scores; idempotent; closes attempt; audited once', async () => {
  await answerAll(A, attemptId, qs, q => q.section === 'Aptitude' ? right(q) : wrong(q));
  const res = await call(`${M}/attempts/${attemptId}/submit`, 'POST', null, A);
  assert.strictEqual(res.status, 200);
  const b = await res.json();
  assert.strictEqual(b.status, 'completed');
  assert.strictEqual(b.score, 4);
  assert.strictEqual(b.total, 8);
  assert.deepStrictEqual(b.sections, [{ section: 'Aptitude', score: 4, total: 4 }, { section: 'Programming', score: 0, total: 4 }]);
  assert.strictEqual(b.review.length, 8);
  assert.ok(b.review.every(x => Number.isInteger(x.correct_index) && typeof x.section === 'string'));
  assert.strictEqual((await (await call(`${M}/attempts/${attemptId}/submit`, 'POST', null, A)).json()).score, 4);
  assert.strictEqual((await call(`${M}/attempts/${attemptId}/answer`, 'PUT', { questionId: qs[0].id, selectedIndex: 0 }, A)).status, 409);
  const r = rows('mock.submit');
  assert.strictEqual(r.length, 1);
  const d = JSON.parse(r[0].details);
  assert.strictEqual(d.score, 4);
  assert.strictEqual(d.auto, false);
  assert.strictEqual(d.sections.length, 2);
});

test('retake allowed; expired attempt auto-finalizes with saved answers only', async () => {
  const res = await call(`${M}/${mockId}/start`, 'POST', null, A);
  assert.strictEqual(res.status, 201);
  const s = await res.json();
  assert.notStrictEqual(s.attempt_id, attemptId);
  await answerAll(A, s.attempt_id, s.questions.slice(0, 2), right);
  db.prepare('update attempts set deadline = 1 where id = ?').run(s.attempt_id);
  assert.strictEqual((await call(`${M}/attempts/${s.attempt_id}/answer`, 'PUT',
    { questionId: s.questions[5].id, selectedIndex: right(s.questions[5]) }, A)).status, 409);
  assert.deepStrictEqual(await (await call(`${M}/current`, 'GET', null, A)).json(), { status: 'none' });
  const h = await (await call(`${M}/attempts/history`, 'GET', null, A)).json();
  assert.strictEqual(h.length, 2);
  assert.strictEqual(h[0].score, 2);
  assert.strictEqual(h[0].total, 8);
  assert.strictEqual(JSON.parse(rows('mock.submit').pop().details).auto, true);
});

test('attempt detail is owner-only; history is per-student, newest first, no answer key', async () => {
  const d = await (await call(`${M}/attempts/${attemptId}`, 'GET', null, A)).json();
  assert.strictEqual(d.status, 'completed');
  assert.strictEqual(d.score, 4);
  assert.strictEqual(d.review.length, 8);
  for (const id of [attemptId, 'abc', 9999]) assert.strictEqual((await call(`${M}/attempts/${id}`, 'GET', null, B)).status, 404);
  const h = await (await call(`${M}/attempts/history`, 'GET', null, A)).json();
  assert.ok(h[0].id > h[1].id);
  assert.strictEqual(h[0].title, 'Acme Technologies Mock');
  assert.ok(!JSON.stringify(h).includes('correct'));
  assert.strictEqual((await (await call(`${M}/attempts/history`, 'GET', null, B)).json()).length, 0);
});

test('mock attempts do not alter practice-based verified performance', async () => {
  const p = await (await call('/api/student/performance', 'GET', null, A)).json();
  assert.strictEqual(p.verified.total_sessions, 0);
});

test('company prep: resources, mocks, drives with eligibility, verified readiness', async () => {
  const P = `/api/companies/${acmeId}/prep`;
  assert.strictEqual((await call('/api/companies/9999/prep', 'GET', null, A)).status, 404);
  assert.strictEqual((await call('/api/companies/abc/prep', 'GET', null, A)).status, 404);
  const d = await call('/api/drives', 'POST', { company: 'acme technologies', role: 'SDE', min_cgpa: 8, deadline: future }, coord);
  assert.strictEqual(d.status, 201);
  let p = await (await call(P, 'GET', null, A)).json();
  assert.strictEqual(p.company.name, 'Acme Technologies');
  assert.deepStrictEqual(p.resources.map(x => x.kind), ['topic', 'link']);
  assert.strictEqual(p.mocks.length, 1);
  assert.strictEqual(p.mocks[0].id, mockId);
  assert.strictEqual(p.mocks[0].duration_minutes, 30);
  assert.strictEqual(p.drives.length, 1);
  assert.strictEqual(p.drives[0].eligible, false);
  assert.deepStrictEqual(p.drives[0].failed_rules, ['cgpa']);
  assert.deepStrictEqual(p.readiness.map(x => x.category), ['aptitude', 'programming']);
  assert.ok(p.readiness.every(x => x.accuracy === null && x.needs_work === true && x.source === 'system_verified'));
  const uid = db.prepare("select id from users where email = 'anu@t.com'").get().id;
  const ins = db.prepare("insert into attempts(user_id, kind, started_at, deadline, submitted_at, score, total, category, difficulty) values(?, 'practice', 1, 2, 3, ?, ?, ?, 'Beginner')");
  ins.run(uid, 5, 5, 'aptitude');
  p = await (await call(P, 'GET', null, A)).json();
  assert.deepStrictEqual([p.readiness[0].accuracy, p.readiness[0].needs_work], [100, false]);
  assert.deepStrictEqual([p.readiness[1].accuracy, p.readiness[1].needs_work], [null, true]);
  ins.run(uid, 1, 5, 'programming');
  p = await (await call(P, 'GET', null, A)).json();
  assert.deepStrictEqual([p.readiness[1].accuracy, p.readiness[1].needs_work], [20, true]);
});

test('sample seed: idempotent, complete', () => {
  const d = createDb();
  seedMockQuestions(d);
  for (let i = 0; i < 2; i++) {
    seedSamples(d);
    assert.strictEqual(d.prepare('select count(*) n from companies').get().n, 1);
    assert.strictEqual(d.prepare('select count(*) n from company_resources').get().n, 3);
    assert.strictEqual(d.prepare('select count(*) n from mock_tests').get().n, 2);
    assert.strictEqual(d.prepare('select count(*) n from mock_test_questions').get().n, 16);
  }
});

test('audit chain valid after mock and company activity', () => {
  const v = verifyChain(db);
  assert.strictEqual(v.valid, true);
  assert.ok(v.count >= 12);
});
