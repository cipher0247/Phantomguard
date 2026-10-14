// Local-only demo account. Generates a unique random password each run and prints it once; nothing is hardcoded or stored in git.
// Usage: npm run demo:setup   (re-running resets the password)
import { randomBytes } from 'node:crypto';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

if (process.env.NODE_ENV === 'production') { console.error('demo:setup is disabled in production.'); process.exit(1); }
const email = 'demo@phantomguard.local', pw = randomBytes(12).toString('base64url');
const db = openDb();
db.prepare('DELETE FROM users WHERE email=?').run(email);
db.prepare('INSERT INTO users (email,name,pw_hash,created_at) VALUES (?,?,?,?)').run(email, 'Demo User', hashPassword(pw), new Date().toISOString());
console.log(`Demo account ready.\n  email:    ${email}\n  password: ${pw}\nRemove with: npm run delete-user -- ${email}`);
