module.exports = [
  { id: 1, name: 'users_and_sessions', sql: `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','coordinator','admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );` },
  { id: 2, name: 'profiles_and_assessments', sql: `
    CREATE TABLE student_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      department TEXT, year INTEGER, cgpa REAL, phone TEXT,
      skills TEXT NOT NULL DEFAULT '[]',
      level TEXT CHECK (level IN ('Beginner','Intermediate','Advanced')),
      level_source TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE questions (
      id INTEGER PRIMARY KEY, purpose TEXT NOT NULL, category TEXT NOT NULL,
      text TEXT NOT NULL, options TEXT NOT NULL, correct_index INTEGER NOT NULL,
      UNIQUE (purpose, text)
    );
    CREATE TABLE attempts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, started_at INTEGER NOT NULL, deadline INTEGER NOT NULL,
      submitted_at INTEGER, score INTEGER, total INTEGER, level TEXT
    );
    CREATE UNIQUE INDEX one_initial_attempt ON attempts(user_id) WHERE kind = 'initial';
    CREATE TABLE attempt_questions (
      attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id),
      position INTEGER NOT NULL,
      PRIMARY KEY (attempt_id, question_id)
    );
    CREATE TABLE attempt_answers (
      attempt_id INTEGER NOT NULL, question_id INTEGER NOT NULL,
      selected_index INTEGER NOT NULL, saved_at INTEGER NOT NULL,
      PRIMARY KEY (attempt_id, question_id),
      FOREIGN KEY (attempt_id, question_id) REFERENCES attempt_questions(attempt_id, question_id) ON DELETE CASCADE
    );` },
  { id: 3, name: 'audit_log', sql: `
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      actor_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      details TEXT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE
    );
    CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;` }
];
