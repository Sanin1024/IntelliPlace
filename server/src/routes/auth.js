const express = require('express');
const { hashPassword, verifyPassword, createSession, requireAuth } = require('../auth');
const { audit } = require('../audit');
const { MAX_FAILS, LOCK_MS } = require('../accounts');
const DUMMY = hashPassword('dummy-password');

module.exports = function authRoutes(db) {
  const r = express.Router();
  const auth = requireAuth(db);
  const locked = (u, now) => u.locked_until != null && u.locked_until > now;

  function registerFailure(u, now) {
    const n = u.failed_logins + 1;
    if (n >= MAX_FAILS) {
      db.prepare('update users set failed_logins = 0, locked_until = ? where id = ?').run(now + LOCK_MS, u.id);
      audit(db, { actorId: u.id, action: 'auth.lockout', entity: 'user', entityId: u.id });
    } else {
      db.prepare('update users set failed_logins = ? where id = ?').run(n, u.id);
    }
  }

  r.post('/register', (req, res) => {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 100)
      return res.status(400).json({ error: 'Valid name required' });
    const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      return res.status(400).json({ error: 'Valid email required' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 128)
      return res.status(400).json({ error: 'Password must be 8-128 characters' });
    try {
      const info = db.prepare('insert into users(name, email, password_hash) values(?, ?, ?)')
        .run(name.trim(), e, hashPassword(password));
      audit(db, { actorId: Number(info.lastInsertRowid), action: 'user.register', entity: 'user', entityId: info.lastInsertRowid });
      res.status(201).json({ id: Number(info.lastInsertRowid), name: name.trim(), email: e, role: 'student' });
    } catch (err) {
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Email already registered' });
      throw err;
    }
  });

  r.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'Email and password required' });
    const u = db.prepare('select * from users where email = ?').get(email.trim().toLowerCase());
    const now = Date.now();
    if (u && locked(u, now)) {
      verifyPassword(password, DUMMY);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = verifyPassword(password, u ? u.password_hash : DUMMY);
    if (!u || !ok) {
      audit(db, { actorId: u ? u.id : null, action: 'auth.login_failed', entity: 'user', entityId: u ? u.id : null });
      if (u) registerFailure(u, now);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (u.disabled_at != null) {
      audit(db, { actorId: u.id, action: 'auth.login_disabled', entity: 'user', entityId: u.id });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (u.failed_logins) db.prepare('update users set failed_logins = 0 where id = ?').run(u.id);
    audit(db, { actorId: u.id, action: 'auth.login', entity: 'user', entityId: u.id });
    res.json({ token: createSession(db, u.id), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  });

  r.post('/logout', auth, (req, res) => {
    db.prepare('delete from sessions where token_hash = ?').run(req.tokenHash);
    audit(db, { actorId: req.user.id, action: 'auth.logout', entity: 'user', entityId: req.user.id });
    res.json({ ok: true });
  });

  r.get('/me', auth, (req, res) => res.json(req.user));

  r.post('/password', auth, (req, res) => {
    const { current_password: cur, new_password: next } = req.body || {};
    if (typeof cur !== 'string' || typeof next !== 'string')
      return res.status(400).json({ error: 'current_password and new_password required' });
    if (next.length < 8 || next.length > 128) return res.status(400).json({ error: 'Password must be 8-128 characters' });
    if (next === cur) return res.status(400).json({ error: 'New password must differ from the current one' });
    const u = db.prepare('select * from users where id = ?').get(req.user.id);
    const now = Date.now();
    if (locked(u, now)) {
      verifyPassword(cur, DUMMY);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!verifyPassword(cur, u.password_hash)) {
      audit(db, { actorId: u.id, action: 'auth.credential_failed', entity: 'user', entityId: u.id });
      registerFailure(u, now);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    db.transaction(() => {
      db.prepare('update users set password_hash = ?, failed_logins = 0, locked_until = null where id = ?').run(hashPassword(next), u.id);
      db.prepare('delete from sessions where user_id = ? and token_hash != ?').run(u.id, req.tokenHash);
    })();
    audit(db, { actorId: u.id, action: 'auth.credential_change', entity: 'user', entityId: u.id });
    res.json({ ok: true });
  });

  return r;
};
