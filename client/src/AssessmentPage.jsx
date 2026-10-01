import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from './Layout';
import { Runner } from './Runner';
import { api } from './api';

const BASE = '/student/assessment/initial';

export function AssessmentPage() {
  const [st, setSt] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api(BASE).then(d => { if (live) setSt(d); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  async function start() {
    setBusy(true);
    setError('');
    try { setSt(await api(BASE + '/start', { method: 'POST' })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  let body;
  if (!st) {
    body = error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading...</p>;
  } else if (st.status === 'completed') {
    body = (
      <section>
        <h2>Assessment complete</h2>
        <p>Score: {st.score} of {st.total}</p>
        <p>Your level: <strong>{st.level}</strong></p>
        <p className="note">The server assigned this level from your graded answers.</p>
        <p><Link to="/student/practice">Start practising</Link> | <Link to="/student">Back to dashboard</Link></p>
      </section>
    );
  } else if (st.status === 'in_progress') {
    body = (
      <Runner
        key={st.attempt_id}
        questions={st.questions}
        initialAnswers={st.answers}
        remainingSeconds={st.remaining_seconds}
        save={(qid, idx) => api(BASE + '/answer', { method: 'PUT', body: { questionId: qid, selectedIndex: idx } })}
        submit={() => api(BASE + '/submit', { method: 'POST' })}
        onDone={r => setSt(r)}
      />
    );
  } else {
    body = (
      <section>
        <p>This timed assessment takes about 15 minutes and can be taken once. Your answers are saved automatically, and the server decides your level from your graded answers. When time runs out, your saved answers are submitted for you.</p>
        <button type="button" onClick={start} disabled={busy}>Start assessment</button>
      </section>
    );
  }
  return (
    <Shell title="Initial assessment">
      {body}
      {st && error && <p role="alert" className="error">{error}</p>}
    </Shell>
  );
}
