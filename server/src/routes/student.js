const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { audit } = require('../audit');

const KIND = 'initial';
const DURATION_MS = 15 * 60 * 1000;
const levelFor = (score, total) => {
  const p = total ? (score / total) * 100 : 0;
  return p < 40 ? 'Beginner' : p < 80 ? 'Intermediate' : 'Advanced';
};

function validateProfile(b) {
  const out = {};
  if (b.department !== undefined) {
    if (typeof b.department !== 'string' || !b.department.trim() || b.department.length > 100) return { error: 'Invalid department' };
    out.department = b.department.trim();
  }
  if (b.year !== undefined) {
    if (!Number.isInteger(b.year) || b.year < 1 || b.year > 6) return { error: 'Invalid year' };
    out.year = b.year;
  }
  if (b.cgpa !== undefined) {
    if (typeof b.cgpa !== 'number' || !Number.isFinite(b.cgpa) || b.cgpa < 0 || b.cgpa > 10) return { error: 'Invalid cgpa' };
    out.cgpa = b.cgpa;
  }
  if (b.phone !== undefined) {
    if (typeof b.phone !== 'string' || !/^[0-9+\-\s]{7,20}$/.test(b.phone)) return { error: 'Invalid phone' };
    out.phone = b.phone;
  }
  if (b.skills !== undefined) {
    if (!Array.isArray(b.skills) || b.skills.length > 20 ||
        b.skills.some(s => typeof s !== 'string' || !s.trim() || s.length > 50)) return { error: 'Invalid skills' };
    out.skills = JSON.stringify(b.skills.map(s => s.trim()));
  }
  if (!Object.keys(out).length) return { error: 'No valid fields provided' };
  return { out };
}

module.exports = function studentRoutes(db) {
  const r = express.Router();
  r.use(requireAuth(db), requireRole('student'));

  const getProfile = uid => db.prepare('select * from student_profiles where user_id = ?').get(uid);
  const shape = p => ({
    department: p?.department ?? null,
    year: p?.year ?? null,
    cgpa: p?.cgpa ?? null,
    phone: p?.phone ?? null,
    skills: p ? JSON.parse(p.skills) : [],
    self_reported: ['department', 'year', 'cgpa', 'phone', 'skills'],
    level: p?.level ?? null,
    level_source: p?.level_source ?? null
  });

  r.get('/profile', (req, res) => res.json(shape(getProfile(req.user.id))));

  r.put('/profile', (req, res) => {
    const { out, error } = validateProfile(req.body || {});
    if (error) return res.status(400).json({ error });
    const uid = req.user.id;
    db.prepare('insert or ignore into student_profiles(user_id) values(?)').run(uid);
    const cols = Object.keys(out);
    db.prepare(`update student_profiles set ${cols.map(c => c + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP where user_id = ?`)
      .run(...cols.map(c => out[c]), uid);
    audit(db, { actorId: uid, action: 'profile.update', entity: 'profile', entityId: uid, details: { fields: cols } });
    res.json(shape(getProfile(uid)));
  });

  const getAttempt = uid => db.prepare('select * from attempts where user_id = ? and kind = ?').get(uid, KIND);

  function finalize(a) {
    const rows = db.prepare(`select q.correct_index c, aa.selected_index s from attempt_questions aq
      join questions q on q.id = aq.question_id
      left join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
      where aq.attempt_id = ?`).all(a.id);
    const total = rows.length;
    const score = rows.filter(x => x.s === x.c).length;
    const level = levelFor(score, total);
    db.transaction(() => {
      db.prepare('update attempts set submitted_at = ?, score = ?, total = ?, level = ? where id = ? and submitted_at is null')
        .run(Date.now(), score, total, level, a.id);
      db.prepare('insert or ignore into student_profiles(user_id) values(?)').run(a.user_id);
      db.prepare("update student_profiles set level = ?, level_source = 'system_assessment', updated_at = CURRENT_TIMESTAMP where user_id = ?")
        .run(level, a.user_id);
    })();
    audit(db, { actorId: a.user_id, action: 'assessment.submit', entity: 'attempt', entityId: a.id, details: { score, total, level, auto: Date.now() >= a.deadline } });
    return db.prepare('select * from attempts where id = ?').get(a.id);
  }

  function current(uid) {
    let a = getAttempt(uid);
    if (a && !a.submitted_at && Date.now() >= a.deadline) a = finalize(a);
    return a;
  }

  const remaining = a => Math.max(0, Math.ceil((a.deadline - Date.now()) / 1000));

  function state(a) {
    if (a.submitted_at) return { status: 'completed', score: a.score, total: a.total, level: a.level };
    const questions = db.prepare(`select q.id, q.category, q.text, q.options from attempt_questions aq
      join questions q on q.id = aq.question_id where aq.attempt_id = ? order by aq.position`)
      .all(a.id).map(q => ({ ...q, options: JSON.parse(q.options) }));
    const answers = Object.fromEntries(
      db.prepare('select question_id, selected_index from attempt_answers where attempt_id = ?').all(a.id)
        .map(x => [x.question_id, x.selected_index]));
    return { status: 'in_progress', attempt_id: a.id, remaining_seconds: remaining(a), questions, answers };
  }

  r.get('/assessment/initial', (req, res) => {
    const a = current(req.user.id);
    res.json(a ? state(a) : { status: 'not_started' });
  });

  r.post('/assessment/initial/start', (req, res) => {
    const uid = req.user.id;
    const existing = current(uid);
    if (existing) {
      return existing.submitted_at
        ? res.status(409).json({ error: 'Initial assessment already completed' })
        : res.json(state(existing));
    }
    const ids = db.prepare("select id from questions where purpose = 'initial' order by id").all();
    if (!ids.length) return res.status(503).json({ error: 'Assessment not available' });
    const now = Date.now();
    db.transaction(() => {
      const info = db.prepare('insert into attempts(user_id, kind, started_at, deadline) values(?, ?, ?, ?)')
        .run(uid, KIND, now, now + DURATION_MS);
      const ins = db.prepare('insert into attempt_questions(attempt_id, question_id, position) values(?, ?, ?)');
      ids.forEach((q, i) => ins.run(Number(info.lastInsertRowid), q.id, i + 1));
    })();
    const att = getAttempt(uid);
    audit(db, { actorId: uid, action: 'assessment.start', entity: 'attempt', entityId: att.id });
    res.status(201).json(state(att));
  });

  r.put('/assessment/initial/answer', (req, res) => {
    const a = current(req.user.id);
    if (!a) return res.status(404).json({ error: 'Assessment not started' });
    if (a.submitted_at) return res.status(409).json({ error: 'Assessment closed' });
    const { questionId, selectedIndex } = req.body || {};
    const q = Number.isInteger(questionId) && db.prepare(`select q.options from attempt_questions aq
      join questions q on q.id = aq.question_id where aq.attempt_id = ? and aq.question_id = ?`).get(a.id, questionId);
    if (!q) return res.status(400).json({ error: 'Question not in this assessment' });
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= JSON.parse(q.options).length)
      return res.status(400).json({ error: 'Invalid option' });
    db.prepare(`insert into attempt_answers(attempt_id, question_id, selected_index, saved_at) values(?, ?, ?, ?)
      on conflict(attempt_id, question_id) do update set selected_index = excluded.selected_index, saved_at = excluded.saved_at`)
      .run(a.id, questionId, selectedIndex, Date.now());
    res.json({ saved: true, remaining_seconds: remaining(a) });
  });

  r.post('/assessment/initial/submit', (req, res) => {
    let a = getAttempt(req.user.id);
    if (!a) return res.status(404).json({ error: 'Assessment not started' });
    if (!a.submitted_at) a = finalize(a);
    res.json(state(a));
  });

  return r;
};
module.exports.levelFor = levelFor;
