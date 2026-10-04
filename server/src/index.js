require('dotenv').config();
const { loadConfig } = require('./config');
const { createDb } = require('./db');
const { createApp } = require('./app');

let config;
try { config = loadConfig(); } catch (e) { console.error('Configuration error: ' + e.message); process.exit(1); }
const db = createDb(config.dbPath);
createApp(db, { config }).listen(config.port, () => console.log(`IntelliPlace API on :${config.port} (${config.nodeEnv})`));
