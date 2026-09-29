const Database = require('better-sqlite3');
const migrations = require('./migrations');
function createDb(file = ':memory:') {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = new Set(db.prepare('select id from schema_migrations').all().map(r => r.id));
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('insert into schema_migrations(id, name) values(?, ?)').run(m.id, m.name);
    })();
  }
  return db;
}
module.exports = { createDb };
