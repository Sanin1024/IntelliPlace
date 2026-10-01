import { useEffect, useState } from 'react';
import { Shell } from './Layout';
import { api } from './api';

const iso = ts => (Number.isFinite(ts) ? new Date(ts).toISOString() : '');

export function AdminAuditPage() {
  const [ver, setVer] = useState(null);
  const [verError, setVerError] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api('/admin/audit/verify').then(d => { if (live) setVer(d); }).catch(e => { if (live) setVerError(e.message); });
    api('/admin/audit?limit=50').then(d => { if (live) setRows(d); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  async function verify() {
    setBusy(true);
    setVerError('');
    try { setVer(await api('/admin/audit/verify')); }
    catch (e) { setVerError(e.message); }
    finally { setBusy(false); }
  }

  let list;
  if (!rows) list = error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading...</p>;
  else if (!rows.length) list = <p>No entries yet.</p>;
  else {
    list = (
      <table className="data">
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{iso(r.ts)}</td>
              <td>{r.actor_id == null ? 'system' : String(r.actor_id)}</td>
              <td>{r.action}</td>
              <td>{r.entity ? `${r.entity} ${r.entity_id}` : '-'}</td>
              <td>{r.details ? JSON.stringify(r.details) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <Shell title="Audit log">
      <section>
        <h2>Chain integrity</h2>
        {verError && <p role="alert" className="error">{verError}</p>}
        {ver && (ver.valid
          ? <p role="status">{`Audit chain valid: ${ver.count} entries verified`}</p>
          : <p role="alert" className="error">{`Audit chain broken at entry ${ver.broken_at} (${ver.reason})`}</p>)}
        <button type="button" onClick={verify} disabled={busy}>Verify again</button>
      </section>
      <section>
        <h2>Latest entries</h2>
        {list}
      </section>
    </Shell>
  );
}
