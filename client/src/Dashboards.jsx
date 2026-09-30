import { Shell } from './Layout';
import { useLoad } from './hooks';

const label = s => String(s).replace(/_/g, ' ');

function Async({ state, children }) {
  if (state.loading) return <p role="status">Loading...</p>;
  if (state.error) return <p role="alert" className="error">{state.error}</p>;
  return children(state.data);
}

export function StudentDashboard() {
  const state = useLoad('/analytics/me');
  return (
    <Shell title="Student dashboard">
      <Async state={state}>
        {d => {
          const v = d.verified;
          return (
            <>
              {!v.level && <p>You have not taken the initial assessment yet.</p>}
              <dl>
                <dt>Level</dt><dd>{v.level ?? 'not assessed'}</dd>
                <dt>Readiness score</dt><dd>{v.readiness.score ?? 'n/a'}</dd>
                <dt>Readiness band</dt><dd>{label(v.readiness.band)}</dd>
              </dl>
              <h2>Weak areas</h2>
              {v.weak_categories.length
                ? <ul>{v.weak_categories.map(c => <li key={c}>{c}</li>)}</ul>
                : <p>None identified yet.</p>}
              <p className="note">Verified by the IntelliPlace server from graded assessments.</p>
            </>
          );
        }}
      </Async>
    </Shell>
  );
}

export function CoordinatorDashboard() {
  const state = useLoad('/analytics/cohort');
  return (
    <Shell title="Coordinator dashboard">
      <Async state={state}>
        {d => (
          <>
            <dl>
              <dt>Students</dt><dd>{d.students}</dd>
              <dt>Assessed</dt><dd>{d.assessed}</dd>
              <dt>Average readiness</dt><dd>{d.readiness.average_score ?? 'n/a'}</dd>
            </dl>
            <h2>Readiness bands</h2>
            <ul>{Object.entries(d.readiness.bands).map(([b, n]) => <li key={b}>{label(b)}: {n}</li>)}</ul>
          </>
        )}
      </Async>
    </Shell>
  );
}

export function AdminDashboard() {
  const state = useLoad('/admin/users?limit=200');
  return (
    <Shell title="Administration">
      <Async state={state}>
        {users => {
          const byRole = {};
          users.forEach(u => { byRole[u.role] = (byRole[u.role] || 0) + 1; });
          return (
            <>
              <dl>
                <dt>Total accounts</dt><dd>{users.length}</dd>
                <dt>Disabled accounts</dt><dd>{users.filter(u => u.disabled).length}</dd>
              </dl>
              <ul>{Object.entries(byRole).map(([r, n]) => <li key={r}>{r}: {n}</li>)}</ul>
              {users.length >= 200 && <p className="note">Showing the first 200 accounts.</p>}
            </>
          );
        }}
      </Async>
    </Shell>
  );
}
