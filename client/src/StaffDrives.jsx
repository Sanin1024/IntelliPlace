import { useEffect, useState } from 'react';
import { Shell } from './Layout';
import { api } from './api';

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const blank = { company: '', role: '', description: '', min_cgpa: '', departments: '', min_year: '', max_year: '', level: '', skills: '', deadline: '' };
const list = s => s.split(',').map(x => x.trim()).filter(Boolean);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function criteria(d) {
  const out = [];
  if (d.min_cgpa != null) out.push(`Minimum CGPA ${d.min_cgpa}`);
  if (d.allowed_departments.length) out.push(`Departments: ${d.allowed_departments.join(', ')}`);
  if (d.min_year != null && d.max_year != null) out.push(`Years ${d.min_year}-${d.max_year}`);
  else if (d.min_year != null) out.push(`Year ${d.min_year} or above`);
  else if (d.max_year != null) out.push(`Year ${d.max_year} or below`);
  if (d.required_level) out.push(`Level ${d.required_level} or above`);
  if (d.required_skills.length) out.push(`Skills: ${d.required_skills.join(', ')}`);
  return out.length ? out.join(' | ') : 'none';
}

function buildDrive(f) {
  const company = f.company.trim();
  const role = f.role.trim();
  if (!company || !role) return { error: 'Company and role are required' };
  if (company.length > 100 || role.length > 100) return { error: 'Company and role must be 100 characters or fewer' };
  if (!DATE.test(f.deadline)) return { error: 'A deadline date is required' };
  const body = { company, role, deadline: `${f.deadline}T23:59:59.000Z` };
  const desc = f.description.trim();
  if (desc) {
    if (desc.length > 1000) return { error: 'Description must be 1000 characters or fewer' };
    body.description = desc;
  }
  const cg = f.min_cgpa.trim();
  if (cg) {
    const n = Number(cg);
    if (!Number.isFinite(n) || n < 0 || n > 10) return { error: 'Minimum CGPA must be a number from 0 to 10' };
    body.min_cgpa = n;
  }
  for (const [k, label] of [['min_year', 'Minimum year'], ['max_year', 'Maximum year']]) {
    const v = f[k].trim();
    if (v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 6) return { error: `${label} must be a whole number from 1 to 6` };
      body[k] = n;
    }
  }
  if (body.min_year != null && body.max_year != null && body.min_year > body.max_year) return { error: 'Minimum year cannot exceed maximum year' };
  const deps = list(f.departments);
  if (deps.length > 20 || deps.some(x => x.length > 100)) return { error: 'Up to 20 departments, each up to 100 characters' };
  if (deps.length) body.allowed_departments = deps;
  const skills = list(f.skills);
  if (skills.length > 20 || skills.some(x => x.length > 100)) return { error: 'Up to 20 skills, each up to 100 characters' };
  if (skills.length) body.required_skills = skills;
  if (f.level) body.required_level = f.level;
  return { body };
}

function DriveRow({ drive, onChange }) {
  const [apps, setApps] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (apps) return;
    setError('');
    try { setApps(await api(`/drives/${drive.id}/applications`)); }
    catch (e) { setError(e.message); }
  }

  async function close() {
    setBusy(true);
    setError('');
    try {
      const d = await api(`/drives/${drive.id}/close`, { method: 'POST' });
      onChange(drive.id, { status: d.status });
      setConfirming(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="drive" aria-label={`${drive.company} - ${drive.role}`}>
      <h2>{drive.company} - {drive.role}</h2>
      <p>{`Status: ${drive.status}`}</p>
      <p>{`Deadline: ${String(drive.deadline).slice(0, 10)}`}</p>
      <p>{`Applications: ${drive.application_count}`}</p>
      <p>{`Criteria: ${criteria(drive)}`}</p>
      <button type="button" onClick={toggle}>{open ? 'Hide applications' : 'Show applications'}</button>
      {drive.status === 'open' && !confirming && (
        <button type="button" onClick={() => setConfirming(true)}>Close drive</button>
      )}
      {drive.status === 'open' && confirming && (
        <>
          <button type="button" disabled={busy} onClick={close}>Confirm close</button>
          <button type="button" onClick={() => { setConfirming(false); setError(''); }}>Cancel</button>
        </>
      )}
      {open && apps && (apps.length
        ? <ul>{apps.map(a => <li key={a.id}>{`${a.name} (${a.email}) - applied ${new Date(a.applied_at).toISOString().slice(0, 10)}`}</li>)}</ul>
        : <p>No applications yet.</p>)}
      {error && <p role="alert" className="error">{error}</p>}
    </article>
  );
}

export function StaffDrivesPage() {
  const [drives, setDrives] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState(blank);
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api('/drives').then(d => { if (live) setDrives(d); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const set = k => e => { const v = e.target.value; setCreated(false); setF(p => ({ ...p, [k]: v })); };
  const update = (id, patch) => setDrives(ds => ds.map(d => (d.id === id ? { ...d, ...patch } : d)));

  async function create(e) {
    e.preventDefault();
    setFormError('');
    setCreated(false);
    const r = buildDrive(f);
    if (r.error) { setFormError(r.error); return; }
    setBusy(true);
    try {
      const d = await api('/drives', { method: 'POST', body: r.body });
      setDrives(ds => [...ds, { ...d, application_count: 0 }]);
      setF(blank);
      setCreated(true);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (!drives) {
    body = error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading...</p>;
  } else {
    body = (
      <>
        <section>
          <h2>Create a drive</h2>
          <form onSubmit={create} noValidate>
            <label>Company<input value={f.company} onChange={set('company')} /></label>
            <label>Role<input value={f.role} onChange={set('role')} /></label>
            <label>Description<input value={f.description} onChange={set('description')} /></label>
            <label>Minimum CGPA<input inputMode="decimal" value={f.min_cgpa} onChange={set('min_cgpa')} /></label>
            <label>Allowed departments (comma separated)<input value={f.departments} onChange={set('departments')} /></label>
            <label>Minimum year<input inputMode="numeric" value={f.min_year} onChange={set('min_year')} /></label>
            <label>Maximum year<input inputMode="numeric" value={f.max_year} onChange={set('max_year')} /></label>
            <label>Required level
              <select value={f.level} onChange={set('level')}>
                <option value="">No minimum</option>
                {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label>Required skills (comma separated)<input value={f.skills} onChange={set('skills')} /></label>
            <label>Deadline<input type="date" value={f.deadline} onChange={set('deadline')} /></label>
            {formError && <p role="alert" className="error">{formError}</p>}
            {created && <p role="status">Drive created</p>}
            <button type="submit" disabled={busy}>Create drive</button>
          </form>
        </section>
        <h2>All drives</h2>
        {drives.length ? drives.map(d => <DriveRow key={d.id} drive={d} onChange={update} />) : <p>No drives yet.</p>}
      </>
    );
  }
  return <Shell title="Manage drives">{body}</Shell>;
}
