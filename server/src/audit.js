const crypto = require('crypto');
const GENESIS = '0'.repeat(64);

const digest = (prev, r) => crypto.createHash('sha256')
  .update(JSON.stringify([prev, r.ts, r.actor_id, r.action, r.entity, r.entity_id, r.details]))
  .digest('hex');

function audit(db, { actorId = null, action, entity = null, entityId = null, details = null }) {
  const row = {
    ts: Date.now(),
    actor_id: actorId ?? null,
    action,
    entity,
    entity_id: entityId == null ? null : String(entityId),
    details: details ? JSON.stringify(details) : null
  };
  return db.transaction(() => {
    const last = db.prepare('select hash from audit_log order by id desc limit 1').get();
    const prev = last ? last.hash : GENESIS;
    const hash = digest(prev, row);
    db.prepare(`insert into audit_log(ts, actor_id, action, entity, entity_id, details, prev_hash, hash)
      values(?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.ts, row.actor_id, row.action, row.entity, row.entity_id, row.details, prev, hash);
    return hash;
  }).immediate();
}

function verifyChain(db) {
  let prev = GENESIS, count = 0;
  for (const r of db.prepare('select * from audit_log order by id').all()) {
    if (r.prev_hash !== prev) return { valid: false, count, broken_at: r.id, reason: 'chain_break' };
    if (digest(r.prev_hash, r) !== r.hash) return { valid: false, count, broken_at: r.id, reason: 'hash_mismatch' };
    prev = r.hash;
    count++;
  }
  return { valid: true, count, head: prev };
}

function currentHead(db) {
  const row = db.prepare('select count(*) n, max(id) maxid from audit_log').get();
  const last = row.n ? db.prepare('select hash from audit_log order by id desc limit 1').get() : null;
  return { count: row.n, head: last ? last.hash : GENESIS };
}

function checkAgainstHead(db, saved) {
  const cur = verifyChain(db);
  if (!cur.valid) return { result: 'diverged', message: `The audit chain is broken at entry ${cur.broken_at} (${cur.reason}).`, current: { count: cur.count } };
  if (cur.count < saved.count) {
    return { result: 'truncated', message: `Your saved head had ${saved.count} entries but the log now has ${cur.count}. Entries were removed from the end.`, current: { count: cur.count, head: cur.head } };
  }
  const at = saved.count === 0 ? { hash: GENESIS } : db.prepare('select hash from audit_log order by id limit 1 offset ?').get(saved.count - 1);
  if (!at || at.hash !== saved.head) {
    return { result: 'diverged', message: 'The entry at your saved position does not match your saved head. The log was changed or rebuilt.', current: { count: cur.count, head: cur.head } };
  }
  return { result: 'matches', message: `The log is consistent with your saved head. ${cur.count - saved.count} entries were added since.`, current: { count: cur.count, head: cur.head } };
}
module.exports = { audit, verifyChain, digest, GENESIS, currentHead, checkAgainstHead };
