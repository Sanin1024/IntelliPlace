const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

let server, base;
test.before(async () => {
  server = createApp(createDb()).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('GET /api/health returns ok', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.status, 'ok');
  assert.strictEqual(body.db, 'ok');
});

test('unknown route returns JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(await res.json(), { error: 'Not found' });
});

test('security headers present', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.ok(res.headers.get('x-content-type-options'));
});

test('migrations table exists', () => {
  const t = createDb().prepare("select name from sqlite_master where name='schema_migrations'").get();
  assert.ok(t);
});
