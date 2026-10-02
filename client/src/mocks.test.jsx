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
  'GET /api/auth/me': req => { const t = tokenOf(req); return t === 'tok-student' ? [200, STUDENT] : t === 'tok-coordinator' ? [200, COORD] : [401, { error: 'Invalid or expired session' }]; },
  'POST /api/auth/logout': [200, { ok: true }],
  'GET /api/analytics/cohort': [200, { students: 1, assessed: 0, readiness: { average_score: null, bands: { ready: 0 } } }]
};
const M = '/api/mocks';
const ML = 'GET ' + M;
const CUR = 'GET ' + M + '/current';
const HIS = 'GET ' + M + '/attempts/history';
const SECTIONS = [{ name: 'Aptitude', questions: 4 }, { name: 'Programming', questions: 4 }];
const MOCKS = [
  { id: 1, title: 'General Placement Mock', company_id: null, company: null, duration_minutes: 30, total_questions: 8, sections: SECTIONS },
  { id: 2, title: 'Acme Technologies Mock', company_id: 5, company: 'Acme Technologies', duration_minutes: 30, total_questions: 8, sections: SECTIONS }
];
const QS = [
  { id: 21, section: 'Aptitude', text: 'What is 12.5% of 480?', options: ['50', '60', '62', '65'] },
  { id: 22, section: 'Programming', text: 'Which HTTP status code means Not Found?', options: ['200', '301', '404', '500'] }
];
const run = (sec, answers = {}) => ({ status: 'in_progress', attempt_id: 9, mock_id: 1, title: 'General Placement Mock', remaining_seconds: sec, questions: QS, answers });
const DONE = {
  status: 'completed', attempt_id: 9, mock_id: 1, title: 'General Placement Mock', score: 1, total: 2,
  sections: [{ section: 'Aptitude', score: 1, total: 1 }, { section: 'Programming', score: 0, total: 1 }],
  review: [
    { question_id: 21, section: 'Aptitude', text: 'What is 12.5% of 480?', options: ['50', '60', '62', '65'], selected_index: 1, correct_index: 1, correct: true },
    { question_id: 22, section: 'Programming', text: 'Which HTTP status code means Not Found?', options: ['200', '301', '404', '500'], selected_index: 0, correct_index: 2, correct: false }
  ]
};
const idle = extra => ({ ...SESSION, [CUR]: [200, { status: 'none' }], [ML]: [200, MOCKS], [HIS]: [200, []], ...extra });

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
const login = () => tokenStore.set('tok-student');
const count = (calls, key) => calls.filter(c => c.key === key).length;

test('lists mock tests with company, size and sections, and shows recent attempts', async () => {
  login();
  server(idle({ [HIS]: [200, [{ id: 8, mock_id: 1, title: 'General Placement Mock', score: 6, total: 8, submitted_at: 1 }]] }));
  view('/student/mocks');
  const a = await screen.findByRole('article', { name: 'Acme Technologies Mock' });
  expect(within(a).getByText('Company: Acme Technologies')).toBeInTheDocument();
  expect(within(a).getByText('8 questions, 30 minutes')).toBeInTheDocument();
  expect(within(a).getByText('Sections: Aptitude (4), Programming (4)')).toBeInTheDocument();
  const g = screen.getByRole('article', { name: 'General Placement Mock' });
  expect(within(g).getByText('General practice test')).toBeInTheDocument();
  expect(await screen.findByText('General Placement Mock: 6 of 8')).toBeInTheDocument();
});

test('starting a mock begins a timed run with section-labelled questions', async () => {
  login();
  const calls = server(idle({ ['POST ' + M + '/1/start']: [201, run(1800)] }));
  view('/student/mocks');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Start General Placement Mock' }));
  expect(await screen.findByRole('timer')).toHaveTextContent('Time left: 30:00');
  expect(screen.getByRole('group', { name: /Aptitude: What is 12\.5% of 480/ })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: /Programming: Which HTTP/ })).toBeInTheDocument();
  expect(count(calls, 'POST ' + M + '/1/start')).toBe(1);
});

test('choosing an answer saves it to the server', async () => {
  login();
  const calls = server(idle({ [CUR]: [200, run(600)], ['PUT ' + M + '/attempts/9/answer']: [200, { saved: true, remaining_seconds: 590 }] }));
  view('/student/mocks');
  const g = await screen.findByRole('group', { name: /Programming: Which HTTP/ });
  await userEvent.setup().click(within(g).getByRole('radio', { name: '404' }));
  expect(await screen.findByText('All answers saved')).toBeInTheDocument();
  expect(calls.find(c => c.key === 'PUT ' + M + '/attempts/9/answer').body).toEqual({ questionId: 22, selectedIndex: 2 });
});

test('submitting shows the score, section scores and an answer review, then returns to the list', async () => {
  login();
  const calls = server(idle({
    [CUR]: [200, run(600)],
    ['PUT ' + M + '/attempts/9/answer']: [200, { saved: true, remaining_seconds: 5 }],
    ['POST ' + M + '/attempts/9/submit']: [200, DONE]
  }));
  view('/student/mocks');
  const g1 = await screen.findByRole('group', { name: /Aptitude/ });
  const g2 = screen.getByRole('group', { name: /Programming/ });
  const user = userEvent.setup();
  await user.click(within(g1).getByRole('radio', { name: '60' }));
  await user.click(within(g2).getByRole('radio', { name: '200' }));
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { name: 'Mock test complete' })).toBeInTheDocument();
  expect(screen.getByText('General Placement Mock: 1 of 2')).toBeInTheDocument();
  const s = screen.getByRole('list', { name: 'Section scores' });
  expect(within(s).getByText('Aptitude: 1 of 1')).toBeInTheDocument();
  expect(within(s).getByText('Programming: 0 of 1')).toBeInTheDocument();
  expect(screen.getByText('Correct')).toBeInTheDocument();
  expect(screen.getByText('Incorrect')).toBeInTheDocument();
  expect(screen.getByText('60 (your answer, correct answer)')).toBeInTheDocument();
  expect(screen.getByText('200 (your answer)')).toBeInTheDocument();
  expect(screen.getByText('404 (correct answer)')).toBeInTheDocument();
  expect(count(calls, 'POST ' + M + '/attempts/9/submit')).toBe(1);
  await user.click(screen.getByRole('button', { name: 'Back to mock tests' }));
  expect(await screen.findByRole('button', { name: 'Start General Placement Mock' })).toBeInTheDocument();
});

test('an active attempt resumes with saved answers and the remaining time', async () => {
  login();
  server(idle({ [CUR]: [200, run(125, { 21: 1 })] }));
  view('/student/mocks');
  const g = await screen.findByRole('group', { name: /Aptitude/ });
  expect(screen.getByRole('timer')).toHaveTextContent('Time left: 2:05');
  expect(within(g).getByRole('radio', { name: '60' })).toBeChecked();
  expect(screen.queryByRole('button', { name: /^Start / })).toBeNull();
});

test('starting before the initial assessment shows the reason and a link', async () => {
  login();
  server(idle({ ['POST ' + M + '/1/start']: [403, { error: 'Complete the initial assessment first' }] }));
  view('/student/mocks');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Start General Placement Mock' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Complete the initial assessment first');
  expect(screen.getByRole('link', { name: 'Take the initial assessment' })).toHaveAttribute('href', '/student/assessment');
});

test('a mock with no time left is submitted automatically', async () => {
  login();
  const calls = server(idle({ [CUR]: [200, run(0, { 21: 1 })], ['POST ' + M + '/attempts/9/submit']: [200, DONE] }));
  view('/student/mocks');
  expect(await screen.findByRole('heading', { name: 'Mock test complete' })).toBeInTheDocument();
  expect(count(calls, 'POST ' + M + '/attempts/9/submit')).toBe(1);
  expect(calls.some(c => c.key.startsWith('PUT'))).toBe(false);
});

test('empty and error states for the mock list', async () => {
  login();
  server(idle({ [ML]: [200, []] }));
  view('/student/mocks');
  expect(await screen.findByText('No mock tests are available yet.')).toBeInTheDocument();
  cleanup();
  server(idle({ [ML]: [500, { error: 'Server error' }] }));
  view('/student/mocks');
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  expect(screen.queryByText('No mock tests are available yet.')).toBeNull();
});

test('mock text from the server is rendered as text, never as markup', async () => {
  login();
  const evil = '<img src=x onerror=alert(1)>';
  server(idle({ [ML]: [200, [{ ...MOCKS[0], title: evil }]] }));
  view('/student/mocks');
  expect(await screen.findByText(evil, { exact: false })).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});

test('mock pages are student-only', async () => {
  tokenStore.set('tok-coordinator');
  server(SESSION);
  view('/student/mocks');
  expect(await screen.findByRole('heading', { name: 'Coordinator dashboard' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Mock tests' })).toBeNull();
});
