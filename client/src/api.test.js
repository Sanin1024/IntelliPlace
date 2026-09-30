const reply = (status, body, raw) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => raw ?? (body === undefined ? '' : JSON.stringify(body))
});
import { api, ApiError, tokenStore, setUnauthorizedHandler } from './api';

let handler;
const stub = r => { const f = vi.fn(async () => r); vi.stubGlobal('fetch', f); return f; };
beforeEach(() => { sessionStorage.clear(); handler = vi.fn(); setUnauthorizedHandler(handler); });

test('tokenStore stores, reads and clears the token', () => {
  expect(tokenStore.get()).toBeNull();
  tokenStore.set('abc');
  expect(tokenStore.get()).toBe('abc');
  tokenStore.clear();
  expect(tokenStore.get()).toBeNull();
});

test('sends JSON body and bearer token to /api paths', async () => {
  tokenStore.set('abc');
  const f = stub(reply(200, { ok: true }));
  expect(await api('/x', { method: 'POST', body: { a: 1 } })).toEqual({ ok: true });
  const [url, opts] = f.mock.calls[0];
  expect(url).toBe('/api/x');
  expect(opts.method).toBe('POST');
  expect(opts.headers.authorization).toBe('Bearer abc');
  expect(opts.headers['content-type']).toBe('application/json');
  expect(JSON.parse(opts.body)).toEqual({ a: 1 });
});

test('without a token there is no auth header, and GET has no body or content type', async () => {
  const f = stub(reply(200, {}));
  await api('/x');
  const opts = f.mock.calls[0][1];
  expect(opts.method).toBe('GET');
  expect(opts.headers.authorization).toBeUndefined();
  expect(opts.headers['content-type']).toBeUndefined();
  expect(opts.body).toBeUndefined();
});

test('auth:false never sends the token', async () => {
  tokenStore.set('abc');
  const f = stub(reply(200, {}));
  await api('/auth/login', { method: 'POST', body: {}, auth: false });
  expect(f.mock.calls[0][1].headers.authorization).toBeUndefined();
});

test('error responses throw ApiError with the server message and status', async () => {
  stub(reply(409, { error: 'Email already registered' }));
  const err = await api('/x').catch(e => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(409);
  expect(err.message).toBe('Email already registered');
  expect(err.body).toEqual({ error: 'Email already registered' });
});

test('401 calls the unauthorized handler only for authenticated requests', async () => {
  stub(reply(401, { error: 'Invalid or expired session' }));
  tokenStore.set('t');
  await expect(api('/me')).rejects.toMatchObject({ status: 401, message: 'Invalid or expired session' });
  expect(handler).toHaveBeenCalledTimes(1);
  await expect(api('/me', { auth: false })).rejects.toBeInstanceOf(ApiError);
  expect(handler).toHaveBeenCalledTimes(1);
  tokenStore.clear();
  await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
  expect(handler).toHaveBeenCalledTimes(1);
});

test('network failure becomes ApiError with status 0', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));
  await expect(api('/x')).rejects.toMatchObject({ status: 0, message: 'Cannot reach the server' });
  expect(handler).not.toHaveBeenCalled();
});

test('non-JSON error body gives a generic message; empty success body returns null', async () => {
  stub(reply(502, undefined, '<html>Bad gateway</html>'));
  await expect(api('/x')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  stub(reply(204, undefined));
  expect(await api('/x')).toBeNull();
});
