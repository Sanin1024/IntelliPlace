const express = require('express');
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { CATS, pct, r1, verifiedView, selfReported } = require('../readiness');

const BANDS = ['ready', 'developing', 'not_ready', 'no_data'];

module.exports = function analyticsRoutes(db) {
  const r = express.Router();
  const staff = requireRole('coordinator', 'admin');
  const student = requireRole('student');
  const students = () => db.prepare("select id, name, email from users where role = 'student' order by id").all();

  r.get('/me', student, (req, res) => {
    res.json({ verified: verifiedView(db, req.user.id), self_reported: selfReported(db, req.user.id) });
  });

  r.get('/cohort', staff, (req, res) => {
    const list = students();
    const bands = { ready: 0, developing: 0, not_ready: 0, no_data: 0 };
    const levels = { Beginner: 0, Intermediate: 0, Advanced: 0, unassessed: 0 };
    const weak = Object.fromEntries(CATS.map(c => [c, 0]));
    const scores = [];
    for (const s of list) {
      const v = verifiedView(db, s.id);
      bands[v.readiness.band]++;
      levels[v.level ?? 'unassessed']++;
      if (v.readiness.score != null) scores.push(v.readiness.score);
      for (const c of v.weak_categories) weak[c]++;
    }
    const pooled = db.prepare(`select q.category, count(*) n,
        sum(case when aa.selected_index = q.correct_index then 1 else 0 end) c
      from users u
      join attempts a on a.user_id = u.id and a.submitted_at is not null
      join attempt_questions aq on aq.attempt_id = a.id
      join questions q on q.id = aq.question_id
      left join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
      where u.role = 'student' group by q.category`).all();
    const departments = db.prepare(`select coalesce(nullif(trim(p.department), ''), 'unspecified') department, count(*) students
      from users u left join student_profiles p on p.user_id = u.id where u.role = 'student'
      group by lower(coalesce(nullif(trim(p.department), ''), 'unspecified')) order by 1`).all();
    res.json({
      students: list.length,
      assessed: list.length - levels.unassessed,
      level_distribution: levels,
      readiness: { source: 'system_verified', bands, average_score: scores.length ? r1(scores.reduce((a, b) => a + b, 0) / scores.length) : null },
      categories: CATS.map(category => {
        const x = pooled.find(p => p.category === category);
        return { category, questions: x ? x.n : 0, accuracy: x ? pct(x.c, x.n) : null, weak_students: weak[category] };
      }),
      self_reported: { source: 'self_reported', departments },
      applications: { total: db.prepare('select count(*) n from applications').get().n },
      drives: { open: db.prepare("select count(*) n from drives where status = 'open'").get().n }
    });
  });

  r.get('/students', staff, (req, res) => {
    const band = req.query.band;
    if (band !== undefined && !BANDS.includes(band)) return res.status(400).json({ error: 'Invalid band' });
    const n = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    let rows = students().map(s => {
      const v = verifiedView(db, s.id);
      const sr = selfReported(db, s.id);
      return { id: s.id, name: s.name, email: s.email, level: v.level,
        readiness: { score: v.readiness.score, band: v.readiness.band, confidence: v.readiness.confidence },
        weak_categories: v.weak_categories,
        self_reported: { department: sr.department, year: sr.year, cgpa: sr.cgpa } };
    });
    if (band) rows = rows.filter(x => x.readiness.band === band);
    rows.sort((a, b) => (a.readiness.score ?? -1) - (b.readiness.score ?? -1) || a.id - b.id);
    res.json(rows.slice(0, n));
  });

  r.get('/students/:id', staff, (req, res) => {
    const id = req.params.id;
    const s = /^\d+$/.test(id) ? db.prepare("select id, name, email from users where id = ? and role = 'student'").get(Number(id)) : undefined;
    if (!s) return res.status(404).json({ error: 'Student not found' });
    audit(db, { actorId: req.user.id, action: 'analytics.view_student', entity: 'user', entityId: s.id });
    res.json({ student: s, verified: verifiedView(db, s.id), self_reported: selfReported(db, s.id),
      applications: db.prepare('select count(*) n from applications where user_id = ?').get(s.id).n });
  });

  return r;
};
