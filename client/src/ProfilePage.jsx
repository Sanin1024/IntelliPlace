import { useEffect, useState } from 'react';
import { Shell } from './Layout';
import { api } from './api';

const PHONE = /^[0-9+\-\s]{7,20}$/;
const blank = { department: '', year: '', cgpa: '', phone: '', skills: '' };

function toForm(p) {
  return {
    department: p.department ?? '',
    year: p.year == null ? '' : String(p.year),
    cgpa: p.cgpa == null ? '' : String(p.cgpa),
    phone: p.phone ?? '',
    skills: (p.skills || []).join(', ')
  };
}

function buildBody(f) {
  const body = {};
  const dep = f.department.trim();
  if (dep) {
    if (dep.length > 100) return { error: 'Department is too long' };
    body.department = dep;
  }
  const year = f.year.trim();
  if (year) {
    const n = Number(year);
    if (!Number.isInteger(n) || n < 1 || n > 6) return { error: 'Year must be a whole number from 1 to 6' };
    body.year = n;
  }
  const cg = f.cgpa.trim();
  if (cg) {
    const n = Number(cg);
    if (!Number.isFinite(n) || n < 0 || n > 10) return { error: 'CGPA must be a number from 0 to 10' };
    body.cgpa = n;
  }
  const ph = f.phone.trim();
  if (ph) {
    if (!PHONE.test(ph)) return { error: 'Phone must be 7-20 characters: digits, +, - or spaces' };
    body.phone = ph;
  }
  const skills = f.skills.split(',').map(s => s.trim()).filter(Boolean);
  if (skills.length > 20 || skills.some(s => s.length > 50)) return { error: 'Up to 20 skills, each up to 50 characters' };
  body.skills = skills;
  return { body };
}

export function ProfilePage() {
  const [p, setP] = useState(null);
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api('/student/profile')
      .then(d => { if (live) { setP(d); setF(toForm(d)); } })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const set = k => e => { const v = e.target.value; setSaved(false); setF(prev => ({ ...prev, [k]: v })); };

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    const r = buildBody(f);
    if (r.error) { setError(r.error); return; }
    setBusy(true);
    try {
      const d = await api('/student/profile', { method: 'PUT', body: r.body });
      setP(d);
      setF(toForm(d));
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (!p) {
    body = error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading...</p>;
  } else {
    body = (
      <>
        <section>
          <h2>Verified by the system</h2>
          <dl><dt>Level</dt><dd>{p.level ?? 'not assessed'}</dd></dl>
          <p className="note">Your level comes from the initial assessment and cannot be edited.</p>
        </section>
        <section>
          <h2>Self-reported details</h2>
          <p className="note">You enter these yourself; they are not verified. A blank field keeps its current value.</p>
          <form onSubmit={save} noValidate>
            <label>Department<input value={f.department} onChange={set('department')} /></label>
            <label>Year of study<input inputMode="numeric" value={f.year} onChange={set('year')} /></label>
            <label>CGPA<input inputMode="decimal" value={f.cgpa} onChange={set('cgpa')} /></label>
            <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
            <label>Skills (comma separated)<input value={f.skills} onChange={set('skills')} /></label>
            {error && <p role="alert" className="error">{error}</p>}
            {saved && <p role="status">Profile saved</p>}
            <button type="submit" disabled={busy}>Save profile</button>
          </form>
        </section>
      </>
    );
  }
  return <Shell title="Profile">{body}</Shell>;
}
