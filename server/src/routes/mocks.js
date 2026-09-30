const express = require('express');
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { createMock } = require('../mockBank');

const CATS = ['aptitude', 'programming'];
const isId = v => /^\d+$/.test(String(v));

function validateMock(b) {
  if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 100) return { error: 'Invalid title' };
  if (!Number.isInteger(b.duration_minutes) || b.duration_minutes < 1 || b.duration_minutes > 180) return { error: 'Invalid duration_minutes' };
  if (b.company_id !== undefined && b.company_id !== null && !Number.isInteger(b.company_id)) return { error: 'Invalid company_id' };
  if (!Array.isArray(b.sections) || b.sections.length < 1 || b.sections.length > 5) return { error: 'Invalid sections' };
  let total = 0;
  for (const s of b.sections) {
    if (!s || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 50 || !CATS.includes(s.category) ||
        !Number.isInteger(s.count) || s.count < 1 || s.count > 20) return { error: 'Invalid section' };
    total += s.count;
  }
  if (total > 50) return { error: 'Too many questions' };
  return { out: { title: b.title.trim(), durationSec: b.duration_minutes * 60, companyId: b.company_id ?? null,
    sections: b.sections.map(s => ({ name: s.name.trim(), category: s.category, count: s.count })) } };
}

module.exports = function mockRoutes(db) {
  const r = express.Router();
  const staff = requireRole('coordinator', 'admin');
  const student = requireRole('student');

  const SEL = `select m.*, c.name company, (select count(*) from mock_test_questions q where q.mock_id = m.id) total_questions
    from mock_tests m left join companies c on c.id = m.company_id`;
  const getMock = id => isId(id) ? db.prepare(SEL + ' where m.id = ?').get(Number(id)) : undefined;
  const view = m => ({
    id: m.id, title: m.title, company_id: m.company_id, company: m.company ?? null,
    duration_minutes: m.duration_sec / 60, total_questions: m.total_questions,
    sections: db.prepare('select section name, count(*) questions from mock_test_questions where mock_id = ? group by section order by min(position)').all(m.id)
  });

  const owned = (uid, id) => isId(id)
    ? db.prepare("select * from attempts where id = ? and user_id = ? and kind = 'mock'").get(Number(id), uid) : undefined;
  const items = a => db.prepare(`select q.id, q.text, q.options, q.correct_index c, aa.selected_index s, mq.section
    from attempt_questions aq
    join questions q on q.id = aq.question_id
    join mock_test_questions mq on mq.mock_id = ? and mq.question_id = aq.question_id
    left join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
    where aq.attempt_id = ? order by mq.position`).all(a.mock_id, a.id);
  const remaining = a => Math.max(0, Math.ceil((a.deadline - Date.now()) / 1000));

  function sectionScores(it) {
    const m = new Map();
    for (const x of it) {
      const s = m.get(x.section) || { section: x.section, score: 0, total: 0 };
      s.total++;
      if (x.s === x.c) s.score++;
      m.set(x.section, s);
    }
    return [...m.values()];
  }

  function state(a) {
    const it = items(a);
    const base = { attempt_id: a.id, mock_id: a.mock_id, title: db.prepare('select title from mock_tests where id = ?').get(a.mock_id).title };
    if (a.submitted_at) {
      return { status: 'completed', ...base, score: a.score, total: a.total, sections: sectionScores(it),
        review: it.map(x => ({ question_id: x.id, section: x.section, text: x.text, options: JSON.parse(x.options),
          selected_index: x.s ?? null, correct_index: x.c, correct: x.s === x.c })) };
    }
    return { status: 'in_progress', ...base, remaining_seconds: remaining(a),
      questions: it.map(x => ({ id: x.id, section: x.section, text: x.text, options: JSON.parse(x.options) })),
      answers: Object.fromEntries(it.filter(x => x.s != null).map(x => [x.id, x.s])) };
  }

  function finalize(a) {
    const it = items(a);
    const score = it.filter(x => x.s === x.c).length;
    const info = db.prepare('update attempts set submitted_at = ?, score = ?, total = ? where id = ? and submitted_at is null')
      .run(Date.now(), score, it.length, a.id);
    if (info.changes === 1) {
      audit(db, { actorId: a.user_id, action: 'mock.submit', entity: 'attempt', entityId: a.id,
        details: { mock_id: a.mock_id, score, total: it.length, sections: sectionScores(it), auto: Date.now() >= a.deadline } });
    }
    return db.prepare('select * from attempts where id = ?').get(a.id);
  }

  function active(uid) {
    const a = db.prepare("select * from attempts where user_id = ? and kind = 'mock' and submitted_at is null order by id desc limit 1").get(uid);
    if (a && Date.now() >= a.deadline) { finalize(a); return undefined; }
    return a;
  }

  r.get('/', (req, res) => res.json(db.prepare(SEL + ' order by m.id').all().map(view)));

  r.post('/', staff, (req, res) => {
    const { out, error } = validateMock(req.body || {});
    if (error) return res.status(400).json({ error });
    if (out.companyId != null && !db.prepare('select 1 from companies where id = ?').get(out.companyId))
      return res.status(400).json({ error: 'Unknown company' });
    let id;
    try { id = createMock(db, { ...out, createdBy: req.user.id }); }
    catch (e) { if (e.status === 400) return res.status(400).json({ error: e.message }); throw e; }
    audit(db, { actorId: req.user.id, action: 'mock.create', entity: 'mock', entityId: id, details: { title: out.title, sections: out.sections } });
    res.status(201).json(view(getMock(id)));
  });

  r.get('/current', student, (req, res) => {
    const a = active(req.user.id);
    res.json(a ? state(a) : { status: 'none' });
  });

  r.get('/attempts/history', student, (req, res) => {
    res.json(db.prepare(`select a.id, a.mock_id, m.title, a.score, a.total, a.submitted_at
      from attempts a join mock_tests m on m.id = a.mock_id
      where a.user_id = ? and a.kind = 'mock' and a.submitted_at is not null order by a.id desc`).all(req.user.id));
  });

  r.get('/attempts/:id', student, (req, res) => {
    let a = owned(req.user.id, req.params.id);
    if (!a) return res.status(404).json({ error: 'Attempt not found' });
    if (!a.submitted_at && Date.now() >= a.deadline) a = finalize(a);
    res.json(state(a));
  });

  r.put('/attempts/:id/answer', student, (req, res) => {
    let a = owned(req.user.id, req.params.id);
    if (!a) return res.status(404).json({ error: 'Attempt not found' });
    if (!a.submitted_at && Date.now() >= a.deadline) a = finalize(a);
    if (a.submitted_at) return res.status(409).json({ error: 'Attempt closed' });
    const { questionId, selectedIndex } = req.body || {};
    const q = Number.isInteger(questionId) && db.prepare(`select q.options from attempt_questions aq
      join questions q on q.id = aq.question_id where aq.attempt_id = ? and aq.question_id = ?`).get(a.id, questionId);
    if (!q) return res.status(400).json({ error: 'Question not in this attempt' });
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= JSON.parse(q.options).length)
      return res.status(400).json({ error: 'Invalid option' });
    db.prepare(`insert into attempt_answers(attempt_id, question_id, selected_index, saved_at) values(?, ?, ?, ?)
      on conflict(attempt_id, question_id) do update set selected_index = excluded.selected_index, saved_at = excluded.saved_at`)
      .run(a.id, questionId, selectedIndex, Date.now());
    res.json({ saved: true, remaining_seconds: remaining(a) });
  });

  r.post('/attempts/:id/submit', student, (req, res) => {
    let a = owned(req.user.id, req.params.id);
    if (!a) return res.status(404).json({ error: 'Attempt not found' });
    if (!a.submitted_at) a = finalize(a);
    res.json(state(a));
  });

  r.post('/:id/start', student, (req, res) => {
    const uid = req.user.id;
    const m = getMock(req.params.id);
    if (!m) return res.status(404).json({ error: 'Mock test not found' });
    const cur = active(uid);
    if (cur) return res.json(state(cur));
    const lvl = db.prepare('select level from student_profiles where user_id = ?').get(uid)?.level;
    if (!lvl) return res.status(403).json({ error: 'Complete the initial assessment first' });
    const now = Date.now();
    const id = db.transaction(() => {
      const info = db.prepare("insert into attempts(user_id, kind, started_at, deadline, mock_id) values(?, 'mock', ?, ?, ?)")
        .run(uid, now, now + m.duration_sec * 1000, m.id);
      const aid = Number(info.lastInsertRowid);
      db.prepare(`insert into attempt_questions(attempt_id, question_id, position)
        select ?, question_id, position from mock_test_questions where mock_id = ?`).run(aid, m.id);
      return aid;
    })();
    audit(db, { actorId: uid, action: 'mock.start', entity: 'attempt', entityId: id, details: { mock_id: m.id } });
    res.status(201).json(state(db.prepare('select * from attempts where id = ?').get(id)));
  });

  return r;
};
