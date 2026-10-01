import { useEffect, useState } from 'react';
import { Shell } from './Layout';
import { useAuth } from './AuthContext';
import { api } from './api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blank = { name: '', email: '', role: 'coordinator', password: '' };

function statusText(u) {
  const s = [];
  if (u.disabled) s.push('Disabled');
  if (u.locked) s.push('Locked');
  return s.length ? s.join(', ') : 'Active';
}

function UserRow({ u, isMe, onChange, onMessage }) {
  const [resetting, setResetting] = useState(false);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(path, body, after) {
    setBusy(true);
    setError('');
    try {
      const r = await api(`/admin/users/${u.id}/${path}`, { method: 'POST', body });
      onChange(r);
      if (after) after();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function reset(e) {
    e.preventDefault();
    if (pw.length < 8 || pw.length > 128) { setError('Password must be 8-128 characters'); return; }
    act('reset-password', { password: pw }, () => {
      setResetting(false);
      setPw('');
      onMessage(`Password reset for ${u.email}. Their sessions were ended.`);
    });
  }

  return (
    <tr>
      <td>{u.name}</td>
      <td>{u.email}</td>
      <td>{u.role}</td>
      <td>{statusText(u)}</td>
      <td>
        {isMe ? <span>(you)</span> : (
          <>
            {u.disabled
              ? <button type="button" disabled={busy} aria-label={`Enable ${u.email}`} onClick={() => act('enable')}>Enable</button>
              : <button type="button" disabled={busy} aria-label={`Disable ${u.email}`} onClick={() => act('disable')}>Disable</button>}
            {u.locked && <button type="button" disabled={busy} aria-label={`Unlock ${u.email}`} onClick={() => act('unlock')}>Unlock</button>}
            <button type="button" aria-label={`Reset password for ${u.email}`} onClick={() => { setResetting(true); setError(''); }}>Reset password</button>
          </>
        )}
        {resetting && !isMe && (
          <form onSubmit={reset} noValidate>
            <label>{`New password for ${u.email}`}
              <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
            </label>
            <button type="submit" disabled={busy} aria-label={`Set password for ${u.email}`}>Set password</button>
            <button type="button" onClick={() => { setResetting(false); setPw(''); setError(''); }}>Cancel</button>
          </form>
        )}
        {error && <p role="alert" className="error">{error}</p>}
      </td>
    </tr>
  );
}

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [f, setF] = useState(blank);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api('/admin/users?limit=200').then(d => { if (live) setUsers(d); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const replace = r => setUsers(us => us.map(u => (u.id === r.id ? { ...u, ...r } : u)));
  const set = k => e => { const v = e.target.value; setF(p => ({ ...p, [k]: v })); };

  async function create(e) {
    e.preventDefault();
    setFormError('');
    setMessage('');
    const name = f.name.trim();
    const email = f.email.trim();
    if (!name || !email) { setFormError('Name and email are required'); return; }
    if (name.length > 100 || email.length > 254 || !EMAIL.test(email)) { setFormError('Enter a valid email address'); return; }
    if (f.password.length < 8 || f.password.length > 128) { setFormError('Password must be 8-128 characters'); return; }
    setBusy(true);
    try {
      const u = await api('/admin/users', { method: 'POST', body: { name, email, role: f.role, password: f.password } });
      setUsers(us => [...us, { ...u, disabled: false, locked: false }]);
      setF(blank);
      setMessage(`Created ${u.email}`);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (!users) {
    body = error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading...</p>;
  } else {
    body = (
      <>
        {message && <p role="status">{message}</p>}
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map(u => <UserRow key={u.id} u={u} isMe={me && u.id === me.id} onChange={replace} onMessage={setMessage} />)}
          </tbody>
        </table>
        <section>
          <h2>Create a staff account</h2>
          <form onSubmit={create} noValidate>
            <label>Name<input value={f.name} onChange={set('name')} /></label>
            <label>Email<input type="email" autoComplete="off" value={f.email} onChange={set('email')} /></label>
            <label>Role
              <select value={f.role} onChange={set('role')}>
                <option value="coordinator">coordinator</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label>Temporary password<input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></label>
            {formError && <p role="alert" className="error">{formError}</p>}
            <button type="submit" disabled={busy}>Create staff account</button>
          </form>
        </section>
      </>
    );
  }
  return <Shell title="Accounts">{body}</Shell>;
}
