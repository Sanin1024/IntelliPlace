import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { AppRoutes } from './App';
import { tokenStore } from './api';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const STUDENT = { id: 1, name: 'Asha', email: 'asha@t.com', role: 'student' };
const SESSION = { 'GET /api/auth/me': [200, STUDENT], 'POST /api/auth/logout': [200, { ok: true }] };
const GET = 'GET /api/student/profile';
const PUT = 'PUT /api/student/profile';
const PROFILE = { department: 'CSE', year: 3, cgpa: 8.5, phone: '9876543210', skills: ['Java', 'SQL'], level: 'Intermediate', level_source: 'system_assessment' };
const EMPTY = { department: null, year: null, cgpa: null, phone: null, skills: [], level: null, level_source: null };

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
const view = () => render(<MemoryRouter initialEntries={['/student/profile']}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
const login = () => tokenStore.set('tok-student');
const putCalls = calls => calls.filter(c => c.key === PUT);

test('shows the verified level read-only and prefills the self-reported fields', async () => {
  login();
  server({ ...SESSION, [GET]: [200, PROFILE] });
  view();
  expect(await screen.findByLabelText('Department')).toHaveValue('CSE');
  expect(screen.getByLabelText('Year of study')).toHaveValue('3');
  expect(screen.getByLabelText('CGPA')).toHaveValue('8.5');
  expect(screen.getByLabelText('Phone')).toHaveValue('9876543210');
  expect(screen.getByLabelText('Skills (comma separated)')).toHaveValue('Java, SQL');
  expect(screen.getByText('Intermediate')).toBeInTheDocument();
  expect(screen.queryByLabelText(/level/i)).toBeNull();
});

test('saving sends typed values, trims skills, and shows the server response', async () => {
  login();
  const calls = server({ ...SESSION, [GET]: [200, PROFILE], [PUT]: [200, { ...PROFILE, cgpa: 9, skills: ['Go', 'SQL'] }] });
  view();
  const user = userEvent.setup();
  const cg = await screen.findByLabelText('CGPA');
  await user.clear(cg);
  await user.type(cg, '9');
  const sk = screen.getByLabelText('Skills (comma separated)');
  await user.clear(sk);
  await user.type(sk, ' Go ,, SQL ');
  await user.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(await screen.findByText('Profile saved')).toBeInTheDocument();
  expect(putCalls(calls)[0].body).toEqual({ department: 'CSE', year: 3, cgpa: 9, phone: '9876543210', skills: ['Go', 'SQL'] });
  expect(screen.getByLabelText('Skills (comma separated)')).toHaveValue('Go, SQL');
  expect(putCalls(calls)[0].headers.authorization).toBe('Bearer tok-student');
});

test('the verified level is never sent to the server', async () => {
  login();
  const calls = server({ ...SESSION, [GET]: [200, PROFILE], [PUT]: [200, PROFILE] });
  view();
  await screen.findByLabelText('Department');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
  expect(await screen.findByText('Profile saved')).toBeInTheDocument();
  expect(Object.keys(putCalls(calls)[0].body).sort()).toEqual(['cgpa', 'department', 'phone', 'skills', 'year']);
});

test('only filled fields are sent, and an unassessed level is shown as such', async () => {
  login();
  const calls = server({ ...SESSION, [GET]: [200, EMPTY], [PUT]: [200, { ...EMPTY, department: 'ECE' }] });
  view();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Department'), 'ECE');
  expect(screen.getByText('not assessed')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(await screen.findByText('Profile saved')).toBeInTheDocument();
  expect(putCalls(calls)[0].body).toEqual({ department: 'ECE', skills: [] });
});

test('local validation blocks bad values before any request', async () => {
  login();
  const calls = server({ ...SESSION, [GET]: [200, PROFILE], [PUT]: [200, PROFILE] });
  view();
  await screen.findByLabelText('Department');
  const set = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  set('Year of study', '9'); save();
  expect(screen.getByText('Year must be a whole number from 1 to 6')).toBeInTheDocument();
  set('Year of study', '3'); set('CGPA', '11'); save();
  expect(screen.getByText('CGPA must be a number from 0 to 10')).toBeInTheDocument();
  set('CGPA', '8.5'); set('Phone', 'abc'); save();
  expect(screen.getByText('Phone must be 7-20 characters: digits, +, - or spaces')).toBeInTheDocument();
  set('Phone', '9876543210'); set('Skills (comma separated)', Array.from({ length: 21 }, (_, i) => 's' + i).join(',')); save();
  expect(screen.getByText('Up to 20 skills, each up to 50 characters')).toBeInTheDocument();
  expect(putCalls(calls)).toHaveLength(0);
});

test('a server rejection is shown and nothing is reported as saved', async () => {
  login();
  server({ ...SESSION, [GET]: [200, PROFILE], [PUT]: [400, { error: 'Invalid cgpa' }] });
  view();
  await screen.findByLabelText('Department');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid cgpa');
  expect(screen.queryByText('Profile saved')).toBeNull();
});

test('profile load error is shown instead of the form', async () => {
  login();
  server({ ...SESSION, [GET]: [500, { error: 'Server error' }] });
  view();
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  expect(screen.queryByLabelText('Department')).toBeNull();
});
