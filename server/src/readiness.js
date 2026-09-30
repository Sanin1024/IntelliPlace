const CATS = ['aptitude', 'programming'];
const WEIGHTS = { initial_assessment: 30, practice: 30, mock_tests: 40 };
const WEAK_BELOW = 60;
const r1 = n => Math.round(n * 10) / 10;
const pct = (s, t) => (t ? Math.round(s * 1000 / t) / 10 : null);
const bandFor = s => (s == null ? 'no_data' : s < 40 ? 'not_ready' : s < 70 ? 'developing' : 'ready');

function categoryStats(db, uid) {
  const rows = db.prepare(`select q.category, count(*) n,
      sum(case when aa.selected_index = q.correct_index then 1 else 0 end) c
    from attempts a
    join attempt_questions aq on aq.attempt_id = a.id
    join questions q on q.id = aq.question_id
    left join attempt_answers aa on aa.attempt_id = aq.attempt_id and aa.question_id = aq.question_id
    where a.user_id = ? and a.submitted_at is not null
    group by q.category`).all(uid);
  return CATS.map(category => {
    const x = rows.find(r => r.category === category);
    const questions = x ? x.n : 0;
    const correct = x ? x.c : 0;
    const accuracy = pct(correct, questions);
    return { category, questions, correct, accuracy, weak: accuracy != null && accuracy < WEAK_BELOW };
  });
}

function computeReadiness(db, uid) {
  const components = [];
  const add = (name, percent, detail) => components.push({ name, source: 'system_verified', weight: WEIGHTS[name], percent, detail });
  const ini = db.prepare("select score, total from attempts where user_id = ? and kind = 'initial' and submitted_at is not null").get(uid);
  if (ini && ini.total) add('initial_assessment', pct(ini.score, ini.total), { score: ini.score, total: ini.total });
  const pr = db.prepare("select sum(score) s, sum(total) t from attempts where user_id = ? and kind = 'practice' and submitted_at is not null").get(uid);
  if (pr && pr.t) add('practice', pct(pr.s, pr.t), { score: pr.s, total: pr.t });
  const mk = db.prepare("select score, total from attempts where user_id = ? and kind = 'mock' and submitted_at is not null and total > 0 order by id desc limit 3").all(uid);
  if (mk.length) add('mock_tests', r1(mk.reduce((n, m) => n + m.score * 100 / m.total, 0) / mk.length), { attempts_counted: mk.length });
  const tw = components.reduce((n, c) => n + c.weight, 0);
  const score = tw ? r1(components.reduce((n, c) => n + c.percent * c.weight, 0) / tw) : null;
  return {
    score, band: bandFor(score), confidence: [null, 'low', 'medium', 'high'][components.length],
    components, missing: Object.keys(WEIGHTS).filter(k => !components.some(c => c.name === k))
  };
}

function verifiedView(db, uid) {
  const level = db.prepare('select level from student_profiles where user_id = ?').get(uid)?.level ?? null;
  const categories = categoryStats(db, uid);
  return { source: 'system_verified', level, readiness: computeReadiness(db, uid), categories,
    weak_categories: categories.filter(c => c.weak).map(c => c.category) };
}

function selfReported(db, uid) {
  const p = db.prepare('select department, year, cgpa, phone, skills from student_profiles where user_id = ?').get(uid);
  const skills = p ? JSON.parse(p.skills) : [];
  const filled = [p?.department, p?.year, p?.cgpa, p?.phone].filter(v => v != null && v !== '').length + (skills.length ? 1 : 0);
  return { source: 'self_reported', department: p?.department ?? null, year: p?.year ?? null,
    cgpa: p?.cgpa ?? null, skills, completeness_percent: filled * 20 };
}

module.exports = { CATS, WEIGHTS, WEAK_BELOW, bandFor, pct, r1, categoryStats, computeReadiness, verifiedView, selfReported };
