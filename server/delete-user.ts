// Usage: npm run delete-user -- you@example.com   (also revokes the user's sessions and deletes their scan history)
import { openDb } from './db.js';

const email = process.argv[2]?.toLowerCase();
if (!email) { console.error('Usage: npm run delete-user -- <email>'); process.exit(1); }
const db = openDb();
const u = db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: number } | undefined;
if (!u) { console.error('No such user.'); process.exit(1); }
for (const t of ['sessions', 'scans']) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(u.id);
db.prepare('DELETE FROM users WHERE id=?').run(u.id);
console.log(`Deleted ${email}, their sessions and scan history.`);
