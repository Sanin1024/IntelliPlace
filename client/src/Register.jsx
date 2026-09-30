import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { HOME } from './roles';

export function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => { const v = e.target.value; setF(p => ({ ...p, [k]: v })); };

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!f.name.trim() || !f.email.trim()) { setError('Name and email are required'); return; }
    if (f.password.length < 8 || f.password.length > 128) { setError('Password must be 8-128 characters'); return; }
    if (f.password !== f.confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      const u = await register(f.name.trim(), f.email.trim(), f.password);
      nav(HOME[u.role] || '/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <h1>Create account</h1>
      <p className="note">Student accounts only. Staff accounts are created by an administrator.</p>
      <form onSubmit={submit} noValidate>
        <label>Name<input value={f.name} autoComplete="name" onChange={set('name')} /></label>
        <label>Email<input type="email" value={f.email} autoComplete="username" onChange={set('email')} /></label>
        <label>Password<input type="password" value={f.password} autoComplete="new-password" onChange={set('password')} /></label>
        <label>Confirm password<input type="password" value={f.confirm} autoComplete="new-password" onChange={set('confirm')} /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
      </form>
      <p>Already registered? <Link to="/login">Sign in</Link></p>
    </main>
  );
}
