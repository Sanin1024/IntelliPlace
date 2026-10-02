import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from './Layout';
import { api } from './api';

const YEARS = [
  { key: 'start_year', label: 'Start year', kind: 'year' },
  { key: 'end_year', label: 'End year', kind: 'year' }
];
const SECTIONS = [
  { key: 'education', single: 'Education', title: 'Education', max: 5, fields: [
    { key: 'institution', label: 'Institution', req: true, max: 150 },
    { key: 'degree', label: 'Degree', req: true, max: 150 },
    ...YEARS,
    { key: 'grade', label: 'Grade', max: 50 }] },
  { key: 'projects', single: 'Project', title: 'Projects', max: 10, fields: [
    { key: 'title', label: 'Title', req: true, max: 100 },
    { key: 'description', label: 'Description', max: 500 },
    { key: 'tech', label: 'Technologies (comma separated)', kind: 'list' },
    { key: 'link', label: 'Link', kind: 'url' }] },
  { key: 'experience', single: 'Experience', title: 'Experience', max: 10, fields: [
    { key: 'organization', label: 'Organization', req: true, max: 100 },
    { key: 'role', label: 'Role', req: true, max: 100 },
    ...YEARS,
    { key: 'description', label: 'Description', max: 500 }] },
  { key: 'certifications', single: 'Certification', title: 'Certifications', max: 10, fields: [
    { key: 'name', label: 'Name', req: true, max: 100 },
    { key: 'issuer', label: 'Issuer', max: 100 },
    { key: 'year', label: 'Year', kind: 'year' }] }
];

const toRow = (sec, item) => Object.fromEntries(sec.fields.map(f => [f.key,
  f.kind === 'list' ? (item[f.key] || []).join(', ') : item[f.key] == null ? '' : String(item[f.key])]));
const blankRow = sec => Object.fromEntries(sec.fields.map(f => [f.key, '']));

function toForm(s) {
  const f = { headline: s.headline ?? '', summary: s.summary ?? '' };
  for (const sec of SECTIONS) f[sec.key] = (s[sec.key] || []).map(it => toRow(sec, it));
  return f;
}

function buildItem(sec, row, n) {
  const where = `${sec.single} ${n}`;
  const out = {};
  for (const f of sec.fields) {
    const v = (row[f.key] ?? '').trim();
    if (!v) {
      if (f.req) return { error: `${where}: ${f.label} is required` };
      continue;
    }
    if (f.kind === 'year') {
      const y = Number(v);
      if (!Number.isInteger(y) || y < 1950 || y > 2100) return { error: `${where}: ${f.label} must be a year from 1950 to 2100` };
      out[f.key] = y;
    } else if (f.kind === 'list') {
      const l = v.split(',').map(s => s.trim()).filter(Boolean);
      if (l.length > 10 || l.some(s => s.length > 30)) return { error: `${where}: up to 10 entries, each up to 30 characters` };
      if (l.length) out[f.key] = l;
    } else if (f.kind === 'url') {
      if (v.length > 300 || !/^https?:\/\/\S+$/i.test(v)) return { error: `${where}: ${f.label} must start with http:// or https://` };
      out[f.key] = v;
    } else {
      if (v.length > f.max) return { error: `${where}: ${f.label} must be ${f.max} characters or fewer` };
      out[f.key] = v;
    }
  }
  if (out.start_year != null && out.end_year != null && out.start_year > out.end_year) return { error: `${where}: start year cannot be after end year` };
  return { out };
}

function buildBody(f) {
  const headline = f.headline.trim();
  const summary = f.summary.trim();
  if (headline.length > 120) return { error: 'Headline must be 120 characters or fewer' };
  if (summary.length > 1000) return { error: 'Summary must be 1000 characters or fewer' };
  const body = { headline, summary };
  for (const sec of SECTIONS) {
    const items = [];
    for (let i = 0; i < f[sec.key].length; i++) {
      const r = buildItem(sec, f[sec.key][i], i + 1);
      if (r.error) return r;
      items.push(r.out);
    }
    body[sec.key] = items;
  }
  return { body };
}

export function ResumePage() {
  const [ver, setVer] = useState(null);
  const [skills, setSkills] = useState([]);
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = d => { setVer(d.verified); setSkills(d.self_reported.skills || []); setF(toForm(d.self_reported)); };

  useEffect(() => {
    let live = true;
    api('/resume').then(d => { if (live) apply(d); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const edit = (k, v) => { setSaved(false); setF(p => ({ ...p, [k]: v })); };
  const editRow = (sk, i, fk, v) => { setSaved(false); setF(p => ({ ...p, [sk]: p[sk].map((r, j) => (j === i ? { ...r, [fk]: v } : r)) })); };
  const addRow = sec => { setSaved(false); setF(p => ({ ...p, [sec.key]: [...p[sec.key], blankRow(sec)] })); };
  const removeRow = (sk, i) => { setSaved(false); setF(p => ({ ...p, [sk]: p[sk].filter((_, j) => j !== i) })); };

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    const r = buildBody(f);
    if (r.error) { setError(r.error); return; }
    setBusy(true);
    try {
      apply(await api('/resume', { method: 'PUT', body: r.body }));
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportResume(withVerified) {
    setError('');
    const w = window.open('', '_blank');
    if (!w) { setError('Pop-up blocked. Allow pop-ups for this site and try again.'); return; }
    try {
      const html = await api('/resume/export' + (withVerified ? '' : '?verified=0'), { raw: true });
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      w.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      w.close();
      setError(err.message);
    }
  }

  if (!f) {
    return <Shell title="Resume">{error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading...</p>}</Shell>;
  }
  return (
    <Shell title="Resume">
      <section>
        <h2>Verified by the system</h2>
        <p>{`Level: ${ver.level ?? 'not assessed'}`}</p>
        <p>{`Readiness: ${ver.readiness.score ?? 'n/a'} (${String(ver.readiness.band).replace(/_/g, ' ')})`}</p>
        {ver.categories.length
          ? <ul>{ver.categories.map(c => <li key={c.category}>{`${c.category}: ${c.accuracy}% over ${c.questions} questions`}</li>)}</ul>
          : <p>No graded results yet.</p>}
        <p className="note">These results come from graded assessments and cannot be edited. They appear on your exported resume unless you leave them out.</p>
      </section>
      <p>{`Skills (from your profile): ${skills.length ? skills.join(', ') : 'none'}`} <Link to="/student/profile">Edit profile</Link></p>
      <section>
        <h2>Self-reported content</h2>
        <p className="note">You write these sections yourself; they are not verified.</p>
        <form onSubmit={save} noValidate>
          <label>Headline<input value={f.headline} onChange={e => edit('headline', e.target.value)} /></label>
          <label>Summary<textarea value={f.summary} onChange={e => edit('summary', e.target.value)} /></label>
          {SECTIONS.map(sec => (
            <fieldset key={sec.key}>
              <legend>{sec.title}</legend>
              {f[sec.key].map((row, i) => (
                <div key={i} className="row" role="group" aria-label={`${sec.single} ${i + 1}`}>
                  {sec.fields.map(fl => (
                    <label key={fl.key}>{`${sec.single} ${i + 1} ${fl.label}`}
                      <input value={row[fl.key]} onChange={e => editRow(sec.key, i, fl.key, e.target.value)} />
                    </label>
                  ))}
                  <button type="button" aria-label={`Remove ${sec.single.toLowerCase()} ${i + 1}`} onClick={() => removeRow(sec.key, i)}>Remove</button>
                </div>
              ))}
              <button type="button" disabled={f[sec.key].length >= sec.max} onClick={() => addRow(sec)}>{`Add ${sec.single.toLowerCase()}`}</button>
            </fieldset>
          ))}
          {error && <p role="alert" className="error">{error}</p>}
          {saved && <p role="status">Resume saved</p>}
          <button type="submit" disabled={busy}>Save resume</button>
        </form>
      </section>
      <section>
        <h2>Export</h2>
        <p className="note">Opens a print-ready page in a new tab. Use your browser's print option to save it as a PDF.</p>
        <button type="button" onClick={() => exportResume(true)}>Export with verified results</button>
        <button type="button" onClick={() => exportResume(false)}>Export without verified results</button>
      </section>
    </Shell>
  );
}
