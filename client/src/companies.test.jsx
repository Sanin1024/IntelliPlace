import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { AppRoutes } from './App';
import { tokenStore } from './api';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const STUDENT = { id: 1, name: 'Asha', email: 'asha@t.com', role: 'student' };
const COORD = { id: 2, name: 'Coord', email: 'coord@t.com', role: 'coordinator' };
const tokenOf = req => (req.headers.authorization || '').replace('Bearer ', '');
const SESSION = {
  'GET /api/auth/me': req => { const t = tokenOf(req); return t === 'tok-student' ? [200, STUDENT] : t === 'tok-coordinator' ? [200, COORD] : [401, { error: 'Invalid or expired session' }]; },
  'POST /api/auth/logout': [200, { ok: true }],
  'GET /api/analytics/cohort': [200, { students: 1, assessed: 0, readiness: { average_score: null, bands: { ready: 0 } } }]
};
const CL = 'GET /api/companies';
const PR = id => `GET /api/companies/${id}/prep`;
const COMPANIES = [
  { id: 5, name: 'Acme Technologies', focus: ['aptitude', 'programming'], resource_count: 3 },
  { id: 6, name: 'Globex', focus: [], resource_count: 1 }
];
const PREP = {
  company: { id: 5, name: 'Acme Technologies', focus: ['aptitude', 'programming'] },
  resources: [
    { id: 1, title: 'Aptitude topics', kind: 'topic', content: 'Percentages and ratios' },
    { id: 2, title: 'Careers page', kind: 'link', content: 'https://example.com/prep' },
    { id: 3, title: 'Test-day tip', kind: 'tip', content: 'Attempt every question' }
  ],
  mocks: [{ id: 2, title: 'Acme Technologies Mock', duration_minutes: 30, total_questions: 8 }],
  drives: [
    { id: 9, role: 'SDE', status: 'open', deadline: '2026-12-01T00:00:00.000Z', eligible: false, failed_rules: ['cgpa', 'level'] },
    { id: 10, role: 'Analyst', status: 'open', deadline: '2026-12-05T00:00:00.000Z', eligible: true, failed_rules: [] }
  ],
  readiness: [
    { category: 'aptitude', source: 'system_verified', accuracy: 100, needs_work: false },
    { category: 'programming', source: 'system_verified', accuracy: null, needs_work: true }
  ]
};

function server(routes) {
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const h = routes[`${opts.method || 'GET'} ${url}`];
    if (!h) return reply(404, { error: 'Not found' });
    const [status, body] = typeof h === 'function' ? h({ headers: opts.headers || {} }) : h;
    return reply(status, body);
  }));
}
const view = path => render(<MemoryRouter initialEntries={[path]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
const login = () => tokenStore.set('tok-student');

test('lists companies with focus, resource count and a link to the preparation page', async () => {
  login();
  server({ ...SESSION, [CL]: [200, COMPANIES] });
  view('/student/companies');
  const a = await screen.findByRole('article', { name: 'Acme Technologies' });
  expect(within(a).getByText('Focus: aptitude, programming')).toBeInTheDocument();
  expect(within(a).getByText('3 resources')).toBeInTheDocument();
  expect(within(a).getByRole('link', { name: 'View preparation' })).toHaveAttribute('href', '/student/companies/5');
  const g = screen.getByRole('article', { name: 'Globex' });
  expect(within(g).getByText('Focus: none')).toBeInTheDocument();
  expect(within(g).getByText('1 resource')).toBeInTheDocument();
});

test('an empty company list shows a message', async () => {
  login();
  server({ ...SESSION, [CL]: [200, []] });
  view('/student/companies');
  expect(await screen.findByText('No companies yet.')).toBeInTheDocument();
});

test('a company list error is shown', async () => {
  login();
  server({ ...SESSION, [CL]: [500, { error: 'Server error' }] });
  view('/student/companies');
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
});

test('the preparation page shows readiness, resources, mocks and drives', async () => {
  login();
  server({ ...SESSION, [PR(5)]: [200, PREP] });
  view('/student/companies/5');
  expect(await screen.findByRole('heading', { name: 'Acme Technologies' })).toBeInTheDocument();
  expect(screen.getByText('Focus areas: aptitude, programming')).toBeInTheDocument();
  expect(screen.getByText('aptitude: 100% accuracy')).toBeInTheDocument();
  expect(screen.getByText('programming: no graded practice yet (needs work)')).toBeInTheDocument();
  expect(screen.getByText('Aptitude topics (topic): Percentages and ratios')).toBeInTheDocument();
  expect(screen.getByText('Test-day tip (tip): Attempt every question')).toBeInTheDocument();
  expect(screen.getByText('Careers page (link):')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'https://example.com/prep' });
  expect(link).toHaveAttribute('href', 'https://example.com/prep');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('Acme Technologies Mock - 8 questions, 30 minutes')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to mock tests' })).toHaveAttribute('href', '/student/mocks');
  expect(screen.getByText('SDE - open, deadline 2026-12-01: Not eligible (cgpa, level)')).toBeInTheDocument();
  expect(screen.getByText('Analyst - open, deadline 2026-12-05: Eligible')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to drives' })).toHaveAttribute('href', '/student/drives');
});

test('a company with nothing yet shows empty states', async () => {
  login();
  server({ ...SESSION, [PR(6)]: [200, { company: { id: 6, name: 'Globex', focus: [] }, resources: [], mocks: [], drives: [], readiness: [] }] });
  view('/student/companies/6');
  expect(await screen.findByRole('heading', { name: 'Globex' })).toBeInTheDocument();
  for (const t of ['Focus areas: none', 'No focus areas set.', 'No resources yet.', 'No mock tests for this company yet.', 'No drives for this company yet.'])
    expect(screen.getByText(t)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Go to mock tests' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Go to drives' })).toBeNull();
});

test('an unknown company shows the server error', async () => {
  login();
  server({ ...SESSION, [PR(9)]: [404, { error: 'Company not found' }] });
  view('/student/companies/9');
  expect(await screen.findByRole('alert')).toHaveTextContent('Company not found');
});

test('resource text is rendered as text and unsafe links are never clickable', async () => {
  login();
  const evil = '<img src=x onerror=alert(1)>';
  server({ ...SESSION, [PR(5)]: [200, { ...PREP, resources: [
    { id: 1, title: evil, kind: 'topic', content: '<b>bold</b>' },
    { id: 2, title: 'Bad', kind: 'link', content: 'javascript:alert(1)' }] }] });
  view('/student/companies/5');
  expect(await screen.findByText(evil, { exact: false })).toBeInTheDocument();
  expect(screen.getByText('Bad (link): javascript:alert(1)')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('li b')).toBeNull();
  expect(document.querySelector('a[href^="javascript"]')).toBeNull();
});

test('company pages are student-only', async () => {
  tokenStore.set('tok-coordinator');
  server(SESSION);
  view('/student/companies');
  expect(await screen.findByRole('heading', { name: 'Coordinator dashboard' })).toBeInTheDocument();
  cleanup();
  view('/student/companies/5');
  expect(await screen.findByRole('heading', { name: 'Coordinator dashboard' })).toBeInTheDocument();
});
