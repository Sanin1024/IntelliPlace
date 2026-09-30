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
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;` },
  { id: 4, name: 'drives_and_applications', sql: `
    CREATE TABLE drives (
      id INTEGER PRIMARY KEY,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT,
      min_cgpa REAL,
      allowed_departments TEXT NOT NULL DEFAULT '[]',
      min_year INTEGER,
      max_year INTEGER,
      required_level TEXT CHECK (required_level IS NULL OR required_level IN ('Beginner','Intermediate','Advanced')),
      required_skills TEXT NOT NULL DEFAULT '[]',
      deadline INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE applications (
      id INTEGER PRIMARY KEY,
      drive_id INTEGER NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      applied_at INTEGER NOT NULL,
      UNIQUE (drive_id, user_id)
    );` },
  { id: 5, name: 'practice_bank', sql: `
    ALTER TABLE questions ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'Beginner';
    ALTER TABLE attempts ADD COLUMN category TEXT;
    ALTER TABLE attempts ADD COLUMN difficulty TEXT;
    CREATE INDEX practice_lookup ON questions(purpose, category, difficulty);
    CREATE INDEX attempts_user_kind ON attempts(user_id, kind);` },
  { id: 6, name: 'mocks_and_companies', sql: `
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      focus TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE company_resources (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('topic','tip','link')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE mock_tests (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      duration_sec INTEGER NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE mock_test_questions (
      mock_id INTEGER NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id),
      section TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (mock_id, question_id)
    );
    ALTER TABLE attempts ADD COLUMN mock_id INTEGER REFERENCES mock_tests(id);
    CREATE UNIQUE INDEX one_active_mock ON attempts(user_id) WHERE kind = 'mock' AND submitted_at IS NULL;` },
  { id: 7, name: 'resume_builder', sql: `
    CREATE TABLE resumes (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      headline TEXT, summary TEXT,
      education TEXT NOT NULL DEFAULT '[]',
      projects TEXT NOT NULL DEFAULT '[]',
      experience TEXT NOT NULL DEFAULT '[]',
      certifications TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );` }
];
