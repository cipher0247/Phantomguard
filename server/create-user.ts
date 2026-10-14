// Usage: PG_NEW_PASSWORD=... npm run create-user -- you@example.com "Your Name"  (password via env, not argv/history)
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

const [email, name] = process.argv.slice(2), pw = process.env.PG_NEW_PASSWORD;
if (!email || !name || !pw || pw.length < 10) { console.error('Need email, name and PG_NEW_PASSWORD (>=10 chars).'); process.exit(1); }
openDb().prepare('INSERT INTO users (email,name,pw_hash,created_at) VALUES (?,?,?,?)').run(email.toLowerCase(), name, hashPassword(pw), new Date().toISOString());
console.log(`Created ${email}`);
