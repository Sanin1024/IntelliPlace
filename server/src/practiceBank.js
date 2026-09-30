const Q = (category, difficulty, text, options, correct) => ({ category, difficulty, text, options, correct });
const PRACTICE = [
  Q('aptitude', 'Beginner', 'What is 25% of 80?', ['20', '25', '15', '30'], 0),
  Q('aptitude', 'Beginner', 'If 3x = 27, what is x?', ['6', '9', '7', '8'], 1),
  Q('aptitude', 'Beginner', 'What is the average of 10, 20 and 30?', ['15', '20', '25', '30'], 1),
  Q('aptitude', 'Intermediate', 'An item bought for 200 is sold for 250. What is the profit percent?', ['20%', '25%', '30%', '50%'], 1),
  Q('aptitude', 'Intermediate', 'Two numbers are in the ratio 3:5 and their sum is 64. What is the larger number?', ['24', '32', '40', '44'], 2),
  Q('aptitude', 'Intermediate', 'A can finish a job in 10 days and B in 15 days. Working together, how many days do they need?', ['5', '6', '8', '12.5'], 1),
  Q('aptitude', 'Advanced', 'What is the simple interest on 5000 at 8% per annum for 3 years?', ['1000', '1200', '1500', '2000'], 1),
  Q('aptitude', 'Advanced', 'Two fair dice are rolled. What is the probability that the sum is 7?', ['1/6', '1/12', '5/36', '7/36'], 0),
  Q('aptitude', 'Advanced', 'A boat goes 12 km/h in still water and the stream flows at 3 km/h. How long to travel 45 km downstream?', ['3 hours', '4 hours', '5 hours', '3.75 hours'], 0),
  Q('programming', 'Beginner', 'Which keyword declares a constant in JavaScript?', ['var', 'let', 'const', 'static'], 2),
  Q('programming', 'Beginner', 'What is the index of the first element of an array in most languages?', ['0', '1', '-1', '2'], 0),
  Q('programming', 'Beginner', 'Which symbol starts a single-line comment in Python?', ['//', '#', '--', '/*'], 1),
  Q('programming', 'Intermediate', 'Which data structure follows LIFO order?', ['Queue', 'Stack', 'Heap', 'Linked list'], 1),
  Q('programming', 'Intermediate', 'Which SQL keyword removes duplicate rows from a result?', ['UNIQUE', 'DISTINCT', 'DIFFERENT', 'REMOVE'], 1),
  Q('programming', 'Intermediate', 'What is the time complexity of reading an array element by index?', ['O(1)', 'O(n)', 'O(log n)', 'O(n^2)'], 0),
  Q('programming', 'Advanced', 'Which traversal of a binary search tree visits keys in sorted order?', ['Preorder', 'Inorder', 'Postorder', 'Level-order'], 1),
  Q('programming', 'Advanced', 'What is the worst-case recursion depth of DFS on a connected graph with V vertices?', ['O(1)', 'O(V)', 'O(V^2)', 'O(log V)'], 1),
  Q('programming', 'Advanced', 'Which algorithm finds single-source shortest paths when all edge weights are non-negative?', ['Dijkstra', 'Kruskal', 'Prim', 'Topological sort'], 0)
];
function seedPracticeQuestions(db) {
  const ins = db.prepare("insert or ignore into questions(purpose, category, difficulty, text, options, correct_index) values('practice', ?, ?, ?, ?, ?)");
  db.transaction(() => { for (const q of PRACTICE) ins.run(q.category, q.difficulty, q.text, JSON.stringify(q.options), q.correct); })();
  return PRACTICE.length;
}
module.exports = { PRACTICE, seedPracticeQuestions };
if (require.main === module) {
  require('dotenv').config();
  const { createDb } = require('./db');
  console.log('seeded practice', seedPracticeQuestions(createDb(process.env.DB_PATH || 'intelliplace.db')));
}
