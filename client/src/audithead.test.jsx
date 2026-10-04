import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { AppRoutes } from './App';
import { tokenStore } from './api';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const ADMIN = { id: 3, name: 'Root', email: 'root@t.com', role: 'admin' };
const HASH = 'a'.repeat(64);
const BASE = {
  'GET /api/auth/me': [200, ADMIN],
  'POST /api/auth/logout': [200, { ok: true }],
  'GET /api/admin/audit/verify': [200, { valid: true, count: 12, head: HASH }],
  'GET /api/admin/audit?limit=50': [200, []]
};
const HEAD = 'GET /api/admin/audit/head';
const CHECK = 'POST /api/admin/audit/check-head';

function server(routes) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const call = { key: `${opts.method || 'GET'} ${url}`, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers || {} };
    calls.push(call);
    const h = routes[call.key];
    if (!h) return reply(404, { error: 'Not found' });
    const [status, body] = typeof h === 'function' ? h(call) : h;
    return reply(status, body);
  }));
  return calls;
}
const view = () => render(<MemoryRouter initialEntries={['/admin/audit']}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
const ready = () => screen.findByText('Audit chain valid: 12 entries verified');
const upload = text => {
  const input = screen.getByLabelText('Check against a saved head');
  const file = new File([text], 'head.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => { tokenStore.set('tok-admin'); });

test('exporting the head downloads a file and tells the admin to store it separately', async () => {
  const calls = server({ ...BASE, [HEAD]: [200, { count: 12, head: HASH, ts: 1700000000000 }] });
  URL.createObjectURL = vi.fn(() => 'blob:head');
  URL.revokeObjectURL = vi.fn();
  const clicks = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { clicks.push({ href: this.href, download: this.download }); };
  try {
    view();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Export head' }));
    expect(await screen.findByText(/Saved audit head for 12 entries/)).toBeInTheDocument();
    expect(clicks).toEqual([{ href: 'blob:head', download: 'audit-head-12.json' }]);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(JSON.parse(await blob.text())).toEqual({ count: 12, head: HASH, ts: 1700000000000 });
    expect(calls.find(c => c.key === HEAD).headers.authorization).toBe('Bearer tok-admin');
  } finally {
    HTMLAnchorElement.prototype.click = orig;
  }
});

test('an export failure is shown', async () => {
  server({ ...BASE, [HEAD]: [500, { error: 'Server error' }] });
  view();
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Export head' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
});

test('checking a matching saved head reports consistency', async () => {
  const calls = server({ ...BASE, [CHECK]: [200, { result: 'matches', message: 'The log is consistent with your saved head. 3 entries were added since.' }] });
  view();
  await ready();
  upload(JSON.stringify({ count: 9, head: HASH, ts: 1 }));
  expect(await screen.findByText('Consistent: The log is consistent with your saved head. 3 entries were added since.')).toBeInTheDocument();
  expect(calls.find(c => c.key === CHECK).body).toEqual({ count: 9, head: HASH });
});

test('a truncated log is reported as an alert', async () => {
  server({ ...BASE, [CHECK]: [200, { result: 'truncated', message: 'Your saved head had 12 entries but the log now has 9. Entries were removed from the end.' }] });
  view();
  await ready();
  upload(JSON.stringify({ count: 12, head: HASH }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Truncated: Your saved head had 12 entries but the log now has 9.');
});

test('a diverged log is reported as an alert', async () => {
  server({ ...BASE, [CHECK]: [200, { result: 'diverged', message: 'The log was changed or rebuilt.' }] });
  view();
  await ready();
  upload(JSON.stringify({ count: 12, head: HASH }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Diverged: The log was changed or rebuilt.');
});

test('a file that is not JSON is rejected without calling the server', async () => {
  const calls = server(BASE);
  view();
  await ready();
  upload('this is not json');
  expect(await screen.findByRole('alert')).toHaveTextContent('That file is not a valid saved audit head.');
  expect(calls.some(c => c.key === CHECK)).toBe(false);
});

test('a server rejection of the saved head is shown', async () => {
  server({ ...BASE, [CHECK]: [400, { error: 'A saved head needs an integer count and a 64-character hex head' }] });
  view();
  await ready();
  upload(JSON.stringify({ count: 'x', head: 'y' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A saved head needs an integer count and a 64-character hex head');
});

test('the audit explanation tells the admin why the head matters', async () => {
  server(BASE);
  view();
  await ready();
  await waitFor(() => expect(screen.getByText(/cannot show that the newest entries were deleted/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Verify again' })).toBeInTheDocument();
});
