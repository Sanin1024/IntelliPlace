import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from './Layout';
import { Runner } from './Runner';
import { api } from './api';

const P = '/student/practice';

function Review({ r, onAgain }) {
  return (
    <section>
      <h2>Practice complete</h2>
      <p>Score: {r.score} of {r.total} ({r.category}, {r.difficulty})</p>
      <ol className="review">
        {r.review.map(x => (
          <li key={x.question_id}>
            <p>{x.text}</p>
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
      <button type="button" onClick={onAgain}>Practice again</button>
    </section>
  );
}

export function PracticePage() {
  const [st, setSt] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [needsAssessment, setNeedsAssessment] = useState(false);
  const [form, setForm] = useState({ category: 'aptitude', difficulty: '' });
  const [busy, setBusy] = useState(false);

  const loadHistory = () => api(P + '/history').then(setHistory).catch(() => {});

  useEffect(() => {
    let live = true;
    api(P + '/current').then(d => { if (live) setSt(d); }).catch(e => { if (live) setError(e.message); });
    api(P + '/history').then(h => { if (live) setHistory(h); }).catch(() => {});
    return () => { live = false; };
  }, []);

  async function start() {
    setBusy(true);
    setError('');
    setNeedsAssessment(false);
    const body = { category: form.category };
    if (form.difficulty) body.difficulty = form.difficulty;
    try { setSt(await api(P + '/start', { method: 'POST', body })); }
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
        key={st.session_id}
        questions={st.questions}
        initialAnswers={st.answers}
        remainingSeconds={st.remaining_seconds}
        save={(qid, idx) => api(`${P}/${st.session_id}/answer`, { method: 'PUT', body: { questionId: qid, selectedIndex: idx } })}
        submit={() => api(`${P}/${st.session_id}/submit`, { method: 'POST' })}
        onDone={r => { setSt(r); loadHistory(); }}
      />
    );
  } else if (st.status === 'completed') {
    body = <Review r={st} onAgain={() => { setSt({ status: 'none' }); setError(''); }} />;
  } else {
    body = (
      <section>
        <p>Practice questions are matched to your verified level.</p>
        <label>Category
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            <option value="aptitude">aptitude</option>
            <option value="programming">programming</option>
          </select>
        </label>
        <label>Difficulty
          <select value={form.difficulty} onChange={e => setForm({ ...form, difficulty: e.target.value })}>
            <option value="">At my level</option>
            <option value="Beginner">Beginner</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Advanced">Advanced</option>
          </select>
        </label>
        <button type="button" onClick={start} disabled={busy}>Start practice</button>
        <h2>Recent sessions</h2>
        {history.length
          ? <ul>{history.slice(0, 10).map(h => <li key={h.id}>{h.category} ({h.difficulty}): {h.score} of {h.total}</li>)}</ul>
          : <p>No sessions yet.</p>}
      </section>
    );
  }
  return (
    <Shell title="Practice">
      {body}
      {st && error && <p role="alert" className="error">{error}</p>}
      {needsAssessment && <p><Link to="/student/assessment">Take the initial assessment</Link></p>}
    </Shell>
  );
}
