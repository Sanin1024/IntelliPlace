const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../src/config');
const { createRateLimiter } = require('../src/rateLimit');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

test('config: development defaults', () => {
  const c = loadConfig({});
  assert.strictEqual(c.production, false);
  assert.strictEqual(c.port, 4000);
  assert.strictEqual(c.dbPath, 'intelliplace.db');
  assert.strictEqual(c.trustProxy, false);
  assert.deepStrictEqual(c.origins, ['http://localhost:5173', 'http://127.0.0.1:5173']);
  assert.ok(c.clientDist.endsWith(path.join('client', 'dist')));
});

test('config: production requires a client origin and does not allow dev origins', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /CLIENT_ORIGIN is required/);
  const c = loadConfig({ NODE_ENV: 'production', CLIENT_ORIGIN: 'https://placement.example.edu/' });
  assert.deepStrictEqual(c.origins, ['https://placement.example.edu']);
  assert.strictEqual(c.production, true);
});

test('config: rejects malformed origins, ports and proxy settings', () => {
  for (const bad of ['*', 'not a url', 'ftp://x.com', 'https://x.com/path', 'https://x.com/?a=1', 'https://x.com/#h'])
    assert.throws(() => loadConfig({ CLIENT_ORIGIN: bad }), /CLIENT_ORIGIN/, bad);
  for (const bad of ['0', '70000', 'abc', '1.5']) assert.throws(() => loadConfig({ PORT: bad }), /PORT/, bad);
  assert.throws(() => loadConfig({ TRUST_PROXY: 'maybe' }), /TRUST_PROXY/);
});

test('config: rate limit settings default to 20 and 10 and can be raised', () => {
  const d = loadConfig({});
  assert.deepStrictEqual([d.rateLimits.auth.max, d.rateLimits.register.max], [20, 10]);
  assert.strictEqual(d.rateLimits.auth.windowMs, 15 * 60 * 1000);
  const r = loadConfig({ RATE_LIMIT_AUTH_MAX: '1000', RATE_LIMIT_REGISTER_MAX: '500' });
  assert.deepStrictEqual([r.rateLimits.auth.max, r.rateLimits.register.max], [1000, 500]);
  for (const bad of ['0', '-1', 'abc', '1.5', '2000000']) assert.throws(() => loadConfig({ RATE_LIMIT_AUTH_MAX: bad }), /RATE_LIMIT_AUTH_MAX/, bad);
});
test('config: port, proxy hops and database path are read', () => {
  assert.strictEqual(loadConfig({ PORT: '8080' }).port, 8080);
  assert.strictEqual(loadConfig({ TRUST_PROXY: '1' }).trustProxy, 1);
  assert.strictEqual(loadConfig({ TRUST_PROXY: 'true' }).trustProxy, true);
  assert.strictEqual(loadConfig({ TRUST_PROXY: 'false' }).trustProxy, false);
  assert.strictEqual(loadConfig({ DB_PATH: 'x.db' }).dbPath, 'x.db');
});

test('rate limiter: blocks after max, sets Retry-After, resets after the window, tracks IPs separately', () => {
  let now = 1000;
  const lim = createRateLimiter({ windowMs: 60000, max: 2, now: () => now });
  const call = ip => {
    const res = { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    let passed = false;
    lim({ ip }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.ok(call('a').passed);
  assert.ok(call('a').passed);
  const blocked = call('a');
  assert.strictEqual(blocked.passed, false);
  assert.strictEqual(blocked.res.code, 429);
  assert.strictEqual(blocked.res.headers['Retry-After'], '60');
  assert.ok(call('b').passed);
  now += 59000;
  assert.strictEqual(call('a').passed, false);
  now += 1500;
  assert.ok(call('a').passed);
});

let server, base, db, cfg, dist, tmp;
const call = (p, method = 'GET', body, token, extra = {}) => fetch(base + p, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra },
  body: body ? JSON.stringify(body) : undefined
});
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-dist-'));
  dist = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>IntelliPlace app</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');
  cfg = loadConfig({ NODE_ENV: 'production', CLIENT_ORIGIN: 'https://placement.example.edu', CLIENT_DIST: dist });
  db = createDb();
  server = createApp(db, { config: cfg, rateLimits: { auth: { windowMs: 60000, max: 3 }, register: { windowMs: 60000, max: 2 } } }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('CORS: only the configured origin is allowed', async () => {
  const ok = await call('/api/health', 'GET', null, null, { origin: 'https://placement.example.edu' });
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://placement.example.edu');
  const bad = await call('/api/health', 'GET', null, null, { origin: 'https://evil.example' });
  assert.strictEqual(bad.headers.get('access-control-allow-origin'), null);
  const dev = await call('/api/health', 'GET', null, null, { origin: 'http://localhost:5173' });
  assert.strictEqual(dev.headers.get('access-control-allow-origin'), null);
  const none = await call('/api/health');
  assert.strictEqual(none.status, 200);
});

test('security headers present and x-powered-by hidden', async () => {
  const r = await call('/api/health');
  assert.ok(r.headers.get('x-content-type-options'));
  assert.strictEqual(r.headers.get('x-powered-by'), null);
});

test('static: serves index and assets, SPA fallback for client routes', async () => {
  const idx = await call('/');
  assert.strictEqual(idx.status, 200);
  assert.match(await idx.text(), /IntelliPlace app/);
  assert.strictEqual((await call('/assets/app.js')).status, 200);
  const spa = await call('/student/drives');
  assert.strictEqual(spa.status, 200);
  assert.match(await spa.text(), /IntelliPlace app/);
  assert.match(spa.headers.get('cache-control'), /no-cache/);
});

test('static: unknown API paths return JSON 404, never the app', async () => {
  for (const p of ['/api/nope', '/api/deep/unknown/path', '/api']) {
    const r = await call(p);
    assert.strictEqual(r.status, 404, p);
    assert.deepStrictEqual(await r.json(), { error: 'Not found' });
  }
  assert.strictEqual((await call('/api/nope', 'POST', {})).status, 404);
});

test('static: files outside dist cannot be read', async () => {
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt']) {
    const r = await call(p);
    const t = await r.text();
    assert.ok(!t.includes('top secret'), p);
  }
});

test('non-GET requests to client routes are not served the app', async () => {
  const r = await call('/student/drives', 'POST', {});
  assert.strictEqual(r.status, 404);
});

test('without a built client, non-API paths are a JSON 404', async () => {
  const d2 = createDb();
  const s2 = createApp(d2, { config: loadConfig({ CLIENT_DIST: path.join(tmp, 'missing') }) }).listen(0);
  await new Promise(r => s2.once('listening', r));
  const r = await fetch(`http://127.0.0.1:${s2.address().port}/anything`);
  assert.strictEqual(r.status, 404);
  assert.deepStrictEqual(await r.json(), { error: 'Not found' });
  s2.close();
});

test('login is rate limited per IP, with Retry-After, and other routes are unaffected', async () => {
  const body = { email: 'nobody@t.com', password: 'wrongpass1' };
  for (let i = 0; i < 3; i++) assert.strictEqual((await call('/api/auth/login', 'POST', body)).status, 401);
  const r = await call('/api/auth/login', 'POST', body);
  assert.strictEqual(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  assert.deepStrictEqual(await r.json(), { error: 'Too many requests. Try again later.' });
  assert.strictEqual((await call('/api/health')).status, 200);
  assert.strictEqual((await call('/api/auth/me')).status, 401);
});

test('register has its own, separate limit', async () => {
  const mk = i => call('/api/auth/register', 'POST', { name: 'U' + i, email: `u${i}@t.com`, password: 'password123' });
  assert.strictEqual((await mk(1)).status, 201);
  assert.strictEqual((await mk(2)).status, 201);
  assert.strictEqual((await mk(3)).status, 429);
});

test('the password-change endpoint shares the authentication limit', async () => {
  const r = await call('/api/auth/password', 'POST', { current_password: 'x', new_password: 'y' });
  assert.strictEqual(r.status, 429);
});

test('invalid JSON and oversized bodies get clean errors', async () => {
  const bad = await fetch(base + '/api/drives', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.strictEqual(bad.status, 400);
  assert.deepStrictEqual(await bad.json(), { error: 'Invalid JSON' });
  const big = await fetch(base + '/api/drives', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(200000) }) });
  assert.strictEqual(big.status, 413);
});

test('protected routes require login and never fall through to the app', async () => {
  for (const p of ['/api/student/nope', '/api/drives/nope', '/api/admin/nope']) {
    const r = await call(p);
    assert.ok(r.status === 401 || r.status === 404, p + ' status ' + r.status);
    assert.ok(!(await r.text()).includes('IntelliPlace app'), p);
  }
});