const Q = (category, text, options, correct) => ({ category, text, options, correct });
const MOCK_QUESTIONS = [
  Q('aptitude', 'What is 12.5% of 480?', ['50', '60', '62', '65'], 1),
  Q('aptitude', 'The average of 5 numbers is 20. If one number is removed, the average of the rest becomes 18. What number was removed?', ['26', '28', '30', '32'], 1),
  Q('aptitude', 'A shirt marked 800 is sold at a 15% discount. What is the selling price?', ['640', '680', '700', '720'], 1),
  Q('aptitude', 'What is the next number in the series 3, 9, 27, 81, ?', ['162', '243', '324', '729'], 1),
  Q('aptitude', 'A car travels 150 km in 2.5 hours. What is its average speed in km/h?', ['50', '55', '60', '65'], 2),
  Q('aptitude', 'The ratio of boys to girls is 4:3 and there are 21 girls. How many boys are there?', ['24', '28', '32', '36'], 1),
  Q('aptitude', 'What is the compound interest on 1000 at 10% per annum for 2 years?', ['200', '210', '220', '121'], 1),
  Q('aptitude', 'In how many ways can 4 people stand in a line?', ['12', '16', '24', '48'], 2),
  Q('programming', 'Which HTTP status code means Not Found?', ['200', '301', '404', '500'], 2),
  Q('programming', 'Which SQL statement adds new rows to a table?', ['SELECT', 'INSERT', 'UPDATE', 'ALTER'], 1),
  Q('programming', 'What is the result of 2 + "2" in JavaScript?', ['4', '22', 'NaN', 'Error'], 1),
  Q('programming', 'Which data structure is typically used for breadth-first search?', ['Stack', 'Queue', 'Heap', 'Trie'], 1),
  Q('programming', 'What is the worst-case time complexity of merge sort?', ['O(n)', 'O(n log n)', 'O(n^2)', 'O(log n)'], 1),
  Q('programming', 'Which property must a primary key have?', ['Can be NULL', 'Must be unique', 'Can repeat', 'Must be text'], 1),
  Q('programming', 'Which Git command creates a new branch and switches to it?', ['git branch -d x', 'git checkout -b x', 'git merge x', 'git stash x'], 1),
  Q('programming', 'What is the space complexity of iterative binary search?', ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], 0)
];

function seedMockQuestions(db) {
  const ins = db.prepare("insert or ignore into questions(purpose, category, difficulty, text, options, correct_index) values('mock', ?, 'Intermediate', ?, ?, ?)");
  db.transaction(() => { for (const q of MOCK_QUESTIONS) ins.run(q.category, q.text, JSON.stringify(q.options), q.correct); })();
  return MOCK_QUESTIONS.length;
}

function createMock(db, { title, companyId = null, durationSec, sections, createdBy = null }) {
  return db.transaction(() => {
    const used = new Set();
    const picked = [];
    for (const s of sections) {
      const rows = db.prepare("select id from questions where purpose = 'mock' and category = ? order by random()").all(s.category)
        .filter(q => !used.has(q.id)).slice(0, s.count);
      if (rows.length < s.count) throw Object.assign(new Error(`Not enough ${s.category} questions in the bank`), { status: 400 });
      for (const q of rows) { used.add(q.id); picked.push({ id: q.id, section: s.name }); }
    }
    const info = db.prepare('insert into mock_tests(title, company_id, duration_sec, created_by) values(?, ?, ?, ?)')
      .run(title, companyId, durationSec, createdBy);
    const id = Number(info.lastInsertRowid);
    const ins = db.prepare('insert into mock_test_questions(mock_id, question_id, section, position) values(?, ?, ?, ?)');
    picked.forEach((q, i) => ins.run(id, q.id, q.section, i + 1));
    return id;
  })();
}

// Sample data only: coordinators replace it with real companies and resources via the API.
function seedSamples(db) {
  db.prepare("insert or ignore into companies(name, focus) values('Acme Technologies', ?)").run(JSON.stringify(['aptitude', 'programming']));
  const c = db.prepare("select id from companies where name = 'Acme Technologies'").get();
  if (!db.prepare('select 1 from company_resources where company_id = ?').get(c.id)) {
    const ins = db.prepare('insert into company_resources(company_id, title, kind, content) values(?, ?, ?, ?)');
    ins.run(c.id, 'Aptitude focus areas', 'topic', 'Percentages, ratios, averages, profit and loss, time and work.');
    ins.run(c.id, 'Programming focus areas', 'topic', 'Arrays, sorting and searching complexity, SQL basics, HTTP fundamentals.');
    ins.run(c.id, 'Test-day tip', 'tip', 'There is no negative marking, so attempt every question.');
  }
  const sections = [{ name: 'Aptitude', category: 'aptitude', count: 4 }, { name: 'Programming', category: 'programming', count: 4 }];
  const has = t => db.prepare('select 1 from mock_tests where title = ?').get(t);
  if (!has('General Placement Mock')) createMock(db, { title: 'General Placement Mock', durationSec: 1800, sections });
  if (!has('Acme Technologies Mock')) createMock(db, { title: 'Acme Technologies Mock', companyId: c.id, durationSec: 1800, sections });
}

module.exports = { MOCK_QUESTIONS, seedMockQuestions, createMock, seedSamples };
if (require.main === module) {
  require('dotenv').config();
  const { createDb } = require('./db');
  const db = createDb(process.env.DB_PATH || 'intelliplace.db');
  console.log('seeded mock', seedMockQuestions(db));
  seedSamples(db);
  console.log('seeded samples');
}
