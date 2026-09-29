const express = require('express');
const { hashPassword, verifyPassword, createSession, requireAuth } = require('../auth');
const DUMMY = hashPassword('dummy-password');

module.exports = function authRoutes(db) {
  const r = express.Router();
  const auth = requireAuth(db);

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
    const ok = verifyPassword(password, u ? u.password_hash : DUMMY);
    if (!u || !ok) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: createSession(db, u.id), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  });

  r.post('/logout', auth, (req, res) => {
    db.prepare('delete from sessions where token_hash = ?').run(req.tokenHash);
    res.json({ ok: true });
  });

  r.get('/me', auth, (req, res) => res.json(req.user));
  return r;
};
