import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
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
const DR = 'GET /api/drives';
const apps = id => `GET /api/drives/${id}/applications`;
const cl = id => `POST /api/drives/${id}/close`;
const base = { description: null, min_cgpa: null, allowed_departments: [], min_year: null, max_year: null, required_level: null, required_skills: [], deadline: '2026-12-01T00:00:00.000Z' };
const D1 = { ...base, id: 1, company: 'Acme', role: 'SDE', status: 'open', min_cgpa: 7.5, allowed_departments: ['CSE'], min_year: 3, required_level: 'Intermediate', required_skills: ['SQL'], application_count: 2 };
const D2 = { ...base, id: 2, company: 'Globex', role: 'Analyst', status: 'closed', application_count: 0 };

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
const card = name => screen.findByRole('article', { name });
const heading = name => screen.findByRole('heading', { name });
const set = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create drive' }));

test('lists drives with status, deadline, applications and criteria', async () => {
  login('coordinator');
  server({ ...SESSION, [DR]: [200, [D1, D2]] });
  view('/coordinator/drives');
  const a = await card('Acme - SDE');
  expect(within(a).getByText('Status: open')).toBeInTheDocument();
  expect(within(a).getByText('Deadline: 2026-12-01')).toBeInTheDocument();
  expect(within(a).getByText('Applications: 2')).toBeInTheDocument();
  expect(within(a).getByText('Criteria: Minimum CGPA 7.5 | Departments: CSE | Year 3 or above | Level Intermediate or above | Skills: SQL')).toBeInTheDocument();
  expect(within(a).getByRole('button', { name: 'Close drive' })).toBeInTheDocument();
  const g = await card('Globex - Analyst');
  expect(within(g).getByText('Status: closed')).toBeInTheDocument();
  expect(within(g).getByText('Criteria: none')).toBeInTheDocument();
  expect(within(g).queryByRole('button', { name: 'Close drive' })).toBeNull();
});

test('applications load lazily, once, and list each applicant', async () => {
  login('coordinator');
  const line = 'Anu (anu@t.com) - applied 2026-10-01';
  const calls = server({ ...SESSION, [DR]: [200, [D1, D2]],
    [apps(1)]: [200, [{ id: 1, user_id: 5, name: 'Anu', email: 'anu@t.com', applied_at: Date.UTC(2026, 9, 1) }]], [apps(2)]: [200, []] });
  view('/coordinator/drives');
  const a = await card('Acme - SDE');
  expect(count(calls, apps(1))).toBe(0);
  const user = userEvent.setup();
  await user.click(within(a).getByRole('button', { name: 'Show applications' }));
  expect(await within(a).findByText(line)).toBeInTheDocument();
  await user.click(within(a).getByRole('button', { name: 'Hide applications' }));
  expect(within(a).queryByText(line)).toBeNull();
  await user.click(within(a).getByRole('button', { name: 'Show applications' }));
  expect(await within(a).findByText(line)).toBeInTheDocument();
  expect(count(calls, apps(1))).toBe(1);
  const g = await card('Globex - Analyst');
  await user.click(within(g).getByRole('button', { name: 'Show applications' }));
  expect(await within(g).findByText('No applications yet.')).toBeInTheDocument();
});

test('closing needs confirmation and updates the drive', async () => {
  login('coordinator');
  const calls = server({ ...SESSION, [DR]: [200, [D1]], [cl(1)]: [200, { ...D1, status: 'closed' }] });
  view('/coordinator/drives');
  const a = await card('Acme - SDE');
  const user = userEvent.setup();
  await user.click(within(a).getByRole('button', { name: 'Close drive' }));
  expect(count(calls, cl(1))).toBe(0);
  await user.click(within(a).getByRole('button', { name: 'Cancel' }));
  expect(within(a).getByRole('button', { name: 'Close drive' })).toBeInTheDocument();
  expect(count(calls, cl(1))).toBe(0);
  await user.click(within(a).getByRole('button', { name: 'Close drive' }));
  await user.click(within(a).getByRole('button', { name: 'Confirm close' }));
  expect(await within(a).findByText('Status: closed')).toBeInTheDocument();
  expect(count(calls, cl(1))).toBe(1);
  expect(within(a).queryByRole('button', { name: 'Close drive' })).toBeNull();
  expect(within(a).queryByRole('button', { name: 'Confirm close' })).toBeNull();
  expect(calls.find(c => c.key === cl(1)).headers.authorization).toBe('Bearer tok-coordinator');
});

test('a failed close shows the error and keeps the drive open', async () => {
  login('coordinator');
  server({ ...SESSION, [DR]: [200, [D1]], [cl(1)]: [500, { error: 'Server error' }] });
  view('/coordinator/drives');
  const a = await card('Acme - SDE');
  const user = userEvent.setup();
  await user.click(within(a).getByRole('button', { name: 'Close drive' }));
  await user.click(within(a).getByRole('button', { name: 'Confirm close' }));
  expect(await within(a).findByRole('alert')).toHaveTextContent('Server error');
  expect(within(a).getByText('Status: open')).toBeInTheDocument();
});

test('creating a drive sends the form, adds it to the list and clears the form', async () => {
  login('coordinator');
  const created = { ...base, id: 3, company: 'Initech', role: 'Tester', description: 'Test things', status: 'open', min_cgpa: 7,
    allowed_departments: ['CSE', 'IT'], min_year: 2, max_year: 4, required_level: 'Advanced', required_skills: ['SQL', 'Go'], deadline: '2026-12-31T23:59:59.000Z' };
  const calls = server({ ...SESSION, [DR]: [200, [D1]], 'POST /api/drives': [201, created] });
  view('/coordinator/drives');
  await card('Acme - SDE');
  set('Company', ' Initech '); set('Role', 'Tester'); set('Description', 'Test things'); set('Minimum CGPA', '7');
  set('Allowed departments (comma separated)', 'CSE, IT'); set('Minimum year', '2'); set('Maximum year', '4');
  set('Required level', 'Advanced'); set('Required skills (comma separated)', 'SQL, Go'); set('Deadline', '2026-12-31');
  submit();
  expect(await screen.findByText('Drive created')).toBeInTheDocument();
  expect(calls.find(c => c.key === 'POST /api/drives').body).toEqual({ company: 'Initech', role: 'Tester', deadline: '2026-12-31T23:59:59.000Z',
    description: 'Test things', min_cgpa: 7, allowed_departments: ['CSE', 'IT'], min_year: 2, max_year: 4, required_level: 'Advanced', required_skills: ['SQL', 'Go'] });
  const c = await card('Initech - Tester');
  expect(within(c).getByText('Applications: 0')).toBeInTheDocument();
  expect(screen.getByLabelText('Company')).toHaveValue('');
});

test('a minimal drive sends only the required fields', async () => {
  login('coordinator');
  const calls = server({ ...SESSION, [DR]: [200, []], 'POST /api/drives': [201, { ...base, id: 4, company: 'Hooli', role: 'Intern', status: 'open' }] });
  view('/coordinator/drives');
  expect(await screen.findByText('No drives yet.')).toBeInTheDocument();
  set('Company', 'Hooli'); set('Role', 'Intern'); set('Deadline', '2026-12-31');
  submit();
  expect(await card('Hooli - Intern')).toBeInTheDocument();
  expect(calls.find(c => c.key === 'POST /api/drives').body).toEqual({ company: 'Hooli', role: 'Intern', deadline: '2026-12-31T23:59:59.000Z' });
});

test('local validation blocks bad drive forms before any request', async () => {
  login('coordinator');
  const calls = server({ ...SESSION, [DR]: [200, []] });
  view('/coordinator/drives');
  await screen.findByText('No drives yet.');
  submit();
  expect(screen.getByText('Company and role are required')).toBeInTheDocument();
  set('Company', 'Acme'); set('Role', 'SDE'); submit();
  expect(screen.getByText('A deadline date is required')).toBeInTheDocument();
  set('Deadline', '2026-12-31'); set('Minimum CGPA', '11'); submit();
  expect(screen.getByText('Minimum CGPA must be a number from 0 to 10')).toBeInTheDocument();
  set('Minimum CGPA', ''); set('Minimum year', '0'); submit();
  expect(screen.getByText('Minimum year must be a whole number from 1 to 6')).toBeInTheDocument();
  set('Minimum year', '4'); set('Maximum year', '2'); submit();
  expect(screen.getByText('Minimum year cannot exceed maximum year')).toBeInTheDocument();
  expect(calls.some(c => c.key.startsWith('POST'))).toBe(false);
});

test('a server rejection of a new drive is shown and nothing is added', async () => {
  login('coordinator');
  server({ ...SESSION, [DR]: [200, [D1]], 'POST /api/drives': [400, { error: 'Deadline must be in the future' }] });
  view('/coordinator/drives');
  await card('Acme - SDE');
  set('Company', 'Initech'); set('Role', 'Tester'); set('Deadline', '2020-01-01');
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Deadline must be in the future');
  expect(screen.queryByText('Drive created')).toBeNull();
  expect(screen.queryByRole('article', { name: 'Initech - Tester' })).toBeNull();
});

test('a drives load error is shown instead of the form', async () => {
  login('coordinator');
  server({ ...SESSION, [DR]: [500, { error: 'Server error' }] });
  view('/coordinator/drives');
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  expect(screen.queryByRole('button', { name: 'Create drive' })).toBeNull();
});

test('drive text from the server is rendered as text, never as markup', async () => {
  login('coordinator');
  const evil = '<img src=x onerror=alert(1)>';
  server({ ...SESSION, [DR]: [200, [{ ...D1, company: evil, description: '<b>bold</b>' }]] });
  view('/coordinator/drives');
  expect(await screen.findByText(evil, { exact: false })).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('article b')).toBeNull();
});

test('manager pages are coordinator-only', async () => {
  login('student');
  server(SESSION);
  view('/coordinator/drives');
  expect(await heading('Student dashboard')).toBeInTheDocument();
  cleanup();
  view('/coordinator/students');
  expect(await heading('Student dashboard')).toBeInTheDocument();
  cleanup();
  login('admin');
  view('/coordinator/drives');
  expect(await heading('Administration')).toBeInTheDocument();
});

test('navigation matches the role', async () => {
  login('coordinator');
  server({ ...SESSION, [DR]: [200, []] });
  view('/coordinator/drives');
  await heading('Manage drives');
  for (const n of ['Dashboard', 'Manage drives', 'Students']) expect(screen.getByRole('link', { name: n })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Manage drives' })).toHaveAttribute('href', '/coordinator/drives');
  expect(screen.getByRole('link', { name: 'Students' })).toHaveAttribute('href', '/coordinator/students');
  expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  cleanup();
  login('admin');
  view('/admin');
  await heading('Administration');
  expect(screen.queryByRole('link', { name: 'Manage drives' })).toBeNull();
});

const ST = 'GET /api/analytics/students';
const S_ZED = { id: 5, name: 'Zed', email: 'zed@t.com', level: null, readiness: { score: null, band: 'no_data', confidence: null }, weak_categories: [], self_reported: { department: null, year: null, cgpa: null } };
const S_ANU = { id: 6, name: 'Anu', email: 'anu@t.com', level: 'Intermediate', readiness: { score: 64, band: 'developing', confidence: 'high' }, weak_categories: ['programming'], self_reported: { department: 'CSE', year: 3, cgpa: 10 } };
const DETAIL = {
  student: { id: 6, name: 'Anu', email: 'anu@t.com' },
  verified: { source: 'system_verified', level: 'Intermediate',
    readiness: { score: 64, band: 'developing', confidence: 'high', missing: [],
      components: [{ name: 'initial_assessment', percent: 80, weight: 30 }, { name: 'practice', percent: 50, weight: 30 }, { name: 'mock_tests', percent: 62.5, weight: 40 }] },
    categories: [{ category: 'aptitude', questions: 15, correct: 12, accuracy: 80, weak: false }, { category: 'programming', questions: 17, correct: 9, accuracy: 52.9, weak: true }],
    weak_categories: ['programming'] },
  self_reported: { source: 'self_reported', department: 'CSE', year: 3, cgpa: 10, skills: ['SQL'], completeness_percent: 100 },
  applications: 2
};

test('lists students with verified and self-reported columns', async () => {
  login('coordinator');
  server({ ...SESSION, [ST]: [200, [S_ZED, S_ANU]] });
  view('/coordinator/students');
  const anu = await screen.findByRole('row', { name: /anu@t\.com/ });
  expect(within(anu).getByText('Intermediate')).toBeInTheDocument();
  expect(within(anu).getByText('64 (developing)')).toBeInTheDocument();
  expect(within(anu).getByText('programming')).toBeInTheDocument();
  expect(within(anu).getByText('CSE, year 3, CGPA 10')).toBeInTheDocument();
  const zed = screen.getByRole('row', { name: /zed@t\.com/ });
  expect(within(zed).getByText('not assessed')).toBeInTheDocument();
  expect(within(zed).getByText('n/a (no data)')).toBeInTheDocument();
  expect(within(zed).getByText('None')).toBeInTheDocument();
  expect(within(zed).getByText('not provided')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Level (verified)' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Self-reported' })).toBeInTheDocument();
});

test('filtering by readiness band asks the server', async () => {
  login('coordinator');
  const calls = server({ ...SESSION, [ST]: [200, [S_ZED, S_ANU]], [ST + '?band=developing']: [200, [S_ANU]] });
  view('/coordinator/students');
  await screen.findByRole('row', { name: /zed@t\.com/ });
  await userEvent.setup().selectOptions(screen.getByLabelText('Readiness band'), 'developing');
  await waitFor(() => expect(count(calls, ST + '?band=developing')).toBe(1));
  await waitFor(() => expect(screen.queryByRole('row', { name: /zed@t\.com/ })).toBeNull());
  expect(await screen.findByRole('row', { name: /anu@t\.com/ })).toBeInTheDocument();
  expect(count(calls, ST)).toBe(1);
});

test('viewing a student shows verified and self-reported data separately', async () => {
  login('coordinator');
  const calls = server({ ...SESSION, [ST]: [200, [S_ANU]], 'GET /api/analytics/students/6': [200, DETAIL] });
  view('/coordinator/students');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'View Anu' }));
  const p = await screen.findByRole('region', { name: 'Student details' });
  expect(within(p).getByRole('heading', { name: 'Details: Anu' })).toBeInTheDocument();
  for (const t of ['Level: Intermediate', 'Readiness: 64 (developing), confidence high', 'initial assessment: 80% (weight 30)',
    'aptitude: 80% over 15 questions', 'programming: 52.9% over 17 questions (weak)', 'Department: CSE', 'Year: 3', 'CGPA: 10',
    'Skills: SQL', 'Applications: 2', 'Viewing this record is logged in the audit trail.'])
    expect(within(p).getByText(t)).toBeInTheDocument();
  expect(within(p).getByRole('heading', { name: 'Verified by the system' })).toBeInTheDocument();
  expect(within(p).getByRole('heading', { name: 'Self-reported by the student' })).toBeInTheDocument();
  expect(count(calls, 'GET /api/analytics/students/6')).toBe(1);
});

test('a details error is shown and the list stays', async () => {
  login('coordinator');
  server({ ...SESSION, [ST]: [200, [S_ANU]], 'GET /api/analytics/students/6': [500, { error: 'Server error' }] });
  view('/coordinator/students');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'View Anu' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  expect(screen.getByRole('row', { name: /anu@t\.com/ })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Student details' })).toBeNull();
});

test('empty and error states', async () => {
  login('coordinator');
  server({ ...SESSION, [ST]: [200, []] });
  view('/coordinator/students');
  expect(await screen.findByText('No students match.')).toBeInTheDocument();
  cleanup();
  server({ ...SESSION, [ST]: [500, { error: 'Server error' }] });
  view('/coordinator/students');
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
});

test('student names are rendered as text, never as markup', async () => {
  login('coordinator');
  const evil = '<img src=x onerror=alert(1)>';
  server({ ...SESSION, [ST]: [200, [{ ...S_ANU, name: evil }]] });
  view('/coordinator/students');
  expect(await screen.findByText(evil, { exact: false })).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});
