require('dotenv').config();
const { createDb } = require('./db');
const { createApp } = require('./app');
const port = process.env.PORT || 4000;
const db = createDb(process.env.DB_PATH || 'intelliplace.db');
createApp(db).listen(port, () => console.log(`IntelliPlace API on :${port}`));
