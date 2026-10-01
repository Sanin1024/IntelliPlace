import { useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const STATUS = { idle: '', saving: 'Saving...', saved: 'All answers saved', error: 'Not saved' };

export function Runner({ questions, initialAnswers, remainingSeconds, save, submit, onDone }) {
  const [answers, setAnswers] = useState(() => ({ ...(initialAnswers || {}) }));
  const [left, setLeft] = useState(remainingSeconds);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const latest = useRef({ ...(initialAnswers || {}) });
  const confirmed = useRef({ ...(initialAnswers || {}) });
  const inflight = useRef(new Map());
  const finishing = useRef(false);
  const expired = useRef(false);
  const autoTried = useRef(false);
  const deadline = useRef(Date.now() + remainingSeconds * 1000);
  const fns = useRef({});
  fns.current = { save, submit, onDone };

  const unsynced = () => Object.keys(latest.current).filter(k => confirmed.current[k] !== latest.current[k]);

  function refreshStatus() {
    if (inflight.current.size) setStatus('saving');
    else if (unsynced().length) setStatus('error');
    else { setStatus('saved'); setError(''); }
  }

  function sync(key) {
    const k = String(key);
    const running = inflight.current.get(k);
    if (running) return running;
    setStatus('saving');
    const p = (async () => {
      try {
        while (confirmed.current[k] !== latest.current[k]) {
          const v = latest.current[k];
          await fns.current.save(Number(k), v);
          confirmed.current[k] = v;
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          expired.current = true;
          if (!finishing.current) finish(true);
        } else {
          setError('Could not save your answer. It will be retried when you answer again or submit.');
        }
      }
    })().finally(() => { inflight.current.delete(k); refreshStatus(); });
    inflight.current.set(k, p);
    return p;
  }

  async function finish(auto) {
    if (finishing.current) return;
    finishing.current = true;
    setSubmitting(true);
    setError('');
    try {
      if (!auto) {
        await Promise.all(unsynced().map(k => sync(k)));
        if (unsynced().length && !expired.current) throw new Error('Some answers could not be saved. Check your connection and try again.');
      }
      await Promise.allSettled([...inflight.current.values()]);
      const result = await fns.current.submit();
      fns.current.onDone(result);
    } catch (e) {
      finishing.current = false;
      setSubmitting(false);
      setError(e.message);
    }
  }

  function choose(qid, idx) {
    if (finishing.current) return;
    latest.current = { ...latest.current, [qid]: idx };
    setAnswers(latest.current);
    sync(qid);
  }

  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (left <= 0 && !autoTried.current) { autoTried.current = true; finish(true); }
  }, [left]);

  const answered = questions.filter(q => answers[q.id] !== undefined).length;
  return (
    <div className="runner">
      <div className="runner-bar">
        <span role="timer" className={left <= 60 ? 'warn' : ''}>Time left: {fmt(left)}</span>
        <span>Answered {answered} of {questions.length}</span>
        <span aria-live="polite">{STATUS[status]}</span>
      </div>
      {questions.map((q, i) => (
        <fieldset key={q.id} disabled={submitting}>
          <legend>{i + 1}. {q.text}</legend>
          {q.options.map((o, j) => (
            <label key={j} className="opt">
              <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === j} onChange={() => choose(q.id, j)} />
              {o}
            </label>
          ))}
        </fieldset>
      ))}
      {error && <p role="alert" className="error">{error}</p>}
      <button type="button" onClick={() => finish(false)} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit'}</button>
    </div>
  );
}
