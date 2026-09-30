const express = require('express');
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { evaluate, hydrate, RANK } = require('../eligibility');

const strList = (v, max) => Array.isArray(v) && v.length <= max &&
  v.every(s => typeof s === 'string' && s.trim() && s.length <= 100);

function validateDrive(b) {
  const has = k => b[k] !== undefined && b[k] !== null;
  const o = {};
  for (const k of ['company', 'role']) {
    if (typeof b[k] !== 'string' || !b[k].trim() || b[k].length > 100) return { error: `Invalid ${k}` };
    o[k] = b[k].trim();
  }
  if (has('description')) {
    if (typeof b.description !== 'string' || b.description.length > 1000) return { error: 'Invalid description' };
    o.description = b.description;
  }
  if (has('min_cgpa')) {
    if (typeof b.min_cgpa !== 'number' || !Number.isFinite(b.min_cgpa) || b.min_cgpa < 0 || b.min_cgpa > 10) return { error: 'Invalid min_cgpa' };
    o.min_cgpa = b.min_cgpa;
  }
  if (has('allowed_departments')) {
    if (!strList(b.allowed_departments, 20)) return { error: 'Invalid allowed_departments' };
    o.allowed_departments = b.allowed_departments.map(s => s.trim());
  }
  for (const k of ['min_year', 'max_year']) {
    if (has(k)) {
      if (!Number.isInteger(b[k]) || b[k] < 1 || b[k] > 6) return { error: `Invalid ${k}` };
      o[k] = b[k];
    }
  }
  if (o.min_year != null && o.max_year != null && o.min_year > o.max_year) return { error: 'min_year exceeds max_year' };
  if (has('required_level')) {
    if (!Object.hasOwn(RANK, b.required_level)) return { error: 'Invalid required_level' };
    o.required_level = b.required_level;
  }
  if (has('required_skills')) {
    if (!strList(b.required_skills, 20)) return { error: 'Invalid required_skills' };
    o.required_skills = b.required_skills.map(s => s.trim());
  }
  const dl = typeof b.deadline === 'string' ? Date.parse(b.deadline) : NaN;
  if (!Number.isFinite(dl)) return { error: 'Invalid deadline' };
  if (dl <= Date.now()) return { error: 'Deadline must be in the future' };
  o.deadline = dl;
  return { out: o };
}

module.exports = function driveRoutes(db) {
  const r = express.Router();
  const staff = requireRole('coordinator', 'admin');
  const student = requireRole('student');

  const getDrive = id => {
    if (!/^\d+$/.test(String(id))) return null;
    const row = db.prepare('select * from drives where id = ?').get(Number(id));
    return row ? hydrate(row) : null;
  };
  const getProfile = uid => {
    const p = db.prepare('select * from student_profiles where user_id = ?').get(uid);
    return p ? { ...p, skills: JSON.parse(p.skills) } : null;
  };
  const view = d => ({
    id: d.id, company: d.company, role: d.role, description: d.description,
    min_cgpa: d.min_cgpa, allowed_departments: d.allowed_departments,
    min_year: d.min_year, max_year: d.max_year, required_level: d.required_level,
    required_skills: d.required_skills, status: d.status,
    deadline: new Date(d.deadline).toISOString()
  });

  r.post('/', staff, (req, res) => {
    const { out, error } = validateDrive(req.body || {});
    if (error) return res.status(400).json({ error });
    const info = db.prepare(`insert into drives(company, role, description, min_cgpa, allowed_departments,
      min_year, max_year, required_level, required_skills, deadline, created_by) values(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(out.company, out.role, out.description ?? null, out.min_cgpa ?? null,
        JSON.stringify(out.allowed_departments || []), out.min_year ?? null, out.max_year ?? null,
        out.required_level ?? null, JSON.stringify(out.required_skills || []), out.deadline, req.user.id);
    const id = Number(info.lastInsertRowid);
    audit(db, { actorId: req.user.id, action: 'drive.create', entity: 'drive', entityId: id, details: { company: out.company, role: out.role } });
    res.status(201).json(view(getDrive(id)));
  });

  r.get('/', staff, (req, res) => {
    const rows = db.prepare(`select d.*, (select count(*) from applications a where a.drive_id = d.id) as application_count
      from drives d order by d.id`).all();
    res.json(rows.map(x => ({ ...view(hydrate(x)), application_count: x.application_count })));
  });

  r.get('/available', student, (req, res) => {
    const p = getProfile(req.user.id);
    const applied = new Set(db.prepare('select drive_id from applications where user_id = ?').all(req.user.id).map(x => x.drive_id));
    const rows = db.prepare('select * from drives order by deadline, id').all().map(hydrate);
    res.json(rows.map(d => {
      const ev = evaluate(d, p);
      return { ...view(d), eligible: ev.eligible, failed_count: ev.rules.filter(x => !x.passed).length, applied: applied.has(d.id) };
    }));
  });

  r.post('/:id/close', staff, (req, res) => {
    const d = getDrive(req.params.id);
    if (!d) return res.status(404).json({ error: 'Drive not found' });
    if (d.status === 'open') {
      db.prepare("update drives set status = 'closed' where id = ?").run(d.id);
      audit(db, { actorId: req.user.id, action: 'drive.close', entity: 'drive', entityId: d.id });
    }
    res.json(view(getDrive(d.id)));
  });

  r.get('/:id/applications', staff, (req, res) => {
    const d = getDrive(req.params.id);
    if (!d) return res.status(404).json({ error: 'Drive not found' });
    res.json(db.prepare(`select a.id, u.id as user_id, u.name, u.email, a.applied_at from applications a
      join users u on u.id = a.user_id where a.drive_id = ? order by a.id`).all(d.id));
  });

  r.get('/:id/eligibility', student, (req, res) => {
    const d = getDrive(req.params.id);
    if (!d) return res.status(404).json({ error: 'Drive not found' });
    res.json({ drive_id: d.id, ...evaluate(d, getProfile(req.user.id)) });
  });

  r.post('/:id/apply', student, (req, res) => {
    const d = getDrive(req.params.id);
    if (!d) return res.status(404).json({ error: 'Drive not found' });
    const ev = evaluate(d, getProfile(req.user.id));
    if (!ev.eligible) {
      audit(db, { actorId: req.user.id, action: 'application.rejected', entity: 'drive', entityId: d.id,
        details: { failed: ev.rules.filter(x => !x.passed).map(x => x.rule) } });
      return res.status(403).json({ error: 'Not eligible', drive_id: d.id, ...ev });
    }
    try {
      const info = db.prepare('insert into applications(drive_id, user_id, applied_at) values(?, ?, ?)')
        .run(d.id, req.user.id, Date.now());
      audit(db, { actorId: req.user.id, action: 'application.submit', entity: 'drive', entityId: d.id });
      res.status(201).json({ applied: true, application_id: Number(info.lastInsertRowid) });
    } catch (err) {
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Already applied' });
      throw err;
    }
  });

  return r;
};
