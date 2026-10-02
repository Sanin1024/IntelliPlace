const KEY = 'ip_token';

export const tokenStore = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: t => { try { sessionStorage.setItem(KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ } }
};

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = fn => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, auth = true, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = tokenStore.get();
  if (auth && token) headers.authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'Cannot reach the server');
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    if (res.status === 401 && auth && token) onUnauthorized();
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`, data);
  }
  return raw ? text : data;
}
