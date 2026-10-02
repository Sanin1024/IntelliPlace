import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const RES = 'GET /api/resume';
const PUT = 'PUT /api/resume';
const EXP = 'GET /api/resume/export';
const SELF = {
  source: 'self_reported', name: 'Asha', email: 'asha@t.com', phone: '9876543210', department: 'CSE', year: 3, cgpa: 8.5, skills: ['SQL', 'Node.js'],
  headline: 'Aspiring engineer', summary: 'Final-year CSE student.',
  education: [{ institution: 'ABC College', degree: 'B.Tech CSE', start_year: 2022, end_year: 2026, grade: '8.5 CGPA' }],
  projects: [{ title: 'IntelliPlace', description: 'Placement system', tech: ['Node.js', 'SQLite'], link: 'https://github.com/x/y' }],
  experience: [], certifications: []
};
const VER = {
  source: 'system_verified', level: 'Intermediate', readiness: { score: 64, band: 'developing', confidence: 'high' },
  categories: [{ category: 'aptitude', accuracy: 80, questions: 15 }, { category: 'programming', accuracy: 52.9, questions: 17 }]
};
const FULL = { self_reported: SELF, verified: VER };

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
const view = () => render(<MemoryRouter initialEntries={['/student/resume']}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
const login = () => tokenStore.set('tok-student');
const set = (label, v) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const click = name => fireEvent.click(screen.getByRole('button', { name }));
const putCalls = calls => calls.filter(c => c.key === PUT);
const loaded = () => screen.findByLabelText('Headline');
const stubExport = w => {
  vi.stubGlobal('open', vi.fn(() => w));
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
};

test('loads the saved resume into the editor and shows verified results separately', async () => {
  login();
  server({ ...SESSION, [RES]: [200, FULL] });
  view();
  expect(await loaded()).toHaveValue('Aspiring engineer');
  expect(screen.getByLabelText('Summary')).toHaveValue('Final-year CSE student.');
  expect(screen.getByLabelText('Education 1 Institution')).toHaveValue('ABC College');
  expect(screen.getByLabelText('Education 1 Start year')).toHaveValue('2022');
  expect(screen.getByLabelText('Project 1 Technologies (comma separated)')).toHaveValue('Node.js, SQLite');
  expect(screen.getByLabelText('Project 1 Link')).toHaveValue('https://github.com/x/y');
  expect(screen.queryByLabelText('Experience 1 Organization')).toBeNull();
  expect(screen.getByText('Level: Intermediate')).toBeInTheDocument();
  expect(screen.getByText('Readiness: 64 (developing)')).toBeInTheDocument();
  expect(screen.getByText('aptitude: 80% over 15 questions')).toBeInTheDocument();
  expect(screen.getByText('programming: 52.9% over 17 questions')).toBeInTheDocument();
  expect(screen.getByText('Skills (from your profile): SQL, Node.js')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/student/profile');
});

test('saving sends every section and shows the server response', async () => {
  login();
  const calls = server({ ...SESSION, [RES]: [200, FULL], [PUT]: [200, { self_reported: { ...SELF, headline: 'New headline' }, verified: VER }] });
  view();
  await loaded();
  set('Headline', ' New headline ');
  click('Save resume');
  expect(await screen.findByText('Resume saved')).toBeInTheDocument();
  expect(putCalls(calls)[0].body).toEqual({
    headline: 'New headline', summary: 'Final-year CSE student.',
    education: [{ institution: 'ABC College', degree: 'B.Tech CSE', start_year: 2022, end_year: 2026, grade: '8.5 CGPA' }],
    projects: [{ title: 'IntelliPlace', description: 'Placement system', tech: ['Node.js', 'SQLite'], link: 'https://github.com/x/y' }],
    experience: [], certifications: []
  });
  expect(putCalls(calls)[0].headers.authorization).toBe('Bearer tok-student');
  expect(screen.getByLabelText('Headline')).toHaveValue('New headline');
});

test('rows can be added and removed before saving', async () => {
  login();
  const calls = server({ ...SESSION, [RES]: [200, FULL], [PUT]: [200, FULL] });
  view();
  await loaded();
  click('Add certification');
  set('Certification 1 Name', ' AWS Cloud ');
  set('Certification 1 Issuer', 'Amazon');
  set('Certification 1 Year', '2025');
  click('Add experience');
  set('Experience 1 Organization', 'Acme');
  set('Experience 1 Role', 'Intern');
  set('Experience 1 Description', 'Built dashboards');
  click('Remove education 1');
  expect(screen.queryByLabelText('Education 1 Institution')).toBeNull();
  click('Save resume');
  expect(await screen.findByText('Resume saved')).toBeInTheDocument();
  const b = putCalls(calls)[0].body;
  expect(b.certifications).toEqual([{ name: 'AWS Cloud', issuer: 'Amazon', year: 2025 }]);
  expect(b.experience).toEqual([{ organization: 'Acme', role: 'Intern', description: 'Built dashboards' }]);
  expect(b.education).toEqual([]);
});

test('the add button stops at the section limit', async () => {
  login();
  server({ ...SESSION, [RES]: [200, FULL] });
  view();
  await loaded();
  for (let i = 0; i < 4; i++) click('Add education');
  expect(screen.getByLabelText('Education 5 Institution')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add education' })).toBeDisabled();
});

test('local validation blocks bad rows before any request', async () => {
  login();
  const calls = server({ ...SESSION, [RES]: [200, FULL], [PUT]: [200, FULL] });
  view();
  await loaded();
  click('Add education');
  click('Save resume');
  expect(screen.getByText('Education 2: Institution is required')).toBeInTheDocument();
  set('Education 2 Institution', 'X');
  click('Save resume');
  expect(screen.getByText('Education 2: Degree is required')).toBeInTheDocument();
  set('Education 2 Degree', 'Y');
  set('Education 2 Start year', '1900');
  click('Save resume');
  expect(screen.getByText('Education 2: Start year must be a year from 1950 to 2100')).toBeInTheDocument();
  set('Education 2 Start year', '2030');
  set('Education 2 End year', '2020');
  click('Save resume');
  expect(screen.getByText('Education 2: start year cannot be after end year')).toBeInTheDocument();
  click('Remove education 2');
  click('Add project');
  set('Project 2 Title', 'P');
  set('Project 2 Link', 'javascript:alert(1)');
  click('Save resume');
  expect(screen.getByText('Project 2: Link must start with http:// or https://')).toBeInTheDocument();
  set('Project 2 Link', 'https://ok.example');
  set('Project 2 Technologies (comma separated)', 'a,b,c,d,e,f,g,h,i,j,k');
  click('Save resume');
  expect(screen.getByText('Project 2: up to 10 entries, each up to 30 characters')).toBeInTheDocument();
  expect(putCalls(calls)).toHaveLength(0);
});

test('headline and summary length limits are enforced locally', async () => {
  login();
  const calls = server({ ...SESSION, [RES]: [200, FULL], [PUT]: [200, FULL] });
  view();
  await loaded();
  set('Headline', 'x'.repeat(121));
  click('Save resume');
  expect(screen.getByText('Headline must be 120 characters or fewer')).toBeInTheDocument();
  set('Headline', 'ok');
  set('Summary', 'x'.repeat(1001));
  click('Save resume');
  expect(screen.getByText('Summary must be 1000 characters or fewer')).toBeInTheDocument();
  expect(putCalls(calls)).toHaveLength(0);
});

test('a server rejection is shown and nothing is reported as saved', async () => {
  login();
  server({ ...SESSION, [RES]: [200, FULL], [PUT]: [400, { error: 'Invalid projects' }] });
  view();
  await loaded();
  click('Save resume');
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid projects');
  expect(screen.queryByText('Resume saved')).toBeNull();
});

test('export with verified results fetches the page with the token and opens it', async () => {
  login();
  const w = { location: { href: '' }, close: vi.fn() };
  stubExport(w);
  const calls = server({ ...SESSION, [RES]: [200, FULL], [EXP]: [200, '<html></html>'] });
  view();
  await loaded();
  click('Export with verified results');
  await waitFor(() => expect(w.location.href).toBe('blob:x'));
  expect(window.open).toHaveBeenCalledWith('', '_blank');
  expect(calls.find(c => c.key === EXP).headers.authorization).toBe('Bearer tok-student');
  const blob = URL.createObjectURL.mock.calls[0][0];
  expect(blob).toBeInstanceOf(Blob);
  expect(blob.type).toBe('text/html');
  expect(w.close).not.toHaveBeenCalled();
});

test('export without verified results asks the server to leave them out', async () => {
  login();
  const w = { location: { href: '' }, close: vi.fn() };
  stubExport(w);
  const calls = server({ ...SESSION, [RES]: [200, FULL], [EXP + '?verified=0']: [200, '<html></html>'] });
  view();
  await loaded();
  click('Export without verified results');
  await waitFor(() => expect(w.location.href).toBe('blob:x'));
  expect(calls.some(c => c.key === EXP)).toBe(false);
  expect(calls.some(c => c.key === EXP + '?verified=0')).toBe(true);
});

test('a blocked pop-up is reported and nothing is requested', async () => {
  login();
  stubExport(null);
  const calls = server({ ...SESSION, [RES]: [200, FULL], [EXP]: [200, '<html></html>'] });
  view();
  await loaded();
  click('Export with verified results');
  expect(await screen.findByRole('alert')).toHaveTextContent('Pop-up blocked. Allow pop-ups for this site and try again.');
  expect(calls.some(c => c.key.startsWith(EXP))).toBe(false);
});

test('a failed export closes the blank window and shows the error', async () => {
  login();
  const w = { location: { href: '' }, close: vi.fn() };
  stubExport(w);
  server({ ...SESSION, [RES]: [200, FULL], [EXP]: [500, { error: 'Server error' }] });
  view();
  await loaded();
  click('Export with verified results');
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  expect(w.close).toHaveBeenCalledTimes(1);
  expect(w.location.href).toBe('');
});

test('the resume page is student-only and students get the new links', async () => {
  tokenStore.set('tok-coordinator');
  server(SESSION);
  view();
  expect(await screen.findByRole('heading', { name: 'Coordinator dashboard' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Resume' })).toBeNull();
});

test('students see Resume and Companies in the navigation', async () => {
  login();
  server({ ...SESSION, [RES]: [200, FULL] });
  view();
  await loaded();
  expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/student/resume');
  expect(screen.getByRole('link', { name: 'Companies' })).toHaveAttribute('href', '/student/companies');
});
