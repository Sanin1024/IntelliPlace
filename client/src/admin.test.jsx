import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { AppRoutes } from './App';
import { tokenStore } from './api';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const STUDENT = { id: 1, name: 'Asha', email: 'asha@t.com', role: 'student' };
const COORD = { id: 2, name: 'Coord', email: 'coord@t.com', role: 'coordinator' };
const ADMIN = { id: 3, name: 'Root', email: 'root@t.com', role: 'admin' };
const BY = { 'tok-student': STUDENT, 'tok-coordinator': COORD, 'tok-admin': ADMIN };
const tokenOf = req => (req.headers.authorization || '').replace('Bearer ', '');
const SESSION = {
  'GET /api/auth/me': req => { const u = BY[tokenOf(req)]; return u ? [200, u] : [401, { error: 'Invalid or expired session' }]; },
  'POST /api/auth/logout': [200, { ok: true }],
  'GET /api/analytics/me': [200, { verified: { level: null, readiness: { score: null, band: 'no_data' }, weak_categories: [] } }],
  'GET /api/analytics/cohort': [200, { students: 1, assessed: 0, readiness: { average_score: null, bands: { ready: 0 } } }],
  'GET /api/admin/users?limit=200': [200, []]
};
const UL = 'GET /api/admin/users?limit=200';
const u = (id, name, email, role, disabled = false, locked = false) => ({ id, name, email, role, created_at: '2026-01-01 00:00:00', disabled, locked });
const U_ROOT = u(3, 'Root', 'root@t.com', 'admin');
const U_COORD = u(2, 'Coord', 'coord@t.com', 'coordinator');
const U_BOB = u(4, 'Bob', 'bob@t.com', 'student', true, false);
const U_CY = u(5, 'Cy', 'cy@t.com', 'student', false, true);
const ALL = [U_ROOT, U_COORD, U_BOB, U_CY];
const act = (id, p) => `POST /api/admin/users/${id}/${p}`;

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
const view = path => render(<MemoryRouter initialEntries={[path]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
const login = role => tokenStore.set('tok-' + role);
const count = (calls, key) => calls.filter(c => c.key === key).length;
const heading = name => screen.findByRole('heading', { name });
const row = email => screen.getByRole('row', { name: new RegExp(email.replace('.', '\\.')) });
const set = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create staff account' }));
const usersPage = async routes => {
  login('admin');
  const calls = server({ ...SESSION, [UL]: [200, ALL], ...routes });
  view('/admin/users');
  await screen.findByRole('row', { name: /root@t\.com/ });
  return calls;
};

test('lists accounts with status and hides self-destructive actions', async () => {
  await usersPage({});
  const root = row('root@t.com');
  expect(within(root).getByText('admin')).toBeInTheDocument();
  expect(within(root).getByText('Active')).toBeInTheDocument();
  expect(within(root).getByText('(you)')).toBeInTheDocument();
  expect(within(root).queryByRole('button')).toBeNull();
  const coord = row('coord@t.com');
  expect(within(coord).getByRole('button', { name: 'Disable coord@t.com' })).toBeInTheDocument();
  expect(within(coord).getByRole('button', { name: 'Reset password for coord@t.com' })).toBeInTheDocument();
  expect(within(coord).queryByRole('button', { name: /Enable|Unlock/ })).toBeNull();
  const bob = row('bob@t.com');
  expect(within(bob).getByText('Disabled')).toBeInTheDocument();
  expect(within(bob).getByRole('button', { name: 'Enable bob@t.com' })).toBeInTheDocument();
  expect(within(bob).queryByRole('button', { name: 'Disable bob@t.com' })).toBeNull();
  const cy = row('cy@t.com');
  expect(within(cy).getByText('Locked')).toBeInTheDocument();
  expect(within(cy).getByRole('button', { name: 'Unlock cy@t.com' })).toBeInTheDocument();
  expect(within(cy).getByRole('button', { name: 'Disable cy@t.com' })).toBeInTheDocument();
});

test('disabling an account updates its row', async () => {
  const calls = await usersPage({ [act(2, 'disable')]: [200, { ...U_COORD, disabled: true }] });
  const coord = row('coord@t.com');
  await userEvent.setup().click(within(coord).getByRole('button', { name: 'Disable coord@t.com' }));
  expect(await within(coord).findByText('Disabled')).toBeInTheDocument();
  expect(within(coord).getByRole('button', { name: 'Enable coord@t.com' })).toBeInTheDocument();
  expect(count(calls, act(2, 'disable'))).toBe(1);
  expect(calls.find(c => c.key === act(2, 'disable')).headers.authorization).toBe('Bearer tok-admin');
});

test('enabling and unlocking update their rows', async () => {
  await usersPage({ [act(4, 'enable')]: [200, { ...U_BOB, disabled: false }], [act(5, 'unlock')]: [200, { ...U_CY, locked: false }] });
  const user = userEvent.setup();
  const bob = row('bob@t.com');
  await user.click(within(bob).getByRole('button', { name: 'Enable bob@t.com' }));
  expect(await within(bob).findByText('Active')).toBeInTheDocument();
  expect(within(bob).getByRole('button', { name: 'Disable bob@t.com' })).toBeInTheDocument();
  const cy = row('cy@t.com');
  await user.click(within(cy).getByRole('button', { name: 'Unlock cy@t.com' }));
  expect(await within(cy).findByText('Active')).toBeInTheDocument();
  expect(within(cy).queryByRole('button', { name: 'Unlock cy@t.com' })).toBeNull();
});

test('password reset validates, sends and confirms', async () => {
  const calls = await usersPage({ [act(2, 'reset-password')]: [200, U_COORD] });
  const user = userEvent.setup();
  const coord = row('coord@t.com');
  await user.click(within(coord).getByRole('button', { name: 'Reset password for coord@t.com' }));
  await user.click(within(coord).getByRole('button', { name: 'Cancel' }));
  expect(within(coord).queryByLabelText('New password for coord@t.com')).toBeNull();
  expect(count(calls, act(2, 'reset-password'))).toBe(0);
  await user.click(within(coord).getByRole('button', { name: 'Reset password for coord@t.com' }));
  fireEvent.change(within(coord).getByLabelText('New password for coord@t.com'), { target: { value: 'short' } });
  await user.click(within(coord).getByRole('button', { name: 'Set password for coord@t.com' }));
  expect(within(coord).getByText('Password must be 8-128 characters')).toBeInTheDocument();
  expect(count(calls, act(2, 'reset-password'))).toBe(0);
  fireEvent.change(within(coord).getByLabelText('New password for coord@t.com'), { target: { value: 'tempPass789' } });
  await user.click(within(coord).getByRole('button', { name: 'Set password for coord@t.com' }));
  expect(await screen.findByText('Password reset for coord@t.com. Their sessions were ended.')).toBeInTheDocument();
  expect(calls.find(c => c.key === act(2, 'reset-password')).body).toEqual({ password: 'tempPass789' });
  expect(within(coord).queryByLabelText('New password for coord@t.com')).toBeNull();
});

test('a failed action shows the server error on that row', async () => {
  await usersPage({ [act(2, 'disable')]: [500, { error: 'Server error' }] });
  const coord = row('coord@t.com');
  await userEvent.setup().click(within(coord).getByRole('button', { name: 'Disable coord@t.com' }));
  expect(await within(coord).findByRole('alert')).toHaveTextContent('Server error');
  expect(within(coord).getByText('Active')).toBeInTheDocument();
});

test('creating a staff account sends the form and adds the row', async () => {
  const calls = await usersPage({ 'POST /api/admin/users': [201, { id: 9, name: 'New Admin', email: 'newadmin@t.com', role: 'admin' }] });
  set('Name', 'New Admin'); set('Email', ' newadmin@t.com '); set('Role', 'admin'); set('Temporary password', 'tempPass789');
  create();
  expect(await screen.findByText('Created newadmin@t.com')).toBeInTheDocument();
  expect(calls.find(c => c.key === 'POST /api/admin/users').body).toEqual({ name: 'New Admin', email: 'newadmin@t.com', role: 'admin', password: 'tempPass789' });
  const created = await screen.findByRole('row', { name: /newadmin@t\.com/ });
  expect(within(created).getByText('Active')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toHaveValue('');
});

test('the staff form validates locally and shows server rejections', async () => {
  const calls = await usersPage({ 'POST /api/admin/users': [409, { error: 'Email already registered' }] });
  create();
  expect(screen.getByText('Name and email are required')).toBeInTheDocument();
  set('Name', 'N'); set('Email', 'nope'); create();
  expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
  set('Email', 'n@t.com'); set('Temporary password', 'short'); create();
  expect(screen.getByText('Password must be 8-128 characters')).toBeInTheDocument();
  expect(count(calls, 'POST /api/admin/users')).toBe(0);
  set('Temporary password', 'tempPass789'); create();
  expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered');
  expect(screen.queryByText(/^Created /)).toBeNull();
});

test('account text is rendered as text, never as markup', async () => {
  login('admin');
  const evil = '<img src=x onerror=alert(1)>';
  server({ ...SESSION, [UL]: [200, [U_ROOT, { ...U_COORD, name: evil }]] });
  view('/admin/users');
  expect(await screen.findByText(evil, { exact: false })).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});

test('admin pages are admin-only', async () => {
  login('coordinator');
  server(SESSION);
  view('/admin/users');
  expect(await heading('Coordinator dashboard')).toBeInTheDocument();
  cleanup();
  view('/admin/audit');
  expect(await heading('Coordinator dashboard')).toBeInTheDocument();
  cleanup();
  login('student');
  view('/admin/users');
  expect(await heading('Student dashboard')).toBeInTheDocument();
});

test('admin navigation', async () => {
  login('admin');
  server(SESSION);
  view('/admin');
  await heading('Administration');
  for (const n of ['Dashboard', 'Users', 'Audit log']) expect(screen.getByRole('link', { name: n })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/admin/users');
  expect(screen.getByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '/admin/audit');
  cleanup();
  login('student');
  view('/student');
  await heading('Student dashboard');
  expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull();
});

const VER = 'GET /api/admin/audit/verify';
const AU = 'GET /api/admin/audit?limit=50';
const AROWS = [
  { id: 2, ts: 1700000100000, actor_id: 3, action: 'drive.create', entity: 'drive', entity_id: '1', details: { company: 'Acme' }, hash: 'h2' },
  { id: 1, ts: 1700000000000, actor_id: null, action: 'admin.bootstrap', entity: 'user', entity_id: '3', details: null, hash: 'h1' }
];

test('audit log shows chain validity and the newest entries', async () => {
  login('admin');
  server({ ...SESSION, [VER]: [200, { valid: true, count: 12, head: 'x' }], [AU]: [200, AROWS] });
  view('/admin/audit');
  expect(await screen.findByText('Audit chain valid: 12 entries verified')).toBeInTheDocument();
  const a = await screen.findByRole('row', { name: /drive\.create/ });
  expect(within(a).getByText('2023-11-14T22:15:00.000Z')).toBeInTheDocument();
  expect(within(a).getByText('3')).toBeInTheDocument();
  expect(within(a).getByText('drive 1')).toBeInTheDocument();
  expect(within(a).getByText('{"company":"Acme"}')).toBeInTheDocument();
  const b = screen.getByRole('row', { name: /admin\.bootstrap/ });
  expect(within(b).getByText('system')).toBeInTheDocument();
  expect(within(b).getByText('user 3')).toBeInTheDocument();
});

test('a broken audit chain is reported as an alert', async () => {
  login('admin');
  server({ ...SESSION, [VER]: [200, { valid: false, count: 3, broken_at: 4, reason: 'hash_mismatch' }], [AU]: [200, AROWS] });
  view('/admin/audit');
  expect(await screen.findByRole('alert')).toHaveTextContent('Audit chain broken at entry 4 (hash_mismatch)');
  expect(screen.queryByText(/^Audit chain valid/)).toBeNull();
});

test('verify again re-checks the chain', async () => {
  login('admin');
  let n = 0;
  const calls = server({ ...SESSION, [AU]: [200, AROWS],
    [VER]: () => (n++ === 0 ? [200, { valid: true, count: 2 }] : [200, { valid: false, count: 2, broken_at: 2, reason: 'chain_break' }]) });
  view('/admin/audit');
  expect(await screen.findByText('Audit chain valid: 2 entries verified')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Verify again' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Audit chain broken at entry 2 (chain_break)');
  expect(count(calls, VER)).toBe(2);
});

test('the audit log load error is shown', async () => {
  login('admin');
  server({ ...SESSION, [VER]: [200, { valid: true, count: 2 }], [AU]: [500, { error: 'Server error' }] });
  view('/admin/audit');
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  expect(screen.getByText('Audit chain valid: 2 entries verified')).toBeInTheDocument();
});
