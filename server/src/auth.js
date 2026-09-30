const crypto = require('crypto');
const SESSION_MS = 8 * 60 * 60 * 1000;
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(h, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(s, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('insert into sessions(token_hash, user_id, expires_at) values(?, ?, ?)')
    .run(sha(token), userId, Date.now() + SESSION_MS);
  return token;
}
function requireAuth(db) {
  return (req, res, next) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ error: 'Authentication required' });
    const th = sha(m[1]);
    const row = db.prepare(`select u.id, u.name, u.email, u.role, u.disabled_at, s.expires_at
      from sessions s join users u on u.id = s.user_id where s.token_hash = ?`).get(th);
    if (!row || row.disabled_at || row.expires_at < Date.now()) return res.status(401).json({ error: 'Invalid or expired session' });
    req.user = { id: row.id, name: row.name, email: row.email, role: row.role };
    req.tokenHash = th;
    next();
  };
}
function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' });
}
module.exports = { hashPassword, verifyPassword, createSession, requireAuth, requireRole };
