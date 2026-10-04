# IntelliPlace

Placement training and career-readiness management system for a college.
Server: Node.js, Express, SQLite. Client: React, Vite.

## Requirements
Node.js 20 or newer and npm.

## Development
Open two terminals.

    cd server && npm install && npm run seed && npm run dev      (http://localhost:4000)
    cd client && npm install && npm run dev                      (http://localhost:5173)

The client proxies /api to the server.

## Create the first administrator
Interactive, with a hidden password prompt:

    cd server && npm run bootstrap-admin

Administrators then create coordinator accounts in the Users screen. Students register themselves.

## Tests

    cd server && npm test
    cd client && npm test

## Production
Build the client, then start the server. The server serves the built client from client/dist.

    cd client && npm run build
    cd server && set NODE_ENV=production && set CLIENT_ORIGIN=https://placement.example.edu && npm start

Environment variables (server/.env or the process environment):

| Name | Meaning |
|------|---------|
| NODE_ENV | production enables strict configuration |
| PORT | listen port, default 4000 |
| DB_PATH | SQLite file, default intelliplace.db |
| CLIENT_ORIGIN | the one allowed browser origin, required in production, no wildcards |
| TRUST_PROXY | true or a hop count, only when running behind a reverse proxy you control |
| CLIENT_DIST | path to the built client, default ../client/dist |

Put the server behind HTTPS (a reverse proxy such as nginx or Caddy). Passwords and session tokens must never travel over plain HTTP.

## Security notes
- Passwords are hashed with scrypt. Sessions are random tokens stored hashed.
- Accounts lock for 15 minutes after 5 consecutive failures. Logins and password changes are also limited per IP (20 per 15 minutes) and registrations (10 per 15 minutes).
- Rate limits are held in memory: they reset on restart and are not shared between several server processes. A multi-process deployment needs a shared store.
- Assessment timing, grading and eligibility are decided by the server, never the client.
- Verified results (system-graded) are kept separate from self-reported information everywhere.
- Every important action is written to a hash-chained, append-only audit log. The chain cannot reveal that the newest entries were deleted, so export the audit head from Admin, Audit log regularly, store the file separately, and check the log against it.
- Back up the SQLite file regularly, including the -wal file if present, or stop the server and copy intelliplace.db.

## Roadmap status
See the planned scope in the project brief. Implemented so far: accounts and roles, lockout and rate limiting, student profile (basic), initial assessment, practice, mock tests, eligibility engine, drives and applications, company preparation, readiness analytics, recommendations, resume with export, staff and admin screens, audit trail with head export.
