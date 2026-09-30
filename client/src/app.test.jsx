import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { AppRoutes } from './App';
import { tokenStore } from './api';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

const STUDENT = { id: 1, name: 'Asha', email: 'asha@t.com', role: 'student' };
const COORD = { id: 2, name: 'Coord', email: 'coord@t.com', role: 'coordinator' };
const ADMIN = { id: 3, name: 'Root', email: 'root@t.com', role: 'admin' };
const BY_TOKEN = { 'tok-student': STUDENT, 'tok-coordinator': COORD, 'tok-admin': ADMIN };
const ANALYTICS = { verified: { level: 'Intermediate', readiness: { score: 64, band: 'developing', confidence: 'high' }, weak_categories: ['programming'] } };
const COHORT = { students: 6, assessed: 5, readiness: { average_score: 66.8, bands: { ready: 2, developing: 2, not_ready: 1, no_data: 1 } } };
const USERS = [
  { id: 1, role: 'admin', disabled: false }, { id: 2, role: 'coordinator', disabled: false },
  { id: 3, role: 'student', disabled: true }, { id: 4, role: 'admin', disabled: false }
];

const tokenOf = req => (req.headers.authorization || '').replace('Bearer ', '');
const authed = body => req => (BY_TOKEN[tokenOf(req)] ? [200, body] : [401, { error: 'Invalid or expired session' }]);
const loginAs = user => req => (req.body.password === 'password123'
  ? [200, { token: 'tok-' + user.role, user }] : [401, { error: 'Invalid credentials' }]);
const SESSION = {
  'GET /api/auth/me': req => { const u = BY_TOKEN[tokenOf(req)]; return u ? [200, u] : [401, { error: 'Invalid or expired session' }]; },
  'POST /api/auth/logout': [200, { ok: true }],
  'GET /api/analytics/me': authed(ANALYTICS),
  'GET /api/analytics/cohort': authed(COHORT),
  'GET /api/admin/users?limit=200': authed(USERS)
};

function server(routes) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const call = { key: `${opts.method || 'GET'} ${url}`, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : undefined };
    calls.push(call);
    const h = routes[call.key];
    if (!h) return reply(404, { error: 'Not found' });
    const [status, body] = typeof h === 'function' ? h(call) : h;
    return reply(status, body);
  }));
  return calls;
}
const count = (calls, key) => calls.filter(c => c.key === key).length;
const view = (path = '/') => render(
  <MemoryRouter initialEntries={[path]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>
);
const heading = name => screen.findByRole('heading', { name });
const alertText = async text => expect(await screen.findByRole('alert')).toHaveTextContent(text);

test('anonymous users are sent to sign in and nothing is requested', async () => {
  server({});
  for (const p of ['/', '/student', '/coordinator', '/admin', '/nowhere']) {
    view(p);
    expect(await heading('Sign in')).toBeInTheDocument();
    cleanup();
  }
  expect(fetch).not.toHaveBeenCalled();
});

test('student signs in and sees verified results from the server', async () => {
  const calls = server({ 'POST /api/auth/login': loginAs(STUDENT), 'GET /api/analytics/me': authed(ANALYTICS) });
  view('/login');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'asha@t.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await heading('Student dashboard')).toBeInTheDocument();
  expect(await screen.findByText('Intermediate')).toBeInTheDocument();
  expect(screen.getByText('64')).toBeInTheDocument();
  expect(screen.getByText('developing')).toBeInTheDocument();
  expect(screen.getByText('programming')).toBeInTheDocument();
  expect(tokenStore.get()).toBe('tok-student');
  const login = calls.find(c => c.key === 'POST /api/auth/login');
  expect(login.body).toEqual({ email: 'asha@t.com', password: 'password123' });
  expect(login.headers.authorization).toBeUndefined();
});

test('wrong credentials show the server error and store nothing', async () => {
  server({ 'POST /api/auth/login': loginAs(STUDENT) });
  view('/login');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'asha@t.com');
  await user.type(screen.getByLabelText('Password'), 'wrongpass1');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await alertText('Invalid credentials');
  expect(tokenStore.get()).toBeNull();
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
});

test('an empty sign-in form is rejected locally', async () => {
  server({});
  view('/login');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
  await alertText('Email and password are required');
  expect(fetch).not.toHaveBeenCalled();
});

test('registration validates locally before calling the server', async () => {
  server({});
  view('/register');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Name'), 'Asha');
  await user.type(screen.getByLabelText('Email'), 'asha@t.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'different123');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await alertText('Passwords do not match');
  await user.clear(screen.getByLabelText('Password'));
  await user.clear(screen.getByLabelText('Confirm password'));
  await user.type(screen.getByLabelText('Password'), 'short');
  await user.type(screen.getByLabelText('Confirm password'), 'short');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await alertText('Password must be 8-128 characters');
  expect(fetch).not.toHaveBeenCalled();
});

test('registering creates the account, then signs in without leaking the confirm field', async () => {
  const calls = server({
    'POST /api/auth/register': [201, { id: 1, name: 'Asha', email: 'asha@t.com', role: 'student' }],
    'POST /api/auth/login': loginAs(STUDENT),
    'GET /api/analytics/me': authed(ANALYTICS)
  });
  view('/register');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Name'), 'Asha');
  await user.type(screen.getByLabelText('Email'), 'asha@t.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await heading('Student dashboard')).toBeInTheDocument();
  expect(calls.slice(0, 2).map(c => c.key)).toEqual(['POST /api/auth/register', 'POST /api/auth/login']);
  expect(calls[0].body).toEqual({ name: 'Asha', email: 'asha@t.com', password: 'password123' });
});

test('a duplicate email shows the server error and does not attempt a login', async () => {
  const calls = server({ 'POST /api/auth/register': [409, { error: 'Email already registered' }] });
  view('/register');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Name'), 'Asha');
  await user.type(screen.getByLabelText('Email'), 'asha@t.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await alertText('Email already registered');
  expect(count(calls, 'POST /api/auth/login')).toBe(0);
  expect(tokenStore.get()).toBeNull();
});

test.each([
  ['coordinator', '/student', 'Coordinator dashboard'],
  ['student', '/admin', 'Student dashboard'],
  ['admin', '/coordinator', 'Administration'],
  ['student', '/login', 'Student dashboard'],
  ['coordinator', '/', 'Coordinator dashboard']
])('%s visiting %s lands on %s', async (role, path, title) => {
  tokenStore.set('tok-' + role);
  server(SESSION);
  view(path);
  expect(await heading(title)).toBeInTheDocument();
});

test('pages for other roles never request their data', async () => {
  tokenStore.set('tok-coordinator');
  const calls = server(SESSION);
  view('/student');
  await heading('Coordinator dashboard');
  cleanup();
  view('/admin');
  await heading('Coordinator dashboard');
  expect(calls.some(c => c.key === 'GET /api/analytics/me')).toBe(false);
  expect(calls.some(c => c.key.startsWith('GET /api/admin'))).toBe(false);
});

test('a stored token restores the session with one /auth/me call', async () => {
  tokenStore.set('tok-coordinator');
  const calls = server(SESSION);
  view('/');
  expect(await heading('Coordinator dashboard')).toBeInTheDocument();
  expect(count(calls, 'GET /api/auth/me')).toBe(1);
  expect(calls.find(c => c.key === 'GET /api/auth/me').headers.authorization).toBe('Bearer tok-coordinator');
});

test('a stale stored token is cleared and the user is sent to sign in', async () => {
  tokenStore.set('stale');
  server(SESSION);
  view('/student');
  expect(await heading('Sign in')).toBeInTheDocument();
  expect(tokenStore.get()).toBeNull();
});

test('sign out ends the session on the server and locally', async () => {
  tokenStore.set('tok-student');
  const calls = server(SESSION);
  view('/student');
  await heading('Student dashboard');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await heading('Sign in')).toBeInTheDocument();
  expect(tokenStore.get()).toBeNull();
  const out = calls.find(c => c.key === 'POST /api/auth/logout');
  expect(out.headers.authorization).toBe('Bearer tok-student');
  expect(count(calls, 'POST /api/auth/logout')).toBe(1);
});

test('sign out still works locally when the server is unreachable', async () => {
  tokenStore.set('tok-student');
  server({ ...SESSION, 'POST /api/auth/logout': () => { throw new Error('offline'); } });
  view('/student');
  await heading('Student dashboard');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await heading('Sign in')).toBeInTheDocument();
  expect(tokenStore.get()).toBeNull();
});

test('a session that expires mid-use sends the user back to sign in', async () => {
  tokenStore.set('tok-student');
  server({ ...SESSION, 'GET /api/analytics/me': [401, { error: 'Invalid or expired session' }] });
  view('/student');
  expect(await heading('Sign in')).toBeInTheDocument();
  expect(tokenStore.get()).toBeNull();
});

test('a server error on the dashboard is shown without leaving the page', async () => {
  tokenStore.set('tok-student');
  server({ ...SESSION, 'GET /api/analytics/me': [500, { error: 'Server error' }] });
  view('/student');
  await alertText('Server error');
  expect(screen.getByRole('heading', { name: 'Student dashboard' })).toBeInTheDocument();
  expect(tokenStore.get()).toBe('tok-student');
});

test('server-provided text is rendered as text, never as markup', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  tokenStore.set('tok-student');
  server({ ...SESSION, 'GET /api/auth/me': [200, { ...STUDENT, name: evil }] });
  view('/student');
  expect(await screen.findByText(evil)).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});

test('coordinator dashboard shows the cohort summary', async () => {
  tokenStore.set('tok-coordinator');
  server(SESSION);
  view('/coordinator');
  expect(await screen.findByText('66.8')).toBeInTheDocument();
  expect(screen.getByText('6')).toBeInTheDocument();
  expect(screen.getByText('5')).toBeInTheDocument();
  for (const t of ['ready: 2', 'developing: 2', 'not ready: 1', 'no data: 1']) expect(screen.getByText(t)).toBeInTheDocument();
});

test('admin dashboard shows account counts', async () => {
  tokenStore.set('tok-admin');
  server(SESSION);
  view('/admin');
  expect(await screen.findByText('Total accounts')).toBeInTheDocument();
  expect(await screen.findByText('4')).toBeInTheDocument();
  expect(screen.getByText('1')).toBeInTheDocument();
  for (const t of ['admin: 2', 'coordinator: 1', 'student: 1']) expect(screen.getByText(t)).toBeInTheDocument();
});

test('a student with no graded data sees guidance instead of numbers', async () => {
  tokenStore.set('tok-student');
  server({ ...SESSION, 'GET /api/analytics/me': authed({ verified: { level: null, readiness: { score: null, band: 'no_data' }, weak_categories: [] } }) });
  view('/student');
  expect(await screen.findByText(/not taken the initial assessment/)).toBeInTheDocument();
  expect(screen.getByText('not assessed')).toBeInTheDocument();
  expect(screen.getByText('n/a')).toBeInTheDocument();
  expect(screen.getByText('no data')).toBeInTheDocument();
  expect(screen.getByText('None identified yet.')).toBeInTheDocument();
});
