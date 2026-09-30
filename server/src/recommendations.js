const { verifiedView, WEAK_BELOW } = require('./readiness');
const { evaluate, hydrate } = require('./eligibility');

const ORDER = { high: 0, medium: 1, low: 2 };
const FIELDS = ['department', 'year', 'cgpa', 'phone'];

function buildRecommendations(db, uid, now = Date.now()) {
  const v = verifiedView(db, uid);
  const row = db.prepare('select * from student_profiles where user_id = ?').get(uid);
  const profile = row ? { ...row, skills: JSON.parse(row.skills) } : null;
  const recs = [];
  const add = r => recs.push(r);

  if (!v.level) {
    add({ type: 'initial_assessment', priority: 'high', source: 'system_verified', title: 'Take the initial assessment',
      reason: 'Your level is not verified yet; practice, mocks and drive eligibility depend on it' });
  } else {
    for (const c of v.categories) {
      if (c.weak) {
        add({ type: 'practice', priority: 'high', source: 'system_verified', category: c.category, title: `Strengthen ${c.category}`,
          reason: `Your accuracy is ${c.accuracy}% across ${c.questions} graded questions, below the ${WEAK_BELOW}% target`,
          action: `Practice ${c.category} at ${v.level} level` });
      } else if (c.questions === 0) {
        add({ type: 'practice', priority: 'medium', source: 'system_verified', category: c.category, title: `Start ${c.category} practice`,
          reason: 'You have no graded questions in this area yet', action: `Practice ${c.category} at ${v.level} level` });
      }
    }
    if (v.readiness.missing.includes('mock_tests')) {
      const mocks = db.prepare('select id, title from mock_tests order by id limit 2').all().map(m => ({ id: m.id, title: m.title }));
      if (mocks.length) {
        add({ type: 'mock', priority: 'medium', source: 'system_verified', title: 'Take a mock test',
          reason: 'You have no completed mock tests yet, and they carry the most weight in your readiness score', mocks });
      }
    }
  }

  const drives = db.prepare("select * from drives where status = 'open' and deadline > ? order by deadline, id").all(now).map(hydrate);
  for (const d of drives) {
    if (db.prepare('select 1 from applications where drive_id = ? and user_id = ?').get(d.id, uid)) continue;
    const ev = evaluate(d, profile, now);
    const failed = ev.rules.filter(x => !x.passed);
    if (!failed.length) {
      add({ type: 'apply', priority: 'medium', source: 'mixed', drive_id: d.id,
        title: `Apply to ${d.company} - ${d.role}`, reason: 'You meet every eligibility rule for this drive',
        deadline: new Date(d.deadline).toISOString() });
      continue;
    }
    for (const f of failed) {
      if (f.rule === 'skills' || (f.rule === 'level' && v.level)) {
        add({ type: 'drive_gap', priority: 'low', source: f.source, drive_id: d.id, rule: f.rule,
          title: `${d.company} - ${d.role}: close the ${f.rule} gap`, reason: f.message });
      }
    }
  }

  const missing = FIELDS.filter(k => row?.[k] == null || row[k] === '');
  if (!profile || !profile.skills.length) missing.push('skills');
  if (missing.length) {
    add({ type: 'complete_profile', priority: 'low', source: 'self_reported', title: 'Complete your profile',
      reason: 'Drives check these details, and they appear on your resume', missing_fields: missing });
  }

  recs.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
  return { level: v.level, readiness_band: v.readiness.band, recommendations: recs };
}
module.exports = { buildRecommendations };
