const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { audit, verifyChain, currentHead, checkAgainstHead, GENESIS } = require('../src/audit');

const unlimited = { auth: { windowMs: 1000, max: 1e6 }, register: { windowMs: 1000, max: 1e6 } };
const rows = (d, a) => d.prepare('select * from audit_log where action = ? order by id').all(a);

test('currentHead: empty log uses the genesis hash', () => {
  assert.deepStrictEqual(currentHead(createDb()), { count: 0, head: GENESIS });
});

test('currentHead tracks the newest entry', () => {
  const d = createDb();
  audit(d, { action: 'a' });
  const h = audit(d, { action: 'b' });
  assert.deepStrictEqual(currentHead(d), { count: 2, head: h });
});

test('check: matches when nothing changed, and reports how many entries were added', () => {
  const d = createDb();
  audit(d, { action: 'a' }); audit(d, { action: 'b' });
  const saved = currentHead(d);
  assert.strictEqual(checkAgainstHead(d, saved).result, 'matches');
  audit(d, { action: 'c' }); audit(d, { action: 'd' });
  const r = checkAgainstHead(d, saved);
  assert.strictEqual(r.result, 'matches');
  assert.match(r.message, /2 entries were added/);
});

test('check: detects truncation of the newest entries', () => {
  const d = createDb();
  for (const a of ['a', 'b', 'c', 'd']) audit(d, { action: a });
  const saved = currentHead(d);
  d.exec('DROP TRIGGER audit_no_delete');
  d.prepare('delete from audit_log where id > 2').run();
  assert.strictEqual(verifyChain(d).valid, true);
  const r = checkAgainstHead(d, saved);
  assert.strictEqual(r.result, 'truncated');
  assert.match(r.message, /4 entries but the log now has 2/);
});

test('check: detects a rebuilt log that is internally consistent but different', () => {
  const d = createDb();
  for (const a of ['a', 'b', 'c']) audit(d, { action: a });
  const saved = currentHead(d);
  d.exec('DROP TRIGGER audit_no_delete');
  d.prepare('delete from audit_log').run();
  for (const a of ['a', 'x', 'c', 'd']) audit(d, { action: a });
  assert.strictEqual(verifyChain(d).valid, true);
  assert.strictEqual(checkAgainstHead(d, saved).result, 'diverged');
});

test('check: a broken chain is reported as diverged', () => {
  const d = createDb();
  for (const a of ['a', 'b']) audit(d, { action: a });
  const saved = currentHead(d);
  d.exec('DROP TRIGGER audit_no_update');
  d.prepare("update audit_log set action = 'evil' where id = 1").run();
  const r = checkAgainstHead(d, saved);
  assert.strictEqual(r.result, 'diverged');
  assert.match(r.message, /broken at entry 1/);
});

test('check: an empty saved head matches any chain', () => {
  const d = createDb();
  audit(d, { action: 'a' });
  assert.strictEqual(checkAgainstHead(d, { count: 0, head: GENESIS }).result, 'matches');
});

let server, base, db, admin, student, coord;
test.before(async () => {
  db = createDb();
  server = createApp(db, { rateLimits: unlimited, serveClient: false }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
const call = (p, method = 'GET', body, token) => fetch(base + p, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined
});
const login = async (email, pw = 'password123') => (await (await call('/api/auth/login', 'POST', { email, password: pw })).json()).token;

test('setup users', async () => {
  for (const [n, role] of [['Root', 'admin'], ['Coord', 'coordinator']])
    db.prepare('insert into users(name,email,password_hash,role) values(?,?,?,?)').run(n, n.toLowerCase() + '@t.com', hashPassword('password123'), role);
  await call('/api/auth/register', 'POST', { name: 'S', email: 's@t.com', password: 'password123' });
  admin = await login('root@t.com'); coord = await login('coord@t.com'); student = await login('s@t.com');
  assert.ok(admin && coord && student);
});

test('head endpoints are admin-only', async () => {
  for (const [m, p, b] of [['GET', '/head'], ['POST', '/check-head', { count: 0, head: GENESIS }]]) {
    assert.strictEqual((await call('/api/admin/audit' + p, m, b)).status, 401);
    assert.strictEqual((await call('/api/admin/audit' + p, m, b, student)).status, 403);
    assert.strictEqual((await call('/api/admin/audit' + p, m, b, coord)).status, 403);
  }
});

test('exporting the head returns count, head and time, and is itself audited', async () => {
  const res = await call('/api/admin/audit/head', 'GET', null, admin);
  assert.strictEqual(res.status, 200);
  const h = await res.json();
  assert.ok(Number.isInteger(h.count) && h.count > 0);
  assert.match(h.head, /^[0-9a-f]{64}$/);
  assert.ok(Math.abs(h.ts - Date.now()) < 60000);
  const r = rows(db, 'audit.export_head');
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(JSON.parse(r[0].details), { count: h.count });
  assert.strictEqual(verifyChain(db).valid, true);
});

test('a saved head checks out through the API, and later activity still matches', async () => {
  const saved = await (await call('/api/admin/audit/head', 'GET', null, admin)).json();
  const ok = await (await call('/api/admin/audit/check-head', 'POST', { count: saved.count, head: saved.head }, admin)).json();
  assert.strictEqual(ok.result, 'matches');
  await call('/api/auth/register', 'POST', { name: 'T', email: 't@t.com', password: 'password123' });
  const later = await (await call('/api/admin/audit/check-head', 'POST', { count: saved.count, head: saved.head }, admin)).json();
  assert.strictEqual(later.result, 'matches');
  assert.match(later.message, /entries were added/);
});

test('truncation is detected through the API', async () => {
  const saved = await (await call('/api/admin/audit/head', 'GET', null, admin)).json();
  db.exec('DROP TRIGGER audit_no_delete');
  db.prepare('delete from audit_log where id > ?').run(saved.count - 3);
  const r = await (await call('/api/admin/audit/check-head', 'POST', { count: saved.count, head: saved.head }, admin)).json();
  assert.strictEqual(r.result, 'truncated');
  assert.match(r.message, /Entries were removed from the end/);
});

test('invalid saved heads are rejected', async () => {
  for (const bad of [{}, { count: -1, head: GENESIS }, { count: 1.5, head: GENESIS }, { count: '1', head: GENESIS },
    { count: 1, head: 'zz' }, { count: 1, head: 'A'.repeat(64) }, { count: 1, head: 'a'.repeat(63) }, { count: 1 }])
    assert.strictEqual((await call('/api/admin/audit/check-head', 'POST', bad, admin)).status, 400, JSON.stringify(bad));
});
