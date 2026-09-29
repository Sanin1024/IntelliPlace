const QUESTIONS = [
  { category: 'aptitude', text: "What is 15% of 200?", options: ["20", "25", "30", "35"], correct: 2 },
  { category: 'aptitude', text: "A train 100 m long crosses a pole in 10 seconds. What is its speed in km/h?", options: ["30", "36", "40", "45"], correct: 1 },
  { category: 'aptitude', text: "Next number in the series 2, 6, 12, 20, 30, ?", options: ["40", "44", "46", "42"], correct: 3 },
  { category: 'aptitude', text: "5 workers finish a job in 12 days. How many days will 10 workers take?", options: ["6", "3", "8", "10"], correct: 0 },
  { category: 'programming', text: "Time complexity of binary search on a sorted array?", options: ["O(n)", "O(n log n)", "O(log n)", "O(1)"], correct: 2 },
  { category: 'programming', text: "Which data structure follows FIFO order?", options: ["Stack", "Tree", "Queue", "Graph"], correct: 2 },
  { category: 'programming', text: "Which SQL clause filters groups after GROUP BY?", options: ["WHERE", "ORDER BY", "LIMIT", "HAVING"], correct: 3 },
  { category: 'programming', text: "Worst-case time complexity of quicksort?", options: ["O(n^2)", "O(n log n)", "O(n)", "O(log n)"], correct: 0 },
  { category: 'programming', text: "In Python, what does print(len([1,2,3][1:])) output?", options: ["1", "2", "3", "Error"], correct: 1 },
  { category: 'programming', text: "Which of these is NOT an HTTP method?", options: ["GET", "FETCH", "POST", "DELETE"], correct: 1 }
];
function seedInitialQuestions(db) {
  const ins = db.prepare("insert or ignore into questions(purpose, category, text, options, correct_index) values('initial', ?, ?, ?, ?)");
  db.transaction(() => { for (const q of QUESTIONS) ins.run(q.category, q.text, JSON.stringify(q.options), q.correct); })();
  return QUESTIONS.length;
}
module.exports = { QUESTIONS, seedInitialQuestions };
if (require.main === module) {
  require('dotenv').config();
  const { createDb } = require('./db');
  const db = createDb(process.env.DB_PATH || 'intelliplace.db');
  console.log('seeded', seedInitialQuestions(db));
}
