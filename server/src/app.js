const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { requireAuth, requireRole } = require('./auth');
function createApp(db) {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/health', (req, res) => {
    const { v } = db.prepare('select sqlite_version() v').get();
    res.json({ status: 'ok', db: 'ok', sqlite: v });
  });
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/student', require('./routes/student')(db));
  app.use('/api/admin/audit', requireAuth(db), requireRole('admin'), require('./routes/audit')(db));
  app.use('/api/drives', requireAuth(db), require('./routes/drives')(db));
  app.use('/api/student', require('./routes/practice')(db));
  app.use('/api/mocks', requireAuth(db), require('./routes/mocks')(db));
  app.use('/api/companies', requireAuth(db), require('./routes/companies')(db));
  app.use('/api/analytics', requireAuth(db), require('./routes/analytics')(db));
  app.use('/api/resume', requireAuth(db), require('./routes/resume')(db));
  app.use('/api/recommendations', requireAuth(db), require('./routes/recommendations')(db));
  app.use('/api/admin/users', requireAuth(db), requireRole('admin'), require('./routes/users')(db));
  app.get('/api/admin/ping', requireAuth(db), requireRole('admin'), (req, res) => res.json({ ok: true }));
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: 'Server error' }));
  return app;
}
module.exports = { createApp };
