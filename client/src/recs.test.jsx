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
const RC = 'GET /api/recommendations';
const RECS = {
  level: 'Intermediate', readiness_band: 'developing',
  recommendations: [
    { type: 'practice', priority: 'high', source: 'system_verified', category: 'programming', title: 'Strengthen programming',
      reason: 'Your accuracy is 52.9% across 17 graded questions, below the 60% target', action: 'Practice programming at Intermediate level' },
    { type: 'mock', priority: 'medium', source: 'system_verified', title: 'Take a mock test',
      reason: 'You have no completed mock tests yet, and they carry the most weight in your readiness score',
      mocks: [{ id: 1, title: 'General Placement Mock' }, { id: 2, title: 'Acme Technologies Mock' }] },
    { type: 'apply', priority: 'medium', source: 'mixed', drive_id: 3, title: 'Apply to Acme - SDE',
      reason: 'You meet every eligibility rule for this drive', deadline: '2026-12-01T00:00:00.000Z' },
    { type: 'drive_gap', priority: 'low', source: 'self_reported', drive_id: 4, rule: 'skills',
      title: 'Globex - Analyst: close the skills gap', reason: 'Missing required skills: Go' },
    { type: 'complete_profile', priority: 'low', source: 'self_reported', title: 'Complete your profile',
      reason: 'Drives check these details, and they appear on your resume', missing_fields: ['phone', 'skills'] }
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
const view = () => render(<MemoryRouter initialEntries={['/student/recommendations']}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
const login = () => tokenStore.set('tok-student');
const card = name => screen.getByRole('article', { name });

test('shows level, band and each recommendation with priority, source and reason', async () => {
  login();
  server({ ...SESSION, [RC]: [200, RECS] });
  view();
  const p = await screen.findByRole('article', { name: 'Strengthen programming' });
  expect(screen.getByText('Verified level: Intermediate')).toBeInTheDocument();
  expect(screen.getByText('Readiness band: developing')).toBeInTheDocument();
  expect(within(p).getByText('high priority')).toBeInTheDocument();
  expect(within(p).getByText('Based on verified results')).toBeInTheDocument();
  expect(within(p).getByText(/52\.9% across 17/)).toBeInTheDocument();
  expect(within(p).getByText('Suggested: Practice programming at Intermediate level')).toBeInTheDocument();
  const m = card('Take a mock test');
  expect(within(m).getByText('General Placement Mock')).toBeInTheDocument();
  expect(within(m).getByText('Acme Technologies Mock')).toBeInTheDocument();
  expect(within(card('Apply to Acme - SDE')).getByText('Based on verified and self-reported details')).toBeInTheDocument();
  expect(within(card('Globex - Analyst: close the skills gap')).getByText('Based on self-reported details')).toBeInTheDocument();
});

test('each recommendation links to the page where it can be acted on', async () => {
  login();
  server({ ...SESSION, [RC]: [200, RECS] });
  view();
  await screen.findByRole('article', { name: 'Strengthen programming' });
  const link = (title, name) => within(card(title)).getByRole('link', { name });
  expect(link('Strengthen programming', 'Go to practice')).toHaveAttribute('href', '/student/practice');
  expect(link('Take a mock test', 'Go to mock tests')).toHaveAttribute('href', '/student/mocks');
  expect(link('Apply to Acme - SDE', 'Go to drives')).toHaveAttribute('href', '/student/drives');
  expect(link('Globex - Analyst: close the skills gap', 'Go to drives')).toHaveAttribute('href', '/student/drives');
  expect(link('Complete your profile', 'Update your profile')).toHaveAttribute('href', '/student/profile');
});

test('a student without a level is pointed to the assessment', async () => {
  login();
  server({ ...SESSION, [RC]: [200, { level: null, readiness_band: 'no_data', recommendations: [
    { type: 'initial_assessment', priority: 'high', source: 'system_verified', title: 'Take the initial assessment',
      reason: 'Your level is not verified yet; practice, mocks and drive eligibility depend on it' }] }] });
  view();
  const a = await screen.findByRole('article', { name: 'Take the initial assessment' });
  expect(screen.getByText('Verified level: not assessed')).toBeInTheDocument();
  expect(screen.getByText('Readiness band: no data')).toBeInTheDocument();
  expect(within(a).getByRole('link', { name: 'Go to the assessment' })).toHaveAttribute('href', '/student/assessment');
});

test('shows the deadline, missing profile fields and keeps the server order', async () => {
  login();
  server({ ...SESSION, [RC]: [200, RECS] });
  view();
  const a = await screen.findByRole('article', { name: 'Apply to Acme - SDE' });
  expect(within(a).getByText('Deadline: 2026-12-01')).toBeInTheDocument();
  expect(within(card('Complete your profile')).getByText('Missing: phone, skills')).toBeInTheDocument();
  expect(screen.getAllByRole('article').map(x => x.getAttribute('aria-label'))).toEqual(RECS.recommendations.map(r => r.title));
});

test('an empty list shows a message', async () => {
  login();
  server({ ...SESSION, [RC]: [200, { level: 'Advanced', readiness_band: 'ready', recommendations: [] }] });
  view();
  expect(await screen.findByText('No recommendations right now.')).toBeInTheDocument();
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});

test('a load error is shown instead of recommendations', async () => {
  login();
  server({ ...SESSION, [RC]: [500, { error: 'Server error' }] });
  view();
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});

test('recommendation text is rendered as text, never as markup', async () => {
  login();
  const evil = '<img src=x onerror=alert(1)>';
  server({ ...SESSION, [RC]: [200, { level: 'Beginner', readiness_band: 'developing', recommendations: [
    { type: 'practice', priority: 'high', source: 'system_verified', title: evil, reason: '<b>bold</b>' }] }] });
  view();
  expect(await screen.findByText(evil, { exact: false })).toBeInTheDocument();
  expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('article b')).toBeNull();
});

test('recommendation pages are student-only and students get the new links', async () => {
  tokenStore.set('tok-coordinator');
  server(SESSION);
  view();
  expect(await screen.findByRole('heading', { name: 'Coordinator dashboard' })).toBeInTheDocument();
  cleanup();
  login();
  server({ ...SESSION, [RC]: [200, { level: null, readiness_band: 'no_data', recommendations: [] }] });
  view();
  await screen.findByText('No recommendations right now.');
  expect(screen.getByRole('link', { name: 'Mock tests' })).toHaveAttribute('href', '/student/mocks');
  expect(screen.getByRole('link', { name: 'Recommendations' })).toHaveAttribute('href', '/student/recommendations');
});
