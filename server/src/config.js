const path = require('path');

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const port = env.PORT === undefined || env.PORT === '' ? 4000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');

  let origin = null;
  if (env.CLIENT_ORIGIN) {
    let u;
    try { u = new URL(env.CLIENT_ORIGIN); } catch { throw new Error('CLIENT_ORIGIN must be a valid URL such as https://placement.example.edu'); }
    if (!/^https?:$/.test(u.protocol) || u.pathname !== '/' || u.search || u.hash) throw new Error('CLIENT_ORIGIN must be an origin only (scheme, host and optional port)');
    origin = u.origin;
  }
  if (production && !origin) throw new Error('CLIENT_ORIGIN is required in production');

  const trust = env.TRUST_PROXY;
  let trustProxy = false;
  if (trust !== undefined && trust !== '' && trust !== 'false') {
    if (trust === 'true') trustProxy = true;
    else if (/^\d+$/.test(trust)) trustProxy = Number(trust);
    else throw new Error('TRUST_PROXY must be true, false or a number of proxy hops');
  }

  const origins = origin ? [origin] : [];
  if (!production) origins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  const clientDist = env.CLIENT_DIST ? path.resolve(env.CLIENT_DIST) : path.resolve(__dirname, '..', '..', 'client', 'dist');
  const lim = (name, def) => {
    const v = env[name];
    if (v === undefined || v === '') return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 1000000) throw new Error(name + ' must be an integer from 1 to 1000000');
    return n;
  };
  const rateLimits = {
    auth: { windowMs: 15 * 60 * 1000, max: lim('RATE_LIMIT_AUTH_MAX', 20) },
    register: { windowMs: 15 * 60 * 1000, max: lim('RATE_LIMIT_REGISTER_MAX', 10) }
  };  return { nodeEnv, production, port, dbPath: env.DB_PATH || 'intelliplace.db', origins, trustProxy, clientDist, rateLimits };
}
module.exports = { loadConfig };
