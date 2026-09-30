const express = require('express');
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { verifiedView } = require('../readiness');

const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
const yr = v => Number.isInteger(v) && v >= 1950 && v <= 2100;
const isUrl = v => typeof v === 'string' && v.length <= 300 && /^https?:\/\/\S+$/i.test(v);
const has = (o, k) => o[k] !== undefined && o[k] !== null;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function years(o, out) {
  for (const k of ['start_year', 'end_year']) {
    if (has(o, k)) { if (!yr(o[k])) return false; out[k] = o[k]; }
  }
  return !(out.start_year != null && out.end_year != null && out.start_year > out.end_year);
}
function optText(o, k, max, out) {
  if (!has(o, k)) return true;
  if (!str(o[k], max)) return false;
  out[k] = o[k].trim();
  return true;
}
const education = i => {
  if (!isObj(i) || !str(i.institution, 150) || !str(i.degree, 150)) return null;
  const o = { institution: i.institution.trim(), degree: i.degree.trim() };
  return years(i, o) && optText(i, 'grade', 50, o) ? o : null;
};
const project = i => {
  if (!isObj(i) || !str(i.title, 100)) return null;
  const o = { title: i.title.trim() };
  if (!optText(i, 'description', 500, o)) return null;
  if (has(i, 'tech')) {
    if (!Array.isArray(i.tech) || i.tech.length > 10 || !i.tech.every(t => str(t, 30))) return null;
    o.tech = i.tech.map(t => t.trim());
  }
  if (has(i, 'link')) { if (!isUrl(i.link)) return null; o.link = i.link; }
  return o;
};
const experience = i => {
  if (!isObj(i) || !str(i.organization, 100) || !str(i.role, 100)) return null;
  const o = { organization: i.organization.trim(), role: i.role.trim() };
  return years(i, o) && optText(i, 'description', 500, o) ? o : null;
};
const certification = i => {
  if (!isObj(i) || !str(i.name, 100)) return null;
  const o = { name: i.name.trim() };
  if (!optText(i, 'issuer', 100, o)) return null;
  if (has(i, 'year')) { if (!yr(i.year)) return null; o.year = i.year; }
  return o;
};
const SECTIONS = [['education', 5, education], ['projects', 10, project], ['experience', 10, experience], ['certifications', 10, certification]];

function validate(b) {
  const out = {};
  for (const [k, max] of [['headline', 120], ['summary', 1000]]) {
    if (b[k] !== undefined) {
      if (typeof b[k] !== 'string' || b[k].length > max) return { error: `Invalid ${k}` };
      out[k] = b[k].trim() || null;
    }
  }
  for (const [k, max, fn] of SECTIONS) {
    if (b[k] === undefined) continue;
    if (!Array.isArray(b[k]) || b[k].length > max) return { error: `Invalid ${k}` };
    const items = b[k].map(x => fn(x));
    if (items.includes(null)) return { error: `Invalid ${k}` };
    out[k] = JSON.stringify(items);
  }
  if (!Object.keys(out).length) return { error: 'No valid fields provided' };
  return { out };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const span = o => (o.start_year || o.end_year)
  ? ` (${o.start_year ?? ''}${o.start_year && o.end_year ? ' &ndash; ' : ''}${o.end_year ?? ''})` : '';

function render(d, withVerified) {
  const s = d.self_reported, v = d.verified;
  const block = (title, html) => (html ? `<section><h2>${title}</h2>${html}</section>` : '');
  const academic = [s.department, s.year != null ? `Year ${s.year}` : null, s.cgpa != null ? `CGPA ${s.cgpa}` : null]
    .filter(Boolean).map(esc).join(' | ');
  const contact = [s.email, s.phone].filter(Boolean).map(esc).join(' | ');
  const edu = s.education.map(e => `<div class="item"><b>${esc(e.degree)}</b>, ${esc(e.institution)}${span(e)}${e.grade ? ' - ' + esc(e.grade) : ''}</div>`).join('');
  const proj = s.projects.map(p => `<div class="item"><b>${esc(p.title)}</b>${p.tech && p.tech.length ? ' <i>(' + p.tech.map(t => esc(t)).join(', ') + ')</i>' : ''}${p.description ? '<p>' + esc(p.description) + '</p>' : ''}${p.link ? '<p><a href="' + esc(p.link) + '" rel="noopener noreferrer">' + esc(p.link) + '</a></p>' : ''}</div>`).join('');
  const exp = s.experience.map(x => `<div class="item"><b>${esc(x.role)}</b>, ${esc(x.organization)}${span(x)}${x.description ? '<p>' + esc(x.description) + '</p>' : ''}</div>`).join('');
  const certs = s.certifications.map(c => `<div class="item">${esc(c.name)}${c.issuer ? ', ' + esc(c.issuer) : ''}${c.year ? ' (' + c.year + ')' : ''}</div>`).join('');
  const hasVerified = v.level || v.readiness.score != null;
  const verified = withVerified
    ? `<section class="verified"><h2>Verified by IntelliPlace</h2>${hasVerified
      ? `<p>Level: <b>${esc(v.level ?? 'not assessed')}</b>. Readiness: <b>${v.readiness.score ?? 'n/a'}</b> (${esc(v.readiness.band)}).</p>` +
        (v.categories.length ? '<ul>' + v.categories.map(c => `<li>${esc(c.category)}: ${c.accuracy}% accuracy over ${c.questions} questions</li>`).join('') + '</ul>' : '')
      : '<p>No verified results yet.</p>'}<p class="note">Computed by the IntelliPlace server from graded assessments. All other sections are self-reported by the student.</p></section>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.name)} - Resume</title>
<style>body{font-family:Arial,Helvetica,sans-serif;max-width:800px;margin:24px auto;padding:0 16px;color:#111;line-height:1.4}
h1{margin:0}h2{border-bottom:1px solid #999;margin:18px 0 6px;font-size:1.05em;text-transform:uppercase}
.item{margin:6px 0}.note{font-size:.85em;color:#555}.verified{background:#f3f7f3;padding:0 10px 6px}
@page{margin:14mm}@media print{body{margin:0;max-width:none}}</style></head><body>
<h1>${esc(s.name)}</h1>${s.headline ? `<div>${esc(s.headline)}</div>` : ''}<div>${contact}</div>${academic ? `<div>${academic}</div>` : ''}
${s.summary ? block('Summary', `<p>${esc(s.summary)}</p>`) : ''}${block('Education', edu)}${block('Projects', proj)}${block('Experience', exp)}${block('Certifications', certs)}${block('Skills', s.skills.length ? `<p>${esc(s.skills.join(', '))}</p>` : '')}${verified}
</body></html>`;
}

module.exports = function resumeRoutes(db) {
  const r = express.Router();
  r.use(requireRole('student'));

  function load(uid) {
    const u = db.prepare('select name, email from users where id = ?').get(uid);
    const p = db.prepare('select department, year, cgpa, phone, skills from student_profiles where user_id = ?').get(uid);
    const row = db.prepare('select * from resumes where user_id = ?').get(uid);
    const J = k => (row ? JSON.parse(row[k]) : []);
    const v = verifiedView(db, uid);
    return {
      self_reported: { source: 'self_reported', name: u.name, email: u.email, phone: p?.phone ?? null,
        department: p?.department ?? null, year: p?.year ?? null, cgpa: p?.cgpa ?? null, skills: p ? JSON.parse(p.skills) : [],
        headline: row?.headline ?? null, summary: row?.summary ?? null,
        education: J('education'), projects: J('projects'), experience: J('experience'), certifications: J('certifications') },
      verified: { source: 'system_verified', level: v.level,
        readiness: { score: v.readiness.score, band: v.readiness.band, confidence: v.readiness.confidence },
        categories: v.categories.filter(c => c.questions > 0).map(c => ({ category: c.category, accuracy: c.accuracy, questions: c.questions })) }
    };
  }

  r.get('/', (req, res) => res.json(load(req.user.id)));

  r.put('/', (req, res) => {
    const { out, error } = validate(req.body || {});
    if (error) return res.status(400).json({ error });
    const uid = req.user.id;
    db.prepare('insert or ignore into resumes(user_id) values(?)').run(uid);
    const cols = Object.keys(out);
    db.prepare(`update resumes set ${cols.map(c => c + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP where user_id = ?`)
      .run(...cols.map(c => out[c]), uid);
    audit(db, { actorId: uid, action: 'resume.update', entity: 'resume', entityId: uid, details: { fields: cols } });
    res.json(load(uid));
  });

  r.get('/export', (req, res) => {
    const withVerified = req.query.verified !== '0';
    audit(db, { actorId: req.user.id, action: 'resume.export', entity: 'resume', entityId: req.user.id, details: { verified: withVerified } });
    res.set('Cache-Control', 'no-store').type('html').send(render(load(req.user.id), withVerified));
  });

  return r;
};
