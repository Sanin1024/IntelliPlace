const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { verifyChain } = require('../src/audit');
const { evaluate } = require('../src/eligibility');

const base = { status: 'open', deadline: Date.now() + 1e6, min_cgpa: null, allowed_departments: [],
  min_year: null, max_year: null, required_level: null, required_skills: [] };
const ev = (drive, profile) => evaluate({ ...base, ...drive }, profile);
const failed = r => r.rules.filter(x => !x.passed).map(x => x.rule);

test('engine: no criteria means eligible with only drive_open rule', () => {
  const r = ev({}, null);
  assert.strictEqual(r.eligible, true);
  assert.deepStrictEqual(r.rules.map(x => x.rule), ['drive_open']);
});

test('engine: cgpa pass, equal, below, missing', () => {
  const d = { min_cgpa: 7.5 };
  assert.strictEqual(ev(d, { cgpa: 8 }).eligible, true);
  assert.strictEqual(ev(d, { cgpa: 7.5 }).eligible, true);
  const low = ev(d, { cgpa: 6.9 });
  assert.deepStrictEqual(failed(low), ['cgpa']);
  assert.match(low.rules[1].message, /6\.9/);
  assert.match(low.rules[1].message, /7\.5/);
  assert.match(ev(d, {}).rules[1].message, /Add your CGPA/);
});

test('engine: department case-insensitive, unlisted and missing fail', () => {
  const d = { allowed_departments: ['CSE', 'IT'] };
  assert.strictEqual(ev(d, { department: 'cse' }).eligible, true);
  assert.deepStrictEqual(failed(ev(d, { department: 'ECE' })), ['department']);
  assert.deepStrictEqual(failed(ev(d, {})), ['department']);
});

test('engine: year range and open-ended bounds', () => {
  const d = { min_year: 3, max_year: 4 };
  assert.deepStrictEqual([2, 3, 4, 5, null].map(y => ev(d, { year: y }).eligible), [false, true, true, false, false]);
  assert.strictEqual(ev({ min_year: 3 }, { year: 6 }).eligible, true);
  assert.strictEqual(ev({ max_year: 2 }, { year: 3 }).eligible, false);
});

test('engine: level uses verified rank and is labelled system_verified', () => {
  const d = { required_level: 'Intermediate' };
  assert.deepStrictEqual(['Beginner', 'Intermediate', 'Advanced', null].map(l => ev(d, { level: l }).eligible), [false, true, true, false]);
  assert.strictEqual(ev(d, { level: 'Beginner' }).rules[1].source, 'system_verified');
  assert.strictEqual(ev({ min_cgpa: 5 }, { cgpa: 9 }).rules[1].source, 'self_reported');
  assert.match(ev(d, {}).rules[1].message, /initial assessment/);
});

test('engine: skills case-insensitive, missing skills named', () => {
  const d = { required_skills: ['SQL', 'Java'] };
  assert.strictEqual(ev(d, { skills: ['sql', 'JAVA', 'C'] }).eligible, true);
  const r = ev(d, { skills: ['sql'] });
  assert.deepStrictEqual(failed(r), ['skills']);
  assert.match(r.rules[1].message, /Java/);
  assert.ok(!/SQL/.test(r.rules[1].message));
});

test('engine: closed drive and passed deadline', () => {
  const c = ev({ status: 'closed' }, {});
  assert.deepStrictEqual(failed(c), ['drive_open']);
  assert.match(c.rules[0].message, /closed/);
  const l = ev({ deadline: 1 }, {});
  assert.deepStrictEqual(failed(l), ['drive_open']);
  assert.match(l.rules[0].message, /deadline/);
});

test('engine: null profile does not throw and fails all criteria', () => {
  const r = ev({ min_cgpa: 7, allowed_departments: ['CSE'], min_year: 3, required_level: 'Beginner', required_skills: ['SQL'] }, null);
  assert.deepStrictEqual(failed(r).sort(), ['cgpa', 'department', 'level', 'skills', 'year']);
});

test('engine: every failure is listed, none short-circuited', () => {
  const r = ev({ min_cgpa: 9, allowed_departments: ['CSE'], required_skills: ['Go'] }, { cgpa: 5, department: 'ECE', skills: [] });
  assert.deepStrictEqual(failed(r), ['cgpa', 'department', 'skills']);
});

let server, base_url, db, staff, admin, S1, S2, S3, S4, driveId;
test.before(async () => {
  db = createDb();
  server = createApp(db).listen(0);
  await new Promise(r => server.once('listening', r));
  base_url = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (path, method = 'GET', body, token) => fetch(base_url + path, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined
});
const login = async (email, pw = 'password123') =>
  (await (await call('/api/auth/login', 'POST', { email, password: pw })).json()).token;
const mkStudent = async n => {
  await call('/api/auth/register', 'POST', { name: n, email: n.toLowerCase() + '@t.com', password: 'password123' });
  return login(n.toLowerCase() + '@t.com');
};
const rows = a => db.prepare('select * from audit_log where action = ? order by id').all(a);
const future = new Date(Date.now() + 7 * 864e5).toISOString();
const spec = { company: 'Acme', role: 'SDE', min_cgpa: 7.5, allowed_departments: ['CSE', 'IT'], min_year: 3,
  required_level: 'Intermediate', required_skills: ['SQL'], deadline: future };
const setLevel = (email, lvl) => db.prepare(
  "update student_profiles set level = ?, level_source = 'system_assessment' where user_id = (select id from users where email = ?)").run(lvl, email);

test('setup users and profiles', async () => {
  for (const [n, role] of [['Coord', 'coordinator'], ['Root', 'admin']])
    db.prepare('insert into users(name,email,password_hash,role) values(?,?,?,?)')
      .run(n, n.toLowerCase() + '@t.com', hashPassword('password123'), role);
  staff = await login('coord@t.com'); admin = await login('root@t.com');
  S1 = await mkStudent('S1'); S2 = await mkStudent('S2'); S3 = await mkStudent('S3'); S4 = await mkStudent('S4');
  const P = '/api/student/profile';
  assert.strictEqual((await call(P, 'PUT', { cgpa: 8, department: 'cse', year: 3, skills: ['sql', 'Java'] }, S1)).status, 200);
  assert.strictEqual((await call(P, 'PUT', { cgpa: 6.9, department: 'ECE', year: 2, skills: ['Java'] }, S2)).status, 200);
  setLevel('s1@t.com', 'Advanced');
  assert.ok(staff && admin && S1 && S2 && S3 && S4);
});

test('create drive: 401 anon, 403 student, 201 coordinator and admin, mass-assignment ignored', async () => {
  assert.strictEqual((await call('/api/drives', 'POST', spec)).status, 401);
  assert.strictEqual((await call('/api/drives', 'POST', spec, S1)).status, 403);
  const res = await call('/api/drives', 'POST', { ...spec, status: 'closed', created_by: 999 }, staff);
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.status, 'open');
  assert.strictEqual(b.company, 'Acme');
  assert.deepStrictEqual(b.required_skills, ['SQL']);
  driveId = b.id;
  assert.strictEqual((await call('/api/drives', 'POST', spec, admin)).status, 201);
  assert.strictEqual(db.prepare('select created_by from drives where id = ?').get(driveId).created_by,
    db.prepare("select id from users where email = 'coord@t.com'").get().id);
});

test('create drive: invalid inputs return 400', async () => {
  const bads = [{ company: '' }, { role: undefined }, { min_cgpa: 11 }, { min_cgpa: 'x' },
    { allowed_departments: 'CSE' }, { allowed_departments: [1] }, { min_year: 0 }, { min_year: 4, max_year: 3 },
    { required_level: 'Expert' }, { required_skills: [''] }, { deadline: undefined }, { deadline: 'garbage' },
    { deadline: new Date(Date.now() - 1000).toISOString() }];
  for (const patch of bads)
    assert.strictEqual((await call('/api/drives', 'POST', { ...spec, ...patch }, staff)).status, 400, JSON.stringify(patch));
  assert.strictEqual((await call('/api/drives', 'POST', {}, staff)).status, 400);
});

test('drive creation is audited (valid only)', () => {
  const r = rows('drive.create');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].entity_id, String(driveId));
});

test('available: student only, shows eligibility per student', async () => {
  assert.strictEqual((await call('/api/drives/available')).status, 401);
  assert.strictEqual((await call('/api/drives/available', 'GET', null, staff)).status, 403);
  const a = await (await call('/api/drives/available', 'GET', null, S1)).json();
  assert.strictEqual(a.length, 2);
  assert.ok(a.every(d => d.eligible === true && d.applied === false && d.failed_count === 0));
  const b = await (await call('/api/drives/available', 'GET', null, S2)).json();
  assert.ok(b.every(d => d.eligible === false && d.failed_count === 5));
});

test('eligibility endpoint explains every failure with source', async () => {
  const ok = await (await call(`/api/drives/${driveId}/eligibility`, 'GET', null, S1)).json();
  assert.strictEqual(ok.eligible, true);
  const r = await (await call(`/api/drives/${driveId}/eligibility`, 'GET', null, S2)).json();
  assert.strictEqual(r.eligible, false);
  assert.deepStrictEqual(r.rules.filter(x => !x.passed).map(x => x.rule).sort(), ['cgpa', 'department', 'level', 'skills', 'year']);
  assert.strictEqual(r.rules.find(x => x.rule === 'level').source, 'system_verified');
  assert.strictEqual(r.rules.find(x => x.rule === 'cgpa').source, 'self_reported');
  assert.ok(r.rules.every(x => typeof x.message === 'string' && x.message.length > 10));
});

test('level cannot be self-reported to satisfy a drive', async () => {
  await call('/api/student/profile', 'PUT', { cgpa: 9, department: 'CSE', year: 3, skills: ['SQL'], level: 'Advanced' }, S4);
  const r = await (await call(`/api/drives/${driveId}/eligibility`, 'GET', null, S4)).json();
  assert.deepStrictEqual(r.rules.filter(x => !x.passed).map(x => x.rule), ['level']);
});

test('ineligible apply is rejected server-side, client flags ignored, attempt audited', async () => {
  const res = await call(`/api/drives/${driveId}/apply`, 'POST', { eligible: true, override: true }, S2);
  assert.strictEqual(res.status, 403);
  const b = await res.json();
  assert.strictEqual(b.eligible, false);
  assert.ok(b.rules.length >= 5);
  assert.strictEqual(db.prepare('select count(*) c from applications').get().c, 0);
  const a = rows('application.rejected');
  assert.strictEqual(a.length, 1);
  assert.ok(JSON.parse(a[0].details).failed.includes('cgpa'));
});

test('eligible apply succeeds once, duplicate 409, audited once', async () => {
  const res = await call(`/api/drives/${driveId}/apply`, 'POST', null, S1);
  assert.strictEqual(res.status, 201);
  assert.strictEqual((await res.json()).applied, true);
  assert.strictEqual((await call(`/api/drives/${driveId}/apply`, 'POST', null, S1)).status, 409);
  assert.strictEqual(db.prepare('select count(*) c from applications').get().c, 1);
  assert.strictEqual(rows('application.submit').length, 1);
  const a = await (await call('/api/drives/available', 'GET', null, S1)).json();
  assert.strictEqual(a.find(d => d.id === driveId).applied, true);
});

test('closing a drive blocks applications; close is audited once, idempotent, staff-only', async () => {
  const d2 = await (await call('/api/drives', 'POST', spec, staff)).json();
  assert.strictEqual((await call(`/api/drives/${d2.id}/close`, 'POST', null, S1)).status, 403);
  assert.strictEqual((await call(`/api/drives/${d2.id}/close`, 'POST', null, staff)).status, 200);
  assert.strictEqual((await call(`/api/drives/${d2.id}/close`, 'POST', null, staff)).status, 200);
  assert.strictEqual(rows('drive.close').length, 1);
  const res = await call(`/api/drives/${d2.id}/apply`, 'POST', null, S1);
  assert.strictEqual(res.status, 403);
  const b = await res.json();
  assert.deepStrictEqual(b.rules.filter(x => !x.passed).map(x => x.rule), ['drive_open']);
  assert.strictEqual((await call('/api/drives/9999/close', 'POST', null, staff)).status, 404);
});

test('passed deadline blocks applications', async () => {
  const d3 = await (await call('/api/drives', 'POST', spec, staff)).json();
  db.prepare('update drives set deadline = 1 where id = ?').run(d3.id);
  const res = await call(`/api/drives/${d3.id}/apply`, 'POST', null, S1);
  assert.strictEqual(res.status, 403);
  assert.match((await res.json()).rules[0].message, /deadline/);
});

test('applications list is staff-only and correct', async () => {
  assert.strictEqual((await call(`/api/drives/${driveId}/applications`, 'GET', null, S1)).status, 403);
  assert.strictEqual((await call(`/api/drives/${driveId}/applications`)).status, 401);
  const l = await (await call(`/api/drives/${driveId}/applications`, 'GET', null, staff)).json();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].email, 's1@t.com');
  assert.strictEqual((await call('/api/drives/9999/applications', 'GET', null, staff)).status, 404);
  const all = await (await call('/api/drives', 'GET', null, admin)).json();
  assert.strictEqual(all.find(d => d.id === driveId).application_count, 1);
  assert.strictEqual((await call('/api/drives', 'GET', null, S1)).status, 403);
});

test('unknown or malformed drive id returns 404', async () => {
  for (const id of ['9999', 'abc', '1e3'])
    for (const [p, m] of [['eligibility', 'GET'], ['apply', 'POST']])
      assert.strictEqual((await call(`/api/drives/${id}/${p}`, m, null, S1)).status, 404, `${m} ${id}/${p}`);
});

test('audit chain still valid after drive activity', () => {
  const v = verifyChain(db);
  assert.strictEqual(v.valid, true);
  assert.ok(v.count >= 12);
});
