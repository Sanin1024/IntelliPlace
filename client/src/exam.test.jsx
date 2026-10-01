import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
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
const A = '/api/student/assessment/initial';
const P = '/api/student/practice';
const QS = [
  { id: 11, category: 'aptitude', text: 'What is 15% of 200?', options: ['20', '25', '30', '35'] },
  { id: 12, category: 'programming', text: 'Which data structure follows FIFO order?', options: ['Stack', 'Tree', 'Queue', 'Graph'] }
];
const inProgress = (sec, answers = {}, questions = QS) => ({ status: 'in_progress', attempt_id: 7, remaining_seconds: sec, questions, answers });
const practiceState = (answers = {}, sec = 1200) => ({
  status: 'in_progress', session_id: 5, category: 'aptitude', difficulty: 'Beginner', remaining_seconds: sec,
  questions: QS.map(({ id, text, options }) => ({ id, text, options })), answers
});
const DONE = { status: 'completed', score: 2, total: 2, level: 'Advanced' };

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
const asStudent = () => tokenStore.set('tok-student');
const count = (calls, key) => calls.filter(c => c.key === key).length;
const group = name => screen.findByRole('group', { name });
const radio = (g, name) => within(g).getByRole('radio', { name });

test('assessment: intro, then Start begins a timed attempt', async () => {
  asStudent();
  const calls = server({ ...SESSION, ['GET ' + A]: [200, { status: 'not_started' }], ['POST ' + A + '/start']: [201, inProgress(900)] });
  view('/student/assessment');
  expect(await screen.findByText(/15 minutes/)).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Start assessment' }));
  expect(await screen.findByRole('timer')).toHaveTextContent('Time left: 15:00');
  expect(screen.getByRole('group', { name: /15% of 200/ })).toBeInTheDocument();
  expect(count(calls, 'POST ' + A + '/start')).toBe(1);
});

test('choosing an answer saves it to the server immediately', async () => {
  asStudent();
  const calls = server({ ...SESSION, ['GET ' + A]: [200, inProgress(600)], ['PUT ' + A + '/answer']: [200, { saved: true, remaining_seconds: 590 }] });
  view('/student/assessment');
  const g = await group(/15% of 200/);
  await userEvent.setup().click(radio(g, '30'));
  expect(await screen.findByText('All answers saved')).toBeInTheDocument();
  const puts = calls.filter(c => c.key === 'PUT ' + A + '/answer');
  expect(puts).toHaveLength(1);
  expect(puts[0].body).toEqual({ questionId: 11, selectedIndex: 2 });
  expect(radio(g, '30')).toBeChecked();
  expect(screen.getByText('Answered 1 of 2')).toBeInTheDocument();
});

test('an in-progress attempt resumes with saved answers and the remaining time', async () => {
  asStudent();
  server({ ...SESSION, ['GET ' + A]: [200, inProgress(125, { 11: 1 })] });
  view('/student/assessment');
  const g = await group(/15% of 200/);
  expect(screen.getByRole('timer')).toHaveTextContent('Time left: 2:05');
  expect(radio(g, '25')).toBeChecked();
  expect(screen.getByText('Answered 1 of 2')).toBeInTheDocument();
});

test('changing an answer twice leaves the server with the latest choice', async () => {
  asStudent();
  const calls = server({ ...SESSION, ['GET ' + A]: [200, inProgress(600)], ['PUT ' + A + '/answer']: [200, { saved: true, remaining_seconds: 5 }] });
  view('/student/assessment');
  const g = await group(/15% of 200/);
  const user = userEvent.setup();
  await user.click(radio(g, '20'));
  await user.click(radio(g, '35'));
  expect(await screen.findByText('All answers saved')).toBeInTheDocument();
  const puts = calls.filter(c => c.key === 'PUT ' + A + '/answer');
  expect(puts.at(-1).body).toEqual({ questionId: 11, selectedIndex: 3 });
  expect(radio(g, '35')).toBeChecked();
});

test('a failed save keeps the choice, blocks submit, and is retried on submit', async () => {
  asStudent();
  let ok = false;
  const calls = server({
    ...SESSION,
    ['GET ' + A]: [200, inProgress(600)],
    ['PUT ' + A + '/answer']: () => (ok ? [200, { saved: true, remaining_seconds: 5 }] : [500, { error: 'Server error' }]),
    ['POST ' + A + '/submit']: [200, DONE]
  });
  view('/student/assessment');
  const g = await group(/15% of 200/);
  const user = userEvent.setup();
  await user.click(radio(g, '30'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Could not save/));
  expect(radio(g, '30')).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be saved/));
  expect(count(calls, 'POST ' + A + '/submit')).toBe(0);
  ok = true;
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { name: 'Assessment complete' })).toBeInTheDocument();
  expect(count(calls, 'POST ' + A + '/submit')).toBe(1);
});

test('submitting saves outstanding answers first, then shows the server-assigned level', async () => {
  asStudent();
  const calls = server({
    ...SESSION,
    ['GET ' + A]: [200, inProgress(600)],
    ['PUT ' + A + '/answer']: [200, { saved: true, remaining_seconds: 5 }],
    ['POST ' + A + '/submit']: [200, DONE]
  });
  view('/student/assessment');
  const g1 = await group(/15% of 200/);
  const g2 = await group(/FIFO/);
  const user = userEvent.setup();
  await user.click(radio(g1, '30'));
  await user.click(radio(g2, 'Queue'));
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { name: 'Assessment complete' })).toBeInTheDocument();
  expect(screen.getByText('Advanced')).toBeInTheDocument();
  expect(screen.getByText(/2 of 2/)).toBeInTheDocument();
  const keys = calls.map(c => c.key);
  expect(keys.filter(k => k === 'PUT ' + A + '/answer')).toHaveLength(2);
  expect(keys.indexOf('POST ' + A + '/submit')).toBeGreaterThan(keys.lastIndexOf('PUT ' + A + '/answer'));
});

test('when no time is left the saved answers are submitted automatically', async () => {
  asStudent();
  const calls = server({ ...SESSION, ['GET ' + A]: [200, inProgress(0, { 11: 1 })], ['POST ' + A + '/submit']: [200, DONE] });
  view('/student/assessment');
  expect(await screen.findByRole('heading', { name: 'Assessment complete' })).toBeInTheDocument();
  expect(count(calls, 'POST ' + A + '/submit')).toBe(1);
  expect(calls.some(c => c.key.startsWith('PUT'))).toBe(false);
});

test('the countdown reaches zero and submits by itself', { timeout: 10000 }, async () => {
  asStudent();
  const calls = server({ ...SESSION, ['GET ' + A]: [200, inProgress(1)], ['POST ' + A + '/submit']: [200, DONE] });
  view('/student/assessment');
  await screen.findByRole('timer');
  expect(await screen.findByRole('heading', { name: 'Assessment complete' }, { timeout: 5000 })).toBeInTheDocument();
  expect(count(calls, 'POST ' + A + '/submit')).toBe(1);
});

test('a rejected save because time ran out triggers submission', async () => {
  asStudent();
  const calls = server({
    ...SESSION,
    ['GET ' + A]: [200, inProgress(600)],
    ['PUT ' + A + '/answer']: [409, { error: 'Assessment closed' }],
    ['POST ' + A + '/submit']: [200, DONE]
  });
  view('/student/assessment');
  const g = await group(/15% of 200/);
  await userEvent.setup().click(radio(g, '30'));
  expect(await screen.findByRole('heading', { name: 'Assessment complete' })).toBeInTheDocument();
  expect(count(calls, 'POST ' + A + '/submit')).toBe(1);
});

test('a completed assessment shows the result and offers no restart', async () => {
  asStudent();
  server({ ...SESSION, ['GET ' + A]: [200, { status: 'completed', score: 7, total: 10, level: 'Intermediate' }] });
  view('/student/assessment');
  expect(await screen.findByRole('heading', { name: 'Assessment complete' })).toBeInTheDocument();
  expect(screen.getByText('Intermediate')).toBeInTheDocument();
  expect(screen.getByText(/7 of 10/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start assessment' })).toBeNull();
});

test('starting an already completed assessment shows the server error', async () => {
  asStudent();
  server({ ...SESSION, ['GET ' + A]: [200, { status: 'not_started' }], ['POST ' + A + '/start']: [409, { error: 'Initial assessment already completed' }] });
  view('/student/assessment');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Start assessment' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Initial assessment already completed');
});

test('practice: default start sends only the category', async () => {
  asStudent();
  const calls = server({ ...SESSION, ['GET ' + P + '/current']: [200, { status: 'none' }], ['GET ' + P + '/history']: [200, []], ['POST ' + P + '/start']: [201, practiceState()] });
  view('/student/practice');
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText('Category'), 'programming');
  await user.click(screen.getByRole('button', { name: 'Start practice' }));
  expect(await screen.findByRole('timer')).toHaveTextContent('Time left: 20:00');
  expect(calls.find(c => c.key === 'POST ' + P + '/start').body).toEqual({ category: 'programming' });
});

test('practice: a chosen difficulty is sent to the server', async () => {
  asStudent();
  const calls = server({ ...SESSION, ['GET ' + P + '/current']: [200, { status: 'none' }], ['GET ' + P + '/history']: [200, []], ['POST ' + P + '/start']: [201, practiceState()] });
  view('/student/practice');
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText('Difficulty'), 'Intermediate');
  await user.click(screen.getByRole('button', { name: 'Start practice' }));
  await screen.findByRole('timer');
  expect(calls.find(c => c.key === 'POST ' + P + '/start').body).toEqual({ category: 'aptitude', difficulty: 'Intermediate' });
});

test('practice before the initial assessment shows the reason and a link', async () => {
  asStudent();
  server({ ...SESSION, ['GET ' + P + '/current']: [200, { status: 'none' }], ['GET ' + P + '/history']: [200, []],
    ['POST ' + P + '/start']: [403, { error: 'Complete the initial assessment first' }] });
  view('/student/practice');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Start practice' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Complete the initial assessment first');
  expect(screen.getByRole('link', { name: 'Take the initial assessment' })).toHaveAttribute('href', '/student/assessment');
});

test('practice run ends with a review of correct and incorrect answers', async () => {
  asStudent();
  const review = [
    { question_id: 11, text: 'What is 15% of 200?', options: ['20', '25', '30', '35'], selected_index: 2, correct_index: 2, correct: true },
    { question_id: 12, text: 'Which data structure follows FIFO order?', options: ['Stack', 'Tree', 'Queue', 'Graph'], selected_index: 0, correct_index: 2, correct: false }
  ];
  const calls = server({
    ...SESSION,
    ['GET ' + P + '/current']: [200, { status: 'none' }],
    ['GET ' + P + '/history']: [200, []],
    ['POST ' + P + '/start']: [201, practiceState()],
    ['PUT ' + P + '/5/answer']: [200, { saved: true, remaining_seconds: 100 }],
    ['POST ' + P + '/5/submit']: [200, { status: 'completed', session_id: 5, category: 'aptitude', difficulty: 'Beginner', score: 1, total: 2, review }]
  });
  view('/student/practice');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Start practice' }));
  const g1 = await group(/15% of 200/);
  const g2 = await group(/FIFO/);
  await user.click(radio(g1, '30'));
  await user.click(radio(g2, 'Stack'));
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { name: 'Practice complete' })).toBeInTheDocument();
  expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
  expect(screen.getByText('Correct')).toBeInTheDocument();
  expect(screen.getByText('Incorrect')).toBeInTheDocument();
  expect(screen.getByText('30 (your answer, correct answer)')).toBeInTheDocument();
  expect(screen.getByText('Stack (your answer)')).toBeInTheDocument();
  expect(screen.getByText('Queue (correct answer)')).toBeInTheDocument();
  expect(calls.filter(c => c.key === 'PUT ' + P + '/5/answer')[0].body).toEqual({ questionId: 11, selectedIndex: 2 });
});

test('an active practice session resumes instead of showing the start form', async () => {
  asStudent();
  server({ ...SESSION, ['GET ' + P + '/current']: [200, practiceState({ 12: 2 }, 300)], ['GET ' + P + '/history']: [200, []] });
  view('/student/practice');
  expect(await screen.findByRole('timer')).toHaveTextContent('Time left: 5:00');
  const g = await group(/FIFO/);
  expect(radio(g, 'Queue')).toBeChecked();
  expect(screen.queryByRole('button', { name: 'Start practice' })).toBeNull();
});

test('recent practice sessions are listed on the start screen', async () => {
  asStudent();
  server({ ...SESSION, ['GET ' + P + '/current']: [200, { status: 'none' }],
    ['GET ' + P + '/history']: [200, [{ id: 2, category: 'aptitude', difficulty: 'Beginner', score: 3, total: 5, submitted_at: 1 }, { id: 1, category: 'programming', difficulty: 'Intermediate', score: 4, total: 5, submitted_at: 1 }]] });
  view('/student/practice');
  expect(await screen.findByText('aptitude (Beginner): 3 of 5')).toBeInTheDocument();
  expect(screen.getByText('programming (Intermediate): 4 of 5')).toBeInTheDocument();
});

test('exam pages are student-only and students get navigation links', async () => {
  tokenStore.set('tok-coordinator');
  server(SESSION);
  view('/student/practice');
  expect(await screen.findByRole('heading', { name: 'Coordinator dashboard' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Practice' })).toBeNull();
  cleanup();
  view('/student/assessment');
  expect(await screen.findByRole('heading', { name: 'Coordinator dashboard' })).toBeInTheDocument();
  cleanup();
  asStudent();
  server({ ...SESSION, ['GET ' + P + '/current']: [200, { status: 'none' }], ['GET ' + P + '/history']: [200, []] });
  view('/student/practice');
  await screen.findByRole('heading', { name: 'Practice' });
  for (const n of ['Dashboard', 'Assessment', 'Practice']) expect(screen.getByRole('link', { name: n })).toBeInTheDocument();
});

test('question text from the server is rendered as text, never as markup', async () => {
  asStudent();
  const evil = '<img src=x onerror=alert(1)>';
  server({ ...SESSION, ['GET ' + A]: [200, inProgress(600, {}, [{ id: 11, category: 'aptitude', text: evil, options: ['<b>x</b>', 'y'] }])] });
  view('/student/assessment');
  expect(await screen.findByText(evil, { exact: false })).toBeInTheDocument();
  expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('label b')).toBeNull();
});
