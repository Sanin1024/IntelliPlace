const express = require('express');
const { hashPassword } = require('../auth');
const { audit } = require('../audit');
const { validateNewUser, createStaff } = require('../accounts');

const STAFF_ROLES = ['coordinator', 'admin'];
const ROLES = ['student', 'coordinator', 'admin'];
const isId = v => /^\d+$/.test(String(v));

module.exports = function userRoutes(db) {
  const r = express.Router();
  const view = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at,
    disabled: u.disabled_at != null, locked: u.locked_until != null && u.locked_until > Date.now() });
  const find = id => (isId(id) ? db.prepare('select * from users where id = ?').get(Number(id)) : undefined);

  r.post('/', (req, res) => {
    const b = req.body || {};
    if (!STAFF_ROLES.includes(b.role)) return res.status(400).json({ error: 'Role must be coordinator or admin' });
    const { out, error } = validateNewUser(b);
    if (error) return res.status(400).json({ error });
    try {
      res.status(201).json(createStaff(db, { ...out, role: b.role, actorId: req.user.id, action: 'user.create_staff' }));
    } catch (e) {
      if (e.status === 409) return res.status(409).json({ error: e.message });
      throw e;
    }
  });

  r.get('/', (req, res) => {
    const { role } = req.query;
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const n = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const rows = role
      ? db.prepare('select * from users where role = ? order by id limit ?').all(role, n)
      : db.prepare('select * from users order by id limit ?').all(n);
    res.json(rows.map(view));
  });

  r.post('/:id/disable', (req, res) => {
    const u = find(req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.id === req.user.id) return res.status(409).json({ error: 'You cannot disable your own account' });
    if (u.disabled_at == null) {
      db.transaction(() => {
        db.prepare('update users set disabled_at = ? where id = ?').run(Date.now(), u.id);
        db.prepare('delete from sessions where user_id = ?').run(u.id);
      })();
      audit(db, { actorId: req.user.id, action: 'user.disable', entity: 'user', entityId: u.id });
    }
    res.json(view(find(u.id)));
  });

  r.post('/:id/enable', (req, res) => {
    const u = find(req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.disabled_at != null) {
      db.prepare('update users set disabled_at = null, failed_logins = 0, locked_until = null where id = ?').run(u.id);
      audit(db, { actorId: req.user.id, action: 'user.enable', entity: 'user', entityId: u.id });
    }
    res.json(view(find(u.id)));
  });

  r.post('/:id/unlock', (req, res) => {
    const u = find(req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const wasLocked = u.locked_until != null && u.locked_until > Date.now();
    db.prepare('update users set failed_logins = 0, locked_until = null where id = ?').run(u.id);
    if (wasLocked) audit(db, { actorId: req.user.id, action: 'user.unlock', entity: 'user', entityId: u.id });
    res.json(view(find(u.id)));
  });

  r.post('/:id/reset-password', (req, res) => {
    const u = find(req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.id === req.user.id) return res.status(409).json({ error: 'Use the change-password endpoint for your own account' });
    const pw = (req.body || {}).password;
    if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128)
      return res.status(400).json({ error: 'Password must be 8-128 characters' });
    db.transaction(() => {
      db.prepare('update users set password_hash = ?, failed_logins = 0, locked_until = null where id = ?').run(hashPassword(pw), u.id);
      db.prepare('delete from sessions where user_id = ?').run(u.id);
    })();
    audit(db, { actorId: req.user.id, action: 'user.credential_reset', entity: 'user', entityId: u.id });
    res.json(view(find(u.id)));
  });

  return r;
};
