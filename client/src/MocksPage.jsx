import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from './Layout';
import { Runner } from './Runner';
import { api } from './api';

const M = '/mocks';

function Result({ r, onBack }) {
  return (
    <section>
      <h2>Mock test complete</h2>
      <p>{`${r.title}: ${r.score} of ${r.total}`}</p>
      <ul aria-label="Section scores">
        {r.sections.map(s => <li key={s.section}>{`${s.section}: ${s.score} of ${s.total}`}</li>)}
      </ul>
      <ol className="review">
        {r.review.map(x => (
          <li key={x.question_id}>
            <p>{`${x.section}: ${x.text}`}</p>
            <ul>
              {x.options.map((o, j) => {
                const marks = [];
                if (j === x.selected_index) marks.push('your answer');
                if (j === x.correct_index) marks.push('correct answer');
                return <li key={j} className={j === x.correct_index ? 'ok' : j === x.selected_index ? 'bad' : ''}>{o + (marks.length ? ` (${marks.join(', ')})` : '')}</li>;
              })}
            </ul>
            <p>{x.correct ? 'Correct' : x.selected_index == null ? 'Not answered' : 'Incorrect'}</p>
          </li>
        ))}
      </ol>
      <button type="button" onClick={onBack}>Back to mock tests</button>
    </section>
  );
}

export function MocksPage() {
  const [st, setSt] = useState(null);
  const [mocks, setMocks] = useState(null);
  const [listError, setListError] = useState('');
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [needsAssessment, setNeedsAssessment] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadHistory = () => api(M + '/attempts/history').then(setHistory).catch(() => {});

  useEffect(() => {
    let live = true;
    api(M + '/current').then(d => { if (live) setSt(d); }).catch(e => { if (live) setError(e.message); });
    api(M).then(d => { if (live) setMocks(d); }).catch(e => { if (live) setListError(e.message); });
    api(M + '/attempts/history').then(h => { if (live) setHistory(h); }).catch(() => {});
    return () => { live = false; };
  }, []);

  async function start(id) {
    setBusy(true);
    setError('');
    setNeedsAssessment(false);
    try { setSt(await api(`${M}/${id}/start`, { method: 'POST' })); }
    catch (e) {
      setError(e.message);
      setNeedsAssessment(e.status === 403 && /initial assessment/i.test(e.message));
    } finally { setBusy(false); }
  }

  let body;
  if (!st) {
    body = error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading...</p>;
  } else if (st.status === 'in_progress') {
    body = (
      <Runner
        key={st.attempt_id}
        questions={st.questions.map(q => ({ ...q, text: `${q.section}: ${q.text}` }))}
        initialAnswers={st.answers}
        remainingSeconds={st.remaining_seconds}
        save={(qid, idx) => api(`${M}/attempts/${st.attempt_id}/answer`, { method: 'PUT', body: { questionId: qid, selectedIndex: idx } })}
        submit={() => api(`${M}/attempts/${st.attempt_id}/submit`, { method: 'POST' })}
        onDone={r => { setSt(r); loadHistory(); }}
      />
    );
  } else if (st.status === 'completed') {
    body = <Result r={st} onBack={() => { setSt({ status: 'none' }); setError(''); }} />;
  } else {
    body = (
      <section>
        {listError
          ? <p role="alert" className="error">{listError}</p>
          : mocks === null ? <p role="status">Loading...</p>
          : mocks.length ? mocks.map(m => (
            <article key={m.id} className="drive" aria-label={m.title}>
              <h2>{m.title}</h2>
              <p>{m.company ? `Company: ${m.company}` : 'General practice test'}</p>
              <p>{`${m.total_questions} questions, ${m.duration_minutes} minutes`}</p>
              <p>{`Sections: ${m.sections.map(s => `${s.name} (${s.questions})`).join(', ')}`}</p>
              <button type="button" disabled={busy} aria-label={`Start ${m.title}`} onClick={() => start(m.id)}>Start</button>
            </article>
          ))
          : <p>No mock tests are available yet.</p>}
        <h2>Recent attempts</h2>
        {history.length
          ? <ul>{history.slice(0, 10).map(h => <li key={h.id}>{`${h.title}: ${h.score} of ${h.total}`}</li>)}</ul>
          : <p>No attempts yet.</p>}
      </section>
    );
  }
  return (
    <Shell title="Mock tests">
      {body}
      {st && error && <p role="alert" className="error">{error}</p>}
      {needsAssessment && <p><Link to="/student/assessment">Take the initial assessment</Link></p>}
    </Shell>
  );
}
