import { useEffect, useState } from 'react';
import { Shell } from './Layout';
import { api } from './api';

const BANDS = ['ready', 'developing', 'not_ready', 'no_data'];
const label = s => String(s).replace(/_/g, ' ');

function selfText(s) {
  const parts = [s.department, s.year != null ? `year ${s.year}` : null, s.cgpa != null ? `CGPA ${s.cgpa}` : null].filter(Boolean);
  return parts.length ? parts.join(', ') : 'not provided';
}

function Detail({ d }) {
  const v = d.verified;
  const s = d.self_reported;
  return (
    <section aria-label="Student details">
      <h2>{`Details: ${d.student.name}`}</h2>
      <h3>Verified by the system</h3>
      <p>{`Level: ${v.level ?? 'not assessed'}`}</p>
      <p>{`Readiness: ${v.readiness.score ?? 'n/a'} (${label(v.readiness.band)}), confidence ${v.readiness.confidence ?? 'n/a'}`}</p>
      <ul>{v.readiness.components.map(c => <li key={c.name}>{`${label(c.name)}: ${c.percent}% (weight ${c.weight})`}</li>)}</ul>
      <ul>
        {v.categories.map(c => (
          <li key={c.category}>{`${c.category}: ${c.accuracy == null ? 'no data' : c.accuracy + '%'} over ${c.questions} questions${c.weak ? ' (weak)' : ''}`}</li>
        ))}
      </ul>
      <h3>Self-reported by the student</h3>
      <p>{`Department: ${s.department ?? 'not provided'}`}</p>
      <p>{`Year: ${s.year ?? 'not provided'}`}</p>
      <p>{`CGPA: ${s.cgpa ?? 'not provided'}`}</p>
      <p>{`Skills: ${s.skills.length ? s.skills.join(', ') : 'none'}`}</p>
      <p>{`Applications: ${d.applications}`}</p>
      <p className="note">Viewing this record is logged in the audit trail.</p>
    </section>
  );
}

export function StaffStudentsPage() {
  const [band, setBand] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    let live = true;
    setRows(null);
    setError('');
    setDetail(null);
    setDetailError('');
    api('/analytics/students' + (band ? `?band=${band}` : ''))
      .then(d => { if (live) setRows(d); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [band]);

  async function view(id) {
    setDetailError('');
    try { setDetail(await api(`/analytics/students/${id}`)); }
    catch (e) { setDetail(null); setDetailError(e.message); }
  }

  let list;
  if (!rows) list = error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading...</p>;
  else if (!rows.length) list = <p>No students match.</p>;
  else {
    list = (
      <table className="data">
        <thead>
          <tr>
            <th>Name</th><th>Email</th><th>Level (verified)</th><th>Readiness (verified)</th>
            <th>Weak areas (verified)</th><th>Self-reported</th><th>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.email}</td>
              <td>{s.level ?? 'not assessed'}</td>
              <td>{`${s.readiness.score ?? 'n/a'} (${label(s.readiness.band)})`}</td>
              <td>{s.weak_categories.length ? s.weak_categories.join(', ') : 'None'}</td>
              <td>{selfText(s.self_reported)}</td>
              <td><button type="button" aria-label={`View ${s.name}`} onClick={() => view(s.id)}>View</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <Shell title="Students">
      <label>Readiness band
        <select value={band} onChange={e => setBand(e.target.value)}>
          <option value="">All</option>
          {BANDS.map(b => <option key={b} value={b}>{label(b)}</option>)}
        </select>
      </label>
      {list}
      {detailError && <p role="alert" className="error">{detailError}</p>}
      {detail && <Detail d={detail} />}
    </Shell>
  );
}
