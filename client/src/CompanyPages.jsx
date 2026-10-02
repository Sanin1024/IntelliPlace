import { Link, useParams } from 'react-router-dom';
import { Shell } from './Layout';
import { useLoad } from './hooks';

const SAFE = /^https?:\/\/\S+$/i;
const day = d => String(d).slice(0, 10);

export function CompaniesPage() {
  const { data, error, loading } = useLoad('/companies');
  let body;
  if (loading) body = <p role="status">Loading...</p>;
  else if (error) body = <p role="alert" className="error">{error}</p>;
  else if (!data.length) body = <p>No companies yet.</p>;
  else {
    body = data.map(c => (
      <article key={c.id} className="drive" aria-label={c.name}>
        <h2>{c.name}</h2>
        <p>{`Focus: ${c.focus.length ? c.focus.join(', ') : 'none'}`}</p>
        <p>{`${c.resource_count} ${c.resource_count === 1 ? 'resource' : 'resources'}`}</p>
        <p><Link to={`/student/companies/${c.id}`}>View preparation</Link></p>
      </article>
    ));
  }
  return <Shell title="Companies">{body}</Shell>;
}

export function CompanyPrepPage() {
  const { id } = useParams();
  const { data, error, loading } = useLoad(`/companies/${encodeURIComponent(id)}/prep`);
  let body;
  if (loading) body = <p role="status">Loading...</p>;
  else if (error) body = <p role="alert" className="error">{error}</p>;
  else {
    body = (
      <>
        <h2>{data.company.name}</h2>
        <p>{`Focus areas: ${data.company.focus.length ? data.company.focus.join(', ') : 'none'}`}</p>
        <section>
          <h3>Your readiness (verified)</h3>
          {data.readiness.length
            ? <ul>{data.readiness.map(r => (
              <li key={r.category}>{`${r.category}: ${r.accuracy == null ? 'no graded practice yet' : r.accuracy + '% accuracy'}${r.needs_work ? ' (needs work)' : ''}`}</li>
            ))}</ul>
            : <p>No focus areas set.</p>}
          <p className="note">Based on your graded practice sessions.</p>
        </section>
        <section>
          <h3>Resources</h3>
          {data.resources.length
            ? <ul>{data.resources.map(r => (r.kind === 'link' && SAFE.test(r.content)
              ? <li key={r.id}>{`${r.title} (link): `}<a href={r.content} target="_blank" rel="noopener noreferrer">{r.content}</a></li>
              : <li key={r.id}>{`${r.title} (${r.kind}): ${r.content}`}</li>))}</ul>
            : <p>No resources yet.</p>}
        </section>
        <section>
          <h3>Mock tests</h3>
          {data.mocks.length
            ? <><ul>{data.mocks.map(m => <li key={m.id}>{`${m.title} - ${m.total_questions} questions, ${m.duration_minutes} minutes`}</li>)}</ul>
              <p><Link to="/student/mocks">Go to mock tests</Link></p></>
            : <p>No mock tests for this company yet.</p>}
        </section>
        <section>
          <h3>Drives</h3>
          {data.drives.length
            ? <><ul>{data.drives.map(d => (
              <li key={d.id}>{`${d.role} - ${d.status}, deadline ${day(d.deadline)}: ${d.eligible ? 'Eligible' : `Not eligible (${d.failed_rules.join(', ')})`}`}</li>
            ))}</ul>
              <p><Link to="/student/drives">Go to drives</Link></p></>
            : <p>No drives for this company yet.</p>}
        </section>
      </>
    );
  }
  return <Shell title="Company preparation">{body}</Shell>;
}
