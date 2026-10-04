const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { requireAuth, requireRole } = require('./auth');
const { loadConfig } = require('./config');
const { createRateLimiter } = require('./rateLimit');
const { serveClient } = require('./static');

function createApp(db, options = {}) {
  const config = options.config || loadConfig(process.env);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.origins.includes(origin)) }));
  app.use(express.json({ limit: '100kb' }));

  const rl = options.rateLimits || config.rateLimits;
  const authLimit = createRateLimiter(rl.auth);
  const registerLimit = createRateLimiter(rl.register);
  app.post('/api/auth/login', authLimit);
  app.post('/api/auth/password', authLimit);
  app.post('/api/auth/register', registerLimit);

  app.get('/api/health', (req, res) => {
    const { v } = db.prepare('select sqlite_version() v').get();
    res.json({ status: 'ok', db: 'ok', sqlite: v });
  });
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/student', require('./routes/student')(db));
  app.use('/api/student', require('./routes/practice')(db));
  app.use('/api/drives', requireAuth(db), require('./routes/drives')(db));
  app.use('/api/mocks', requireAuth(db), require('./routes/mocks')(db));
  app.use('/api/companies', requireAuth(db), require('./routes/companies')(db));
  app.use('/api/analytics', requireAuth(db), require('./routes/analytics')(db));
  app.use('/api/resume', requireAuth(db), require('./routes/resume')(db));
  app.use('/api/recommendations', requireAuth(db), require('./routes/recommendations')(db));
  app.use('/api/admin/users', requireAuth(db), requireRole('admin'), require('./routes/users')(db));
  app.use('/api/admin/audit', requireAuth(db), requireRole('admin'), require('./routes/audit')(db));
  app.get('/api/admin/ping', requireAuth(db), requireRole('admin'), (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  if (options.serveClient !== false) serveClient(app, config.clientDist);
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    res.status(err.status || 500).json({ error: 'Server error' });
  });
  return app;
}
module.exports = { createApp };
