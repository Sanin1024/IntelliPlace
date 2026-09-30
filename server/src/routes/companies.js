const express = require('express');
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { evaluate, hydrate } = require('../eligibility');

const CATS = ['aptitude', 'programming'];
const KINDS = ['topic', 'tip', 'link'];

module.exports = function companyRoutes(db) {
  const r = express.Router();
  const staff = requireRole('coordinator', 'admin');
  const student = requireRole('student');

  const getCompany = id => {
    if (!/^\d+$/.test(String(id))) return null;
    const c = db.prepare('select * from companies where id = ?').get(Number(id));
    return c ? { id: c.id, name: c.name, focus: JSON.parse(c.focus) } : null;
  };

  r.post('/', staff, (req, res) => {
    const b = req.body || {};
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 100) return res.status(400).json({ error: 'Invalid name' });
    let focus = [];
    if (b.focus !== undefined) {
      if (!Array.isArray(b.focus) || !b.focus.every(f => CATS.includes(f))) return res.status(400).json({ error: 'Invalid focus' });
      focus = [...new Set(b.focus)];
    }
    try {
      const info = db.prepare('insert into companies(name, focus) values(?, ?)').run(b.name.trim(), JSON.stringify(focus));
      const id = Number(info.lastInsertRowid);
      audit(db, { actorId: req.user.id, action: 'company.create', entity: 'company', entityId: id, details: { name: b.name.trim() } });
      res.status(201).json({ id, name: b.name.trim(), focus });
    } catch (err) {
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Company already exists' });
      throw err;
    }
  });

  r.get('/', (req, res) => {
    res.json(db.prepare(`select c.id, c.name, c.focus, (select count(*) from company_resources x where x.company_id = c.id) resource_count
      from companies c order by c.name`).all().map(c => ({ ...c, focus: JSON.parse(c.focus) })));
  });

  r.post('/:id/resources', staff, (req, res) => {
    const c = getCompany(req.params.id);
    if (!c) return res.status(404).json({ error: 'Company not found' });
    const b = req.body || {};
    if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 150) return res.status(400).json({ error: 'Invalid title' });
    if (!KINDS.includes(b.kind)) return res.status(400).json({ error: 'Invalid kind' });
    if (typeof b.content !== 'string' || !b.content.trim() || b.content.length > 2000) return res.status(400).json({ error: 'Invalid content' });
    const content = b.content.trim();
    if (b.kind === 'link' && (content.length > 500 || !/^https?:\/\/\S+$/i.test(content))) return res.status(400).json({ error: 'Invalid link' });
    const info = db.prepare('insert into company_resources(company_id, title, kind, content) values(?, ?, ?, ?)')
      .run(c.id, b.title.trim(), b.kind, content);
    const id = Number(info.lastInsertRowid);
    audit(db, { actorId: req.user.id, action: 'resource.create', entity: 'company', entityId: c.id, details: { resource_id: id, kind: b.kind } });
    res.status(201).json({ id, company_id: c.id, title: b.title.trim(), kind: b.kind, content });
  });

  r.get('/:id/prep', student, (req, res) => {
    const c = getCompany(req.params.id);
    if (!c) return res.status(404).json({ error: 'Company not found' });
    const uid = req.user.id;
    const pr = db.prepare('select * from student_profiles where user_id = ?').get(uid);
    const profile = pr ? { ...pr, skills: JSON.parse(pr.skills) } : null;
    const resources = db.prepare('select id, title, kind, content from company_resources where company_id = ? order by id').all(c.id);
    const mocks = db.prepare(`select m.id, m.title, m.duration_sec / 60 as duration_minutes,
      (select count(*) from mock_test_questions q where q.mock_id = m.id) total_questions
      from mock_tests m where m.company_id = ? order by m.id`).all(c.id);
    const drives = db.prepare('select * from drives where lower(company) = lower(?) order by deadline, id').all(c.name).map(hydrate).map(d => {
      const ev = evaluate(d, profile);
      return { id: d.id, role: d.role, status: d.status, deadline: new Date(d.deadline).toISOString(),
        eligible: ev.eligible, failed_rules: ev.rules.filter(x => !x.passed).map(x => x.rule) };
    });
    const readiness = c.focus.map(cat => {
      const t = db.prepare(`select sum(score) s, sum(total) t from attempts
        where user_id = ? and kind = 'practice' and category = ? and submitted_at is not null`).get(uid, cat);
      const accuracy = t.t ? Math.round(t.s * 1000 / t.t) / 10 : null;
      return { category: cat, source: 'system_verified', accuracy, needs_work: accuracy == null || accuracy < 60 };
    });
    res.json({ company: c, resources, mocks, drives, readiness });
  });

  return r;
};
