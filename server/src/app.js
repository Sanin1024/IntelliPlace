const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
function createApp(db) {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/health', (req, res) => {
    const { v } = db.prepare('select sqlite_version() v').get();
    res.json({ status: 'ok', db: 'ok', sqlite: v });
  });
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: 'Server error' }));
  return app;
}
module.exports = { createApp };
