import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from './Layout';
import { api } from './api';

const sourceLabel = s => (s === 'self_reported' ? 'Self-reported' : 'Verified by system');

function Rules({ rules }) {
  const fixable = rules.some(r => !r.passed && r.source === 'self_reported');
  return (
    <>
      <ul className="rules">
        {rules.map(r => (
          <li key={r.rule} className={r.passed ? 'ok' : 'bad'}>
            <strong>{r.passed ? 'Met' : 'Not met'}</strong> <span>{r.message}</span> <em className="tag">{sourceLabel(r.source)}</em>
          </li>
        ))}
      </ul>
      {fixable && <p><Link to="/student/profile">Update your profile</Link></p>}
    </>
  );
}

function DriveCard({ drive, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (rules) return;
    setBusy(true);
    setError('');
    try { setRules((await api(`/drives/${drive.id}/eligibility`)).rules); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true);
    setError('');
    try {
      await api(`/drives/${drive.id}/apply`, { method: 'POST' });
      onUpdate(drive.id, { applied: true });
    } catch (e) {
      if (e.status === 409) {
        onUpdate(drive.id, { applied: true });
      } else {
        setError(e.message);
        if (e.status === 403) {
          const rs = e.body && e.body.rules;
          if (rs) setRules(rs);
          onUpdate(drive.id, rs ? { eligible: false, failed_count: rs.filter(r => !r.passed).length } : { eligible: false });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const badge = drive.applied ? 'Applied'
    : drive.status !== 'open' ? 'Closed'
    : drive.eligible ? 'Eligible' : `Not eligible (${drive.failed_count})`;
  const canApply = drive.eligible && !drive.applied && drive.status === 'open' && rules;
  return (
    <article className="drive" aria-label={`${drive.company} - ${drive.role}`}>
      <h2>{drive.company} - {drive.role}</h2>
      <p><span className="badge">{badge}</span> <span>Deadline: {String(drive.deadline).slice(0, 10)}</span></p>
      {drive.description && <p>{drive.description}</p>}
      <button type="button" onClick={toggle} aria-expanded={open}>{open ? 'Hide details' : 'Show details'}</button>
      {open && (
        <div>
          {busy && !rules && <p role="status">Loading...</p>}
          {rules && <Rules rules={rules} />}
          {canApply && <button type="button" onClick={apply} disabled={busy}>Apply</button>}
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </article>
  );
}

export function DrivesPage() {
  const [drives, setDrives] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api('/drives/available')
      .then(d => { if (live) setDrives(d); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const update = (id, patch) => setDrives(ds => ds.map(d => (d.id === id ? { ...d, ...patch } : d)));

  let body;
  if (!drives) body = error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading...</p>;
  else if (!drives.length) body = <p>No drives are available right now.</p>;
  else body = drives.map(d => <DriveCard key={d.id} drive={d} onUpdate={update} />);
  return <Shell title="Placement drives">{body}</Shell>;
}
