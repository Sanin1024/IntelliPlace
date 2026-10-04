import { useEffect, useRef, useState } from 'react';
import { Shell } from './Layout';
import { api } from './api';

const iso = ts => (Number.isFinite(ts) ? new Date(ts).toISOString() : '');

export function AdminAuditPage() {
  const [ver, setVer] = useState(null);
  const [verError, setVerError] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [headMsg, setHeadMsg] = useState('');
  const [headError, setHeadError] = useState('');
  const [check, setCheck] = useState(null);
  const fileRef = useRef(null);

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

  async function exportHead() {
    setHeadError('');
    setHeadMsg('');
    setCheck(null);
    try {
      const h = await api('/admin/audit/head');
      const blob = new Blob([JSON.stringify(h, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-head-${h.count}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setHeadMsg(`Saved audit head for ${h.count} entries. Keep this file somewhere separate from the server.`);
    } catch (e) {
      setHeadError(e.message);
    }
  }

  async function checkHead(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setHeadError('');
    setHeadMsg('');
    setCheck(null);
    let saved;
    try {
      saved = JSON.parse(await file.text());
    } catch {
      setHeadError('That file is not a valid saved audit head.');
      return;
    }
    try {
      setCheck(await api('/admin/audit/check-head', { method: 'POST', body: { count: saved.count, head: saved.head } }));
    } catch (err) {
      setHeadError(err.message);
    }
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
        <h2>Saved head</h2>
        <p className="note">The chain alone cannot show that the newest entries were deleted. Export the head regularly, keep the file somewhere separate from this server, and check the log against it later.</p>
        <button type="button" onClick={exportHead}>Export head</button>
        <label>Check against a saved head
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={checkHead} />
        </label>
        {headMsg && <p role="status">{headMsg}</p>}
        {headError && <p role="alert" className="error">{headError}</p>}
        {check && (check.result === 'matches'
          ? <p role="status">{`Consistent: ${check.message}`}</p>
          : <p role="alert" className="error">{`${check.result === 'truncated' ? 'Truncated' : 'Diverged'}: ${check.message}`}</p>)}
      </section>
      <section>
        <h2>Latest entries</h2>
        {list}
      </section>
    </Shell>
  );
}
