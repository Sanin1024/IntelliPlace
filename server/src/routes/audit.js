const express = require('express');
const { verifyChain, currentHead, checkAgainstHead } = require('../audit');
const { audit } = require('../audit');

module.exports = function auditRoutes(db) {
  const r = express.Router();
  r.get('/verify', (req, res) => res.json(verifyChain(db)));

  r.get('/head', (req, res) => {
    const h = currentHead(db);
    audit(db, { actorId: req.user.id, action: 'audit.export_head', entity: 'audit', entityId: 'head', details: { count: h.count } });
    res.json({ count: h.count, head: h.head, ts: Date.now() });
  });

  r.post('/check-head', (req, res) => {
    const b = req.body || {};
    if (!Number.isInteger(b.count) || b.count < 0 || typeof b.head !== 'string' || !/^[0-9a-f]{64}$/.test(b.head))
      return res.status(400).json({ error: 'A saved head needs an integer count and a 64-character hex head' });
    res.json(checkAgainstHead(db, { count: b.count, head: b.head }));
  });

  r.get('/', (req, res) => {
    const n = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const rows = db.prepare(`select id, ts, actor_id, action, entity, entity_id, details, hash
      from audit_log order by id desc limit ?`).all(n);
    res.json(rows.map(x => ({ ...x, details: x.details ? JSON.parse(x.details) : null })));
  });
  return r;
};
