import { Link } from 'react-router-dom';
import { Shell } from './Layout';
import { useLoad } from './hooks';

const LINKS = {
  initial_assessment: ['/student/assessment', 'Go to the assessment'],
  practice: ['/student/practice', 'Go to practice'],
  mock: ['/student/mocks', 'Go to mock tests'],
  apply: ['/student/drives', 'Go to drives'],
  drive_gap: ['/student/drives', 'Go to drives'],
  complete_profile: ['/student/profile', 'Update your profile']
};
const SOURCE = {
  system_verified: 'Based on verified results',
  self_reported: 'Based on self-reported details',
  mixed: 'Based on verified and self-reported details'
};
const label = s => String(s).replace(/_/g, ' ');

export function RecommendationsPage() {
  const { data, error, loading } = useLoad('/recommendations');
  let body;
  if (loading) body = <p role="status">Loading...</p>;
  else if (error) body = <p role="alert" className="error">{error}</p>;
  else {
    body = (
      <>
        <p>{`Verified level: ${data.level ?? 'not assessed'}`}</p>
        <p>{`Readiness band: ${label(data.readiness_band)}`}</p>
        {data.recommendations.length ? data.recommendations.map((r, i) => (
          <article key={`${r.type}-${i}`} className="drive" aria-label={r.title}>
            <h2>{r.title}</h2>
            <p><span className="badge">{`${r.priority} priority`}</span> <em className="tag">{SOURCE[r.source] ?? r.source}</em></p>
            <p>{r.reason}</p>
            {r.action && <p>{`Suggested: ${r.action}`}</p>}
            {r.deadline && <p>{`Deadline: ${String(r.deadline).slice(0, 10)}`}</p>}
            {r.missing_fields && <p>{`Missing: ${r.missing_fields.join(', ')}`}</p>}
            {r.mocks && <ul>{r.mocks.map(m => <li key={m.id}>{m.title}</li>)}</ul>}
            {LINKS[r.type] && <p><Link to={LINKS[r.type][0]}>{LINKS[r.type][1]}</Link></p>}
          </article>
        )) : <p>No recommendations right now.</p>}
      </>
    );
  }
  return <Shell title="Recommendations">{body}</Shell>;
}
