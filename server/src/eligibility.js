const RANK = { Beginner: 1, Intermediate: 2, Advanced: 3 };
const hydrate = r => ({
  ...r,
  allowed_departments: JSON.parse(r.allowed_departments),
  required_skills: JSON.parse(r.required_skills)
});

function evaluate(d, p, now = Date.now()) {
  const rules = [];
  const add = (rule, passed, message, extra = {}) => rules.push({ rule, passed, message, ...extra });

  const closed = d.status !== 'open';
  const late = now >= d.deadline;
  add('drive_open', !closed && !late,
    closed ? 'Applications for this drive are closed' : late ? 'The application deadline has passed' : 'Applications are open',
    { source: 'system' });

  if (d.min_cgpa != null) {
    const a = p?.cgpa ?? null;
    const ok = a != null && a >= d.min_cgpa;
    add('cgpa', ok,
      ok ? `Your CGPA ${a} meets the minimum ${d.min_cgpa}`
        : a == null ? `Add your CGPA to your profile; the minimum is ${d.min_cgpa}`
        : `Your CGPA ${a} is below the minimum ${d.min_cgpa}`,
      { source: 'self_reported', required: d.min_cgpa, actual: a });
  }

  if (d.allowed_departments.length) {
    const a = p?.department ?? null;
    const ok = a != null && d.allowed_departments.some(x => x.toLowerCase() === a.toLowerCase());
    add('department', ok,
      ok ? `Your department ${a} is eligible`
        : a == null ? `Add your department to your profile; eligible: ${d.allowed_departments.join(', ')}`
        : `Your department ${a} is not eligible; eligible: ${d.allowed_departments.join(', ')}`,
      { source: 'self_reported', required: d.allowed_departments, actual: a });
  }

  if (d.min_year != null || d.max_year != null) {
    const a = p?.year ?? null;
    const req = d.min_year != null && d.max_year != null ? `${d.min_year}-${d.max_year}`
      : d.min_year != null ? `${d.min_year} or above` : `${d.max_year} or below`;
    const ok = a != null && (d.min_year == null || a >= d.min_year) && (d.max_year == null || a <= d.max_year);
    add('year', ok,
      ok ? `Your year ${a} is within the required range (${req})`
        : a == null ? `Add your year of study to your profile; required: ${req}`
        : `Your year ${a} is outside the required range (${req})`,
      { source: 'self_reported', required: req, actual: a });
  }

  if (d.required_level) {
    const a = p?.level ?? null;
    const ok = a != null && RANK[a] >= RANK[d.required_level];
    add('level', ok,
      ok ? `Your verified level ${a} meets the required ${d.required_level}`
        : a == null ? `Complete the initial assessment; the required level is ${d.required_level}`
        : `Your verified level ${a} is below the required ${d.required_level}`,
      { source: 'system_verified', required: d.required_level, actual: a });
  }

  if (d.required_skills.length) {
    const have = new Set((p?.skills || []).map(s => s.toLowerCase()));
    const missing = d.required_skills.filter(s => !have.has(s.toLowerCase()));
    add('skills', missing.length === 0,
      missing.length === 0 ? 'You list all required skills' : `Missing required skills: ${missing.join(', ')}`,
      { source: 'self_reported', required: d.required_skills, actual: p?.skills || [] });
  }

  return { eligible: rules.every(r => r.passed), rules };
}
module.exports = { evaluate, hydrate, RANK };
