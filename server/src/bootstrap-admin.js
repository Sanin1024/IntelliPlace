require('dotenv').config();
const readline = require('readline');
const { createDb } = require('./db');
const { validateNewUser, createStaff } = require('./accounts');

function ask(q) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, a => { rl.close(); resolve(a); });
  });
}

function askHidden(q) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    process.stdout.write(q);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const finish = v => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(v);
    };
    const onData = chunk => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') return finish(buf);
        if (c === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const env = process.env;
  let name, email, password;
  if (env.ADMIN_NAME && env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    name = env.ADMIN_NAME; email = env.ADMIN_EMAIL; password = env.ADMIN_PASSWORD;
  } else {
    if (!process.stdin.isTTY) throw new Error('Run in an interactive terminal, or set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD');
    name = await ask('Admin name: ');
    email = await ask('Admin email: ');
    password = await askHidden('Password (min 8 characters, hidden): ');
    const again = await askHidden('Repeat password: ');
    if (password !== again) throw new Error('Passwords do not match');
  }
  const { out, error } = validateNewUser({ name, email, password });
  if (error) throw new Error(error);
  const db = createDb(env.DB_PATH || 'intelliplace.db');
  const u = createStaff(db, { ...out, role: 'admin', action: 'admin.bootstrap' });
  console.log(`Admin created: ${u.email} (id ${u.id})`);
}

if (require.main === module) main().catch(e => { console.error('Error: ' + e.message); process.exit(1); });
