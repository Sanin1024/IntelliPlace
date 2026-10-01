import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { AppRoutes } from './App';
import { tokenStore } from './api';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const STUDENT = { id: 1, name: 'Asha', email: 'asha@t.com', role: 'student' };
const COORD = { id: 2, name: 'Coord', email: 'coord@t.com', role: 'coordinator' };
const tokenOf = req => (req.headers.authorization || '').replace('Bearer ', '');
const SESSION = {
  'GET /api/auth/me': req => {
    const t = tokenOf(req);
    return t === 'tok-student' ? [200, STUDENT] : t === 'tok-coordinator' ? [200, COORD] : [401, { error: 'Invalid or expired session' }];
  },
  'POST /api/auth/logout': [200, { ok: true }],
  'GET /api/analytics/cohort': [200, { students: 1, assessed: 0, readiness: { average_score: null, bands: { ready: 0 } } }]
};
const AV = 'GET /api/drives/available';
const el = id => `GET /api/drives/${id}/eligibility`;
const ap = id => `POST /api/drives/${id}/apply`;
const base = { description: null, min_cgpa: null, allowed_departments: [], min_year: null, max_year: null, required_level: null, required_skills: [], deadline: '2026-12-01T00:00:00.000Z' };
const D1 = { ...base, id: 1, company: 'Acme', role: 'SDE', description: 'Build things', status: 'open', eligible: true, failed_count: 0, applied: false };
const D2 = { ...base, id: 2, company: 'Globex', role: 'Analyst', status: 'open', eligible: false, failed_count: 2, applied: false };
const D3 = { ...base, id: 3, company: 'Initech', role: 'Tester', status: 'closed', eligible: false, failed_count: 1, applied: false };
const D4 = { ...base, id: 4, company: 'Hooli', role: 'Intern', status: 'open', eligible: true, failed_count: 0, applied: true };
const OPEN = { rule: 'drive_open', passed: true, message: 'Applications are open', source: 'system' };
const OK_RULES = [OPEN,
  { rule: 'cgpa', passed: true, message: 'Your CGPA 8 meets the minimum 7.5', source: 'self_reported' },
  { rule: 'level', passed: true, message: 'Your verified level Advanced meets the required Intermediate', source: 'system_verified' }];
const BAD_RULES = [OPEN,
  { rule: 'cgpa', passed: false, message: 'Your CGPA 6.9 is below the minimum 7.5', source: 'self_reported' },
  { rule: 'level', passed: false, message: 'Complete the initial assessment; the required level is Intermediate', source: 'system_verified' }];
const CLOSED_RULES = [{ rule: 'drive_open', passed: false, message: 'Applications for this drive are closed', source: 'system' }];

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
const view = (path = '/student/drives') => render(<MemoryRouter initialEntries={[path]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
const login = () => tokenStore.set('tok-student');
const count = (calls, key) => calls.filter(c => c.key === key).length;
const card = name => screen.findByRole('article', { name });
const showDetails = (user, c) => user.click(within(c).getByRole('button', { name: 'Show details' }));

test('lists drives with status badges and deadlines', async () => {
  login();
  server({ ...SESSION, [AV]: [200, [D1, D2, D3, D4]] });
  view();
  const a = await card('Acme - SDE');
  expect(within(a).getByText('Eligible')).toBeInTheDocument();
  expect(within(a).getByText('Deadline: 2026-12-01')).toBeInTheDocument();
  expect(within(a).getByText('Build things')).toBeInTheDocument();
  expect(within(await card('Globex - Analyst')).getByText('Not eligible (2)')).toBeInTheDocument();
  expect(within(await card('Initech - Tester')).getByText('Closed')).toBeInTheDocument();
  expect(within(await card('Hooli - Intern')).getByText('Applied')).toBeInTheDocument();
});

test('an empty list shows a message', async () => {
  login();
  server({ ...SESSION, [AV]: [200, []] });
  view();
  expect(await screen.findByText('No drives are available right now.')).toBeInTheDocument();
});

test('a load error is shown', async () => {
  login();
  server({ ...SESSION, [AV]: [500, { error: 'Server error' }] });
  view();
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
});

test('details load lazily once and explain every rule with its source', async () => {
  login();
  const calls = server({ ...SESSION, [AV]: [200, [D2]], [el(2)]: [200, { drive_id: 2, eligible: false, rules: BAD_RULES }] });
  view();
  const c = await card('Globex - Analyst');
  expect(count(calls, el(2))).toBe(0);
  const user = userEvent.setup();
  await showDetails(user, c);
  expect(await within(c).findByText('Your CGPA 6.9 is below the minimum 7.5')).toBeInTheDocument();
  expect(within(c).getAllByText('Not met')).toHaveLength(2);
  expect(within(c).getByText('Met')).toBeInTheDocument();
  expect(within(c).getAllByText('Verified by system')).toHaveLength(2);
  expect(within(c).getAllByText('Self-reported')).toHaveLength(1);
  expect(within(c).getByRole('link', { name: 'Update your profile' })).toHaveAttribute('href', '/student/profile');
  expect(within(c).queryByRole('button', { name: 'Apply' })).toBeNull();
  await user.click(within(c).getByRole('button', { name: 'Hide details' }));
  expect(within(c).queryByText('Met')).toBeNull();
  await showDetails(user, c);
  expect(await within(c).findByText('Your CGPA 6.9 is below the minimum 7.5')).toBeInTheDocument();
  expect(count(calls, el(2))).toBe(1);
});

test('an eligible drive can be applied to and then shows as applied', async () => {
  login();
  const calls = server({ ...SESSION, [AV]: [200, [D1]], [el(1)]: [200, { drive_id: 1, eligible: true, rules: OK_RULES }], [ap(1)]: [201, { applied: true, application_id: 9 }] });
  view();
  const c = await card('Acme - SDE');
  const user = userEvent.setup();
  await showDetails(user, c);
  const btn = await within(c).findByRole('button', { name: 'Apply' });
  expect(within(c).queryByRole('link', { name: 'Update your profile' })).toBeNull();
  await user.click(btn);
  expect(await within(c).findByText('Applied')).toBeInTheDocument();
  expect(within(c).queryByRole('button', { name: 'Apply' })).toBeNull();
  expect(count(calls, ap(1))).toBe(1);
  expect(calls.find(x => x.key === ap(1)).headers.authorization).toBe('Bearer tok-student');
});

test('when the server rejects an apply, its rules are shown and the drive becomes not eligible', async () => {
  login();
  server({ ...SESSION, [AV]: [200, [D1]], [el(1)]: [200, { drive_id: 1, eligible: true, rules: OK_RULES }],
    [ap(1)]: [403, { error: 'Not eligible', drive_id: 1, eligible: false, rules: BAD_RULES }] });
  view();
  const c = await card('Acme - SDE');
  const user = userEvent.setup();
  await showDetails(user, c);
  await user.click(await within(c).findByRole('button', { name: 'Apply' }));
  expect(await within(c).findByRole('alert')).toHaveTextContent('Not eligible');
  expect(within(c).getByText('Your CGPA 6.9 is below the minimum 7.5')).toBeInTheDocument();
  expect(within(c).getByText('Not eligible (2)')).toBeInTheDocument();
  expect(within(c).queryByRole('button', { name: 'Apply' })).toBeNull();
});

test('an already-applied response just marks the drive as applied', async () => {
  login();
  server({ ...SESSION, [AV]: [200, [D1]], [el(1)]: [200, { drive_id: 1, eligible: true, rules: OK_RULES }], [ap(1)]: [409, { error: 'Already applied' }] });
  view();
  const c = await card('Acme - SDE');
  const user = userEvent.setup();
  await showDetails(user, c);
  await user.click(await within(c).findByRole('button', { name: 'Apply' }));
  expect(await within(c).findByText('Applied')).toBeInTheDocument();
  expect(within(c).queryByRole('alert')).toBeNull();
});

test('applied and closed drives offer no Apply button', async () => {
  login();
  server({ ...SESSION, [AV]: [200, [D3, D4]], [el(3)]: [200, { drive_id: 3, eligible: false, rules: CLOSED_RULES }], [el(4)]: [200, { drive_id: 4, eligible: true, rules: OK_RULES }] });
  view();
  const closed = await card('Initech - Tester');
  const applied = await card('Hooli - Intern');
  const user = userEvent.setup();
  await showDetails(user, closed);
  expect(await within(closed).findByText('Applications for this drive are closed')).toBeInTheDocument();
  expect(within(closed).getByText('Not met')).toBeInTheDocument();
  expect(within(closed).queryByRole('button', { name: 'Apply' })).toBeNull();
  expect(within(closed).queryByRole('link', { name: 'Update your profile' })).toBeNull();
  await showDetails(user, applied);
  expect(await within(applied).findByText('Applications are open')).toBeInTheDocument();
  expect(within(applied).queryByRole('button', { name: 'Apply' })).toBeNull();
});

test('an eligibility lookup error is shown in the card', async () => {
  login();
  server({ ...SESSION, [AV]: [200, [D2]], [el(2)]: [500, { error: 'Server error' }] });
  view();
  const c = await card('Globex - Analyst');
  await showDetails(userEvent.setup(), c);
  expect(await within(c).findByRole('alert')).toHaveTextContent('Server error');
});

test('drive text from the server is rendered as text, never as markup', async () => {
  login();
  const evil = '<img src=x onerror=alert(1)>';
  server({ ...SESSION, [AV]: [200, [{ ...D1, company: evil, description: '<b>bold</b>' }]] });
  view();
  expect(await screen.findByText(evil, { exact: false })).toBeInTheDocument();
  expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('article b')).toBeNull();
});

test('drives and profile pages are student-only', async () => {
  tokenStore.set('tok-coordinator');
  server(SESSION);
  view('/student/drives');
  expect(await screen.findByRole('heading', { name: 'Coordinator dashboard' })).toBeInTheDocument();
  cleanup();
  view('/student/profile');
  expect(await screen.findByRole('heading', { name: 'Coordinator dashboard' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Drives' })).toBeNull();
});

test('students get Drives and Profile links', async () => {
  login();
  server({ ...SESSION, [AV]: [200, []] });
  view();
  await screen.findByRole('heading', { name: 'Placement drives' });
  expect(screen.getByRole('link', { name: 'Drives' })).toHaveAttribute('href', '/student/drives');
  expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/student/profile');
});
