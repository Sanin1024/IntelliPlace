const express = require('express');
const { verifyChain } = require('../audit');
module.exports = function auditRoutes(db) {
  const r = express.Router();
  r.get('/verify', (req, res) => res.json(verifyChain(db)));
  r.get('/', (req, res) => {
    const n = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const rows = db.prepare(`select id, ts, actor_id, action, entity, entity_id, details, hash
      from audit_log order by id desc limit ?`).all(n);
    res.json(rows.map(x => ({ ...x, details: x.details ? JSON.parse(x.details) : null })));
  });
  return r;
};
