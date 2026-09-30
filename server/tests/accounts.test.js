const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createSession } = require('../src/auth');
const { createStaff } = require('../src/accounts');
const { verifyChain } = require('../src/audit');

let server, url, db, adminId, admin, admin2, S1, C1, C1b;
test.before(async () => {
  db = createDb();
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
const U = '/api/admin/users';
const PW = 'password123';
const login = async (email, password = PW) => {
  const r = await call('/api/auth/login', 'POST', { email, password });
  return r.status === 200 ? (await r.json()).token : null;
};
const bad = (email, password = 'wrongpass1') => call('/api/auth/login', 'POST', { email, password });
const mkStudent = async n => {
  await call('/api/auth/register', 'POST', { name: n, email: n.toLowerCase() + '@t.com', password: PW });
  return login(n.toLowerCase() + '@t.com');
};
const rows = a => db.prepare('select * from audit_log where action = ? order by id').all(a);
const urow = email => db.prepare('select * from users where email = ?').get(email);
const uid = email => urow(email).id;
const staffBody = { name: 'Coord One', email: 'Coord1@T.com', password: PW, role: 'coordinator' };

test('bootstrap: createStaff makes a hashed admin, audits with no actor, rejects duplicates', async () => {
  const a = createStaff(db, { name: 'Root', email: 'root@t.com', password: 'adminpass123', role: 'admin', action: 'admin.bootstrap' });
  adminId = a.id;
  assert.strictEqual(a.role, 'admin');
  assert.ok(urow('root@t.com').password_hash.startsWith('scrypt$'));
  const r = rows('admin.bootstrap');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].actor_id, null);
  assert.strictEqual(r[0].entity_id, String(adminId));
  assert.throws(() => createStaff(db, { name: 'X', email: 'root@t.com', password: 'adminpass123', role: 'admin', action: 'admin.bootstrap' }), /already registered/);
  assert.strictEqual(rows('admin.bootstrap').length, 1);
  admin = await login('root@t.com', 'adminpass123');
  assert.ok(admin);
  S1 = await mkStudent('S1');
  assert.ok(S1);
});

test('endpoints require an admin', async () => {
  for (const [m, p] of [['GET', ''], ['POST', ''], ['POST', '/1/disable'], ['POST', '/1/enable'], ['POST', '/1/unlock'], ['POST', '/1/reset-password']]) {
    assert.strictEqual((await call(U + p, m)).status, 401, `${m} ${p} anon`);
    assert.strictEqual((await call(U + p, m, null, S1)).status, 403, `${m} ${p} student`);
  }
});

test('create staff: validation, mass assignment ignored, login works, audited', async () => {
  const bads = [{}, { ...staffBody, role: 'student' }, { ...staffBody, role: 'root' }, { ...staffBody, role: undefined },
    { ...staffBody, email: 'nope' }, { ...staffBody, password: 'short' }, { ...staffBody, password: 12345678 },
    { ...staffBody, name: ' ' }, { ...staffBody, name: 'x'.repeat(101) }];
  for (const b of bads) assert.strictEqual((await call(U, 'POST', b, admin)).status, 400, JSON.stringify(b).slice(0, 60));
  assert.strictEqual(db.prepare("select count(*) n from users where role <> 'student'").get().n, 1);
  const res = await call(U, 'POST', { ...staffBody, id: 999, disabled_at: 1, failed_logins: 3 }, admin);
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.deepStrictEqual(Object.keys(b).sort(), ['email', 'id', 'name', 'role']);
  assert.strictEqual(b.email, 'coord1@t.com');
  assert.strictEqual(b.role, 'coordinator');
  assert.notStrictEqual(b.id, 999);
  const row = urow('coord1@t.com');
  assert.strictEqual(row.disabled_at, null);
  assert.strictEqual(row.failed_logins, 0);
  C1 = await login('coord1@t.com');
  C1b = await login('coord1@t.com');
  assert.ok(C1 && C1b);
  assert.strictEqual((await (await call('/api/auth/me', 'GET', null, C1)).json()).role, 'coordinator');
  const r = rows('user.create_staff');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].actor_id, adminId);
  assert.deepStrictEqual(JSON.parse(r[0].details), { role: 'coordinator' });
  assert.strictEqual((await call(U, 'POST', { ...staffBody, email: 'COORD1@t.com' }, admin)).status, 409);
  for (const t of [C1, S1]) assert.strictEqual((await call(U, 'POST', staffBody, t)).status, 403);
  const a2 = await call(U, 'POST', { name: 'Root Two', email: 'root2@t.com', password: 'adminpass123', role: 'admin' }, admin);
  assert.strictEqual(a2.status, 201);
  assert.strictEqual((await a2.json()).role, 'admin');
  admin2 = await login('root2@t.com', 'adminpass123');
  assert.ok(admin2);
  assert.strictEqual(rows('user.create_staff').length, 2);
});

test('list users: filters, clamping, no secrets', async () => {
  const all = await (await call(U, 'GET', null, admin)).json();
  assert.deepStrictEqual(all.map(u => u.email), ['root@t.com', 's1@t.com', 'coord1@t.com', 'root2@t.com']);
  assert.deepStrictEqual(all.map(u => u.role), ['admin', 'student', 'coordinator', 'admin']);
  assert.ok(all.every(u => u.disabled === false && u.locked === false));
  assert.ok(!/password|scrypt|hash/i.test(JSON.stringify(all)));
  const co = await (await call(U + '?role=coordinator', 'GET', null, admin)).json();
  assert.deepStrictEqual(co.map(u => u.email), ['coord1@t.com']);
  assert.strictEqual((await call(U + '?role=boss', 'GET', null, admin)).status, 400);
  assert.strictEqual((await call(U + '?role=admin&role=student', 'GET', null, admin)).status, 400);
  assert.strictEqual((await (await call(U + '?limit=2', 'GET', null, admin)).json()).length, 2);
  assert.strictEqual((await (await call(U + '?limit=abc', 'GET', null, admin)).json()).length, 4);
  assert.strictEqual((await (await call(U + '?limit=99999', 'GET', null, admin)).json()).length, 4);
  for (const t of [C1, S1]) assert.strictEqual((await call(U, 'GET', null, t)).status, 403);
});

test('disable: revokes sessions, blocks login, idempotent, audited; self and unknown rejected', async () => {
  const cid = uid('coord1@t.com');
  assert.strictEqual(db.prepare('select count(*) n from sessions where user_id = ?').get(cid).n, 2);
  const res = await call(`${U}/${cid}/disable`, 'POST', null, admin);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).disabled, true);
  assert.strictEqual(db.prepare('select count(*) n from sessions where user_id = ?').get(cid).n, 0);
  for (const t of [C1, C1b]) assert.strictEqual((await call('/api/auth/me', 'GET', null, t)).status, 401);
  const wrong = await bad('coord1@t.com');
  const dis = await call('/api/auth/login', 'POST', { email: 'coord1@t.com', password: PW });
  assert.strictEqual(dis.status, 401);
  assert.deepStrictEqual(await dis.json(), await wrong.json());
  assert.strictEqual(rows('auth.login_disabled').length, 1);
  assert.strictEqual((await call(`${U}/${cid}/disable`, 'POST', null, admin)).status, 200);
  const d = rows('user.disable');
  assert.strictEqual(d.length, 1);
  assert.deepStrictEqual([d[0].actor_id, d[0].entity_id], [adminId, String(cid)]);
  assert.strictEqual((await call(`${U}/${adminId}/disable`, 'POST', null, admin)).status, 409);
  assert.strictEqual(urow('root@t.com').disabled_at, null);
  for (const id of [9999, 'abc']) assert.strictEqual((await call(`${U}/${id}/disable`, 'POST', null, admin)).status, 404);
  assert.strictEqual(rows('user.disable').length, 1);
  const stray = createSession(db, cid);
  assert.strictEqual((await call('/api/auth/me', 'GET', null, stray)).status, 401);
});

test('enable: restores access, clears counters, idempotent, audited', async () => {
  const cid = uid('coord1@t.com');
  assert.ok(urow('coord1@t.com').failed_logins > 0);
  const res = await call(`${U}/${cid}/enable`, 'POST', null, admin);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).disabled, false);
  const row = urow('coord1@t.com');
  assert.deepStrictEqual([row.disabled_at, row.failed_logins, row.locked_until], [null, 0, null]);
  C1 = await login('coord1@t.com');
  assert.ok(C1);
  assert.strictEqual((await call('/api/auth/me', 'GET', null, C1)).status, 200);
  assert.strictEqual((await call(`${U}/${cid}/enable`, 'POST', null, admin)).status, 200);
  assert.strictEqual(rows('user.enable').length, 1);
  assert.strictEqual((await call(`${U}/9999/enable`, 'POST', null, admin)).status, 404);
});

test('lockout: 5 consecutive failures lock the account; correct password refused while locked', async () => {
  const email = 'lock1@t.com';
  await call('/api/auth/register', 'POST', { name: 'Lock1', email, password: PW });
  for (let i = 0; i < 4; i++) assert.strictEqual((await bad(email)).status, 401);
  assert.strictEqual(urow(email).failed_logins, 4);
  assert.ok(await login(email));
  assert.strictEqual(urow(email).failed_logins, 0);
  for (let i = 0; i < 5; i++) assert.strictEqual((await bad(email)).status, 401);
  const row = urow(email);
  assert.ok(row.locked_until > Date.now() + 14 * 60 * 1000 && row.locked_until <= Date.now() + 15 * 60 * 1000);
  assert.strictEqual(row.failed_logins, 0);
  assert.strictEqual(rows('auth.lockout').length, 1);
  const failedBefore = rows('auth.login_failed').length;
  const blocked = await call('/api/auth/login', 'POST', { email, password: PW });
  assert.strictEqual(blocked.status, 401);
  assert.strictEqual(rows('auth.login_failed').length, failedBefore);
  assert.strictEqual(urow(email).locked_until, row.locked_until);
  assert.deepStrictEqual(await blocked.json(), await (await bad('nobody@t.com')).json());
  const listed = (await (await call(U + '?role=student', 'GET', null, admin)).json()).find(u => u.email === email);
  assert.strictEqual(listed.locked, true);
  db.prepare('update users set locked_until = 1 where email = ?').run(email);
  assert.ok(await login(email));
  assert.strictEqual(urow(email).failed_logins, 0);
  assert.strictEqual((await bad(email)).status, 401);
  assert.strictEqual(urow(email).failed_logins, 1);
});

test('admin unlock: clears a lock early, audited only when it was locked', async () => {
  const email = 'lock2@t.com';
  await call('/api/auth/register', 'POST', { name: 'Lock2', email, password: PW });
  for (let i = 0; i < 5; i++) await bad(email);
  assert.strictEqual(await login(email), null);
  const id = uid(email);
  const res = await call(`${U}/${id}/unlock`, 'POST', null, admin);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).locked, false);
  assert.ok(await login(email));
  assert.strictEqual(rows('user.unlock').length, 1);
  assert.strictEqual((await call(`${U}/${id}/unlock`, 'POST', null, admin)).status, 200);
  assert.strictEqual(rows('user.unlock').length, 1);
  assert.strictEqual((await call(`${U}/9999/unlock`, 'POST', null, admin)).status, 404);
  assert.strictEqual(rows('auth.lockout').length, 2);
});

test('change own password: validation, wrong current counts as a failure, success revokes other sessions', async () => {
  const email = 'pw1@t.com';
  const A = await mkStudent('Pw1');
  const A2 = await login(email);
  const P = '/api/auth/password';
  assert.strictEqual((await call(P, 'POST', { current_password: PW, new_password: 'newpass456' })).status, 401);
  for (const b of [{}, { current_password: PW }, { new_password: 'newpass456' }, { current_password: PW, new_password: 'short' },
    { current_password: PW, new_password: PW }, { current_password: 5, new_password: 'newpass456' }])
    assert.strictEqual((await call(P, 'POST', b, A)).status, 400, JSON.stringify(b));
  assert.strictEqual(urow(email).failed_logins, 0);
  assert.strictEqual((await call(P, 'POST', { current_password: 'wrongpass1', new_password: 'newpass456' }, A)).status, 401);
  assert.strictEqual(urow(email).failed_logins, 1);
  assert.strictEqual(rows('auth.credential_failed').length, 1);
  const oldHash = urow(email).password_hash;
  const ok = await call(P, 'POST', { current_password: PW, new_password: 'newpass456' }, A);
  assert.strictEqual(ok.status, 200);
  assert.notStrictEqual(urow(email).password_hash, oldHash);
  assert.strictEqual(urow(email).failed_logins, 0);
  assert.strictEqual((await call('/api/auth/me', 'GET', null, A)).status, 200);
  assert.strictEqual((await call('/api/auth/me', 'GET', null, A2)).status, 401);
  assert.strictEqual(await login(email), null);
  assert.ok(await login(email, 'newpass456'));
  assert.strictEqual(rows('auth.credential_change').length, 1);
});

test('repeated wrong current passwords lock the account for login too', async () => {
  const email = 'pw2@t.com';
  const A = await mkStudent('Pw2');
  const P = '/api/auth/password';
  for (let i = 0; i < 5; i++)
    assert.strictEqual((await call(P, 'POST', { current_password: 'wrongpass1', new_password: 'newpass456' }, A)).status, 401);
  assert.ok(urow(email).locked_until > Date.now());
  assert.strictEqual(await login(email), null);
  assert.strictEqual((await call(P, 'POST', { current_password: PW, new_password: 'newpass456' }, A)).status, 401);
  assert.strictEqual(rows('auth.lockout').length, 3);
});

test('admin reset: sets a new password, revokes sessions, clears locks; self and invalid rejected', async () => {
  const cid = uid('coord1@t.com');
  const before = urow('coord1@t.com').password_hash;
  db.prepare('update users set locked_until = ?, failed_logins = 3 where id = ?').run(Date.now() + 1e6, cid);
  const R = `${U}/${cid}/reset-password`;
  for (const t of [C1, S1]) assert.strictEqual((await call(R, 'POST', { password: 'tempPass789' }, t)).status, 403);
  assert.strictEqual((await call(R, 'POST', { password: 'short' }, admin)).status, 400);
  assert.strictEqual((await call(R, 'POST', {}, admin)).status, 400);
  assert.strictEqual((await call(`${U}/${adminId}/reset-password`, 'POST', { password: 'tempPass789' }, admin)).status, 409);
  assert.strictEqual((await call(`${U}/9999/reset-password`, 'POST', { password: 'tempPass789' }, admin)).status, 404);
  assert.strictEqual(rows('user.credential_reset').length, 0);
  const res = await call(R, 'POST', { password: 'tempPass789' }, admin);
  assert.strictEqual(res.status, 200);
  const b = await res.json();
  assert.strictEqual(b.locked, false);
  assert.ok(!JSON.stringify(b).includes('tempPass789'));
  assert.notStrictEqual(urow('coord1@t.com').password_hash, before);
  assert.strictEqual(urow('coord1@t.com').failed_logins, 0);
  assert.strictEqual((await call('/api/auth/me', 'GET', null, C1)).status, 401);
  assert.strictEqual(await login('coord1@t.com'), null);
  assert.ok(await login('coord1@t.com', 'tempPass789'));
  assert.strictEqual(rows('user.credential_reset').length, 1);
});

test('audit chain valid and contains no secrets', () => {
  const v = verifyChain(db);
  assert.strictEqual(v.valid, true);
  assert.ok(v.count > 20);
  assert.ok(!/password|@|token/i.test(JSON.stringify(db.prepare('select * from audit_log').all())));
});
