const { hashPassword } = require('./auth');
const { audit } = require('./audit');

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateNewUser(b) {
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 100) return { error: 'Valid name required' };
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: 'Valid email required' };
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 128)
    return { error: 'Password must be 8-128 characters' };
  return { out: { name, email, password: b.password } };
}

function createStaff(db, { name, email, password, role, actorId = null, action }) {
  try {
    const info = db.prepare('insert into users(name, email, password_hash, role) values(?, ?, ?, ?)')
      .run(name, email, hashPassword(password), role);
    const id = Number(info.lastInsertRowid);
    audit(db, { actorId, action, entity: 'user', entityId: id, details: { role } });
    return { id, name, email, role };
  } catch (err) {
    if (String(err.code).startsWith('SQLITE_CONSTRAINT'))
      throw Object.assign(new Error('Email already registered'), { status: 409 });
    throw err;
  }
}
module.exports = { MAX_FAILS, LOCK_MS, validateNewUser, createStaff };
