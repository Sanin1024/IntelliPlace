const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { audit } = require('../audit');
const { RANK } = require('../eligibility');

const CATS = ['aptitude', 'programming'];
const LEVELS = Object.keys(RANK);
const SIZE = 5;
const DURATION_MS = 20 * 60 * 1000;

module.exports = function practiceRoutes(db) {
  const r = express.Router();
  const guard = [requireAuth(db), requireRole('student')];
  const levelOf = uid => db.prepare('select level from student_profiles where user_id = ?').get(uid)?.level ?? null;
  const owned = (uid, id) => /^\d+$/.test(String(id))
    ? db.prepare("select * from attempts where id = ? and user_id = ? and kind = 'practice'").get(Number(id), uid) : undefined;
  const items = a => db.prepare(`select q.id, q.text, q.options, q.correct_index c, aa.selected_index s
    from attempt_questions aq join questions q on q.id = aq.question_id
    left join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
    where aq.attempt_id = ? order by aq.position`).all(a.id);

  function state(a) {
    const base = { session_id: a.id, category: a.category, difficulty: a.difficulty };
    const it = items(a);
    if (a.submitted_at) {
      return { status: 'completed', ...base, score: a.score, total: a.total,
        review: it.map(x => ({ question_id: x.id, text: x.text, options: JSON.parse(x.options),
          selected_index: x.s ?? null, correct_index: x.c, correct: x.s === x.c })) };
    }
    return { status: 'in_progress', ...base,
      remaining_seconds: Math.max(0, Math.ceil((a.deadline - Date.now()) / 1000)),
      questions: it.map(x => ({ id: x.id, text: x.text, options: JSON.parse(x.options) })),
      answers: Object.fromEntries(it.filter(x => x.s != null).map(x => [x.id, x.s])) };
  }

  function finalize(a) {
    const it = items(a);
    const score = it.filter(x => x.s === x.c).length;
    const info = db.prepare('update attempts set submitted_at = ?, score = ?, total = ? where id = ? and submitted_at is null')
      .run(Date.now(), score, it.length, a.id);
    if (info.changes === 1) {
      audit(db, { actorId: a.user_id, action: 'practice.submit', entity: 'attempt', entityId: a.id,
        details: { category: a.category, difficulty: a.difficulty, score, total: it.length, auto: Date.now() >= a.deadline } });
    }
    return db.prepare('select * from attempts where id = ?').get(a.id);
  }

  function active(uid) {
    const a = db.prepare("select * from attempts where user_id = ? and kind = 'practice' and submitted_at is null order by id desc limit 1").get(uid);
    if (a && Date.now() >= a.deadline) { finalize(a); return undefined; }
    return a;
  }

  r.post('/practice/start', ...guard, (req, res) => {
    const uid = req.user.id;
    const cur = active(uid);
    if (cur) return res.json(state(cur));
    const lvl = levelOf(uid);
    if (!lvl) return res.status(403).json({ error: 'Complete the initial assessment first' });
    const { category, difficulty } = req.body || {};
    if (!CATS.includes(category)) return res.status(400).json({ error: 'Invalid category' });
    const diff = difficulty === undefined ? lvl : difficulty;
    if (!LEVELS.includes(diff)) return res.status(400).json({ error: 'Invalid difficulty' });
    if (RANK[diff] > RANK[lvl] + 1) return res.status(403).json({ error: 'Difficulty too high for your level' });
    const ids = db.prepare("select id from questions where purpose = 'practice' and category = ? and difficulty = ? order by random() limit ?")
      .all(category, diff, SIZE);
    if (!ids.length) return res.status(503).json({ error: 'No questions available' });
    const now = Date.now();
    const sid = db.transaction(() => {
      const info = db.prepare("insert into attempts(user_id, kind, started_at, deadline, category, difficulty) values(?, 'practice', ?, ?, ?, ?)")
        .run(uid, now, now + DURATION_MS, category, diff);
      const id = Number(info.lastInsertRowid);
      const ins = db.prepare('insert into attempt_questions(attempt_id, question_id, position) values(?, ?, ?)');
      ids.forEach((q, i) => ins.run(id, q.id, i + 1));
      return id;
    })();
    audit(db, { actorId: uid, action: 'practice.start', entity: 'attempt', entityId: sid, details: { category, difficulty: diff } });
    res.status(201).json(state(db.prepare('select * from attempts where id = ?').get(sid)));
  });

  r.get('/practice/current', ...guard, (req, res) => {
    const a = active(req.user.id);
    res.json(a ? state(a) : { status: 'none' });
  });

  r.put('/practice/:id/answer', ...guard, (req, res) => {
    let a = owned(req.user.id, req.params.id);
    if (!a) return res.status(404).json({ error: 'Session not found' });
    if (!a.submitted_at && Date.now() >= a.deadline) a = finalize(a);
    if (a.submitted_at) return res.status(409).json({ error: 'Session closed' });
    const { questionId, selectedIndex } = req.body || {};
    const q = Number.isInteger(questionId) && db.prepare(`select q.options from attempt_questions aq
      join questions q on q.id = aq.question_id where aq.attempt_id = ? and aq.question_id = ?`).get(a.id, questionId);
    if (!q) return res.status(400).json({ error: 'Question not in this session' });
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= JSON.parse(q.options).length)
      return res.status(400).json({ error: 'Invalid option' });
    db.prepare(`insert into attempt_answers(attempt_id, question_id, selected_index, saved_at) values(?, ?, ?, ?)
      on conflict(attempt_id, question_id) do update set selected_index = excluded.selected_index, saved_at = excluded.saved_at`)
      .run(a.id, questionId, selectedIndex, Date.now());
    res.json({ saved: true, remaining_seconds: Math.max(0, Math.ceil((a.deadline - Date.now()) / 1000)) });
  });

  r.post('/practice/:id/submit', ...guard, (req, res) => {
    let a = owned(req.user.id, req.params.id);
    if (!a) return res.status(404).json({ error: 'Session not found' });
    if (!a.submitted_at) a = finalize(a);
    res.json(state(a));
  });

  r.get('/practice/history', ...guard, (req, res) => {
    res.json(db.prepare(`select id, category, difficulty, score, total, submitted_at from attempts
      where user_id = ? and kind = 'practice' and submitted_at is not null order by id desc`).all(req.user.id));
  });

  r.get('/performance', ...guard, (req, res) => {
    const uid = req.user.id;
    const lvl = levelOf(uid);
    const initial = db.prepare("select score, total, level from attempts where user_id = ? and kind = 'initial' and submitted_at is not null").get(uid) || null;
    const p = db.prepare('select department, year, cgpa, skills from student_profiles where user_id = ?').get(uid);
    const sessions = db.prepare("select category, difficulty, score, total from attempts where user_id = ? and kind = 'practice' and submitted_at is not null order by id").all(uid);
    const by = {};
    for (const c of CATS) {
      const ss = sessions.filter(s => s.category === c);
      const answered = ss.reduce((n, s) => n + s.total, 0);
      const correct = ss.reduce((n, s) => n + s.score, 0);
      const accuracy = answered ? Math.round(correct * 1000 / answered) / 10 : null;
      const lastTwo = ss.filter(s => s.difficulty === lvl).slice(-2);
      let rec;
      if (!lvl) rec = 'Complete the initial assessment first';
      else if (!ss.length) rec = `Start ${c} practice`;
      else if (lvl !== 'Advanced' && lastTwo.length === 2 && lastTwo.every(s => s.total && s.score / s.total >= 0.8))
        rec = `Strong at ${lvl}; try ${LEVELS[LEVELS.indexOf(lvl) + 1]} ${c}`;
      else if (accuracy < 50) rec = `Review ${c} fundamentals at ${lvl}`;
      else rec = `Keep practicing ${c}`;
      by[c] = { sessions: ss.length, answered, correct, accuracy, recommendation: rec };
    }
    const scored = CATS.filter(c => by[c].accuracy != null);
    const weakest = scored.length ? scored.reduce((a, b) => (by[b].accuracy < by[a].accuracy ? b : a)) : null;
    res.json({
      verified: { source: 'system_verified', level: lvl, initial_assessment: initial, practice: by,
        weakest_category: weakest, total_sessions: sessions.length },
      self_reported: { source: 'self_reported', department: p?.department ?? null, year: p?.year ?? null,
        cgpa: p?.cgpa ?? null, skills: p ? JSON.parse(p.skills) : [] }
    });
  });

  return r;
};
