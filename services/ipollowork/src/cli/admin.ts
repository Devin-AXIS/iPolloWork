import { z } from 'zod';
import { loadConfig } from '../config.js';
import { openOperatorDatabase } from './database.js';
import { loadEnvironment } from './environment.js';
import { audit } from '../domain.js';

loadEnvironment();
const args = process.argv.slice(2);
const promote = args.includes('--promote-existing');
const positional = args.filter(arg => arg !== '--promote-existing');
if (positional.length < 1 || positional.length > 2 || positional.some(arg => arg.startsWith('--')))
  throw new Error('Usage: npm run admin -- email [name] [--promote-existing]; set ADMIN_PASSWORD for a new account.');
const email = z.email().parse(positional[0]?.trim().toLowerCase());
const name = z.string().trim().min(1).max(100).parse(positional[1] ?? '管理员');
const { store, auth } = await openOperatorDatabase(loadConfig());
try {
  const existing = await store.one('SELECT id,role,banned FROM "user" WHERE email=?', email);
  if (existing?.banned) throw new Error('Account is banned; resolve its status before granting administrator access.');
  if (existing?.role === 'admin') {
    console.log('Account is already an administrator; nothing changed.');
  } else {
    if (existing && !promote)
      throw new Error('Account already exists. Use --promote-existing explicitly to retain its password and data and grant the administrator role.');
    const password = process.env.ADMIN_PASSWORD;
    if (!existing && !password)
      throw new Error('Set ADMIN_PASSWORD in the operator environment; do not pass it as an argument.');
    const userId = existing ? String(existing.id) : (await auth.api.signUpEmail({
      body: { email, name, password: z.string().min(10).parse(password) },
    })).user.id;
    await store.transaction(async () => {
      await store.run(existing ? 'UPDATE "user" SET role=? WHERE id=?' : 'UPDATE "user" SET role=?,"emailVerified"=true WHERE id=?', 'admin', userId);
      await audit(store, { id: userId, email, name, role: 'admin' }, 'user.bootstrap-admin', userId);
    });
    console.log(existing ? 'Administrator role granted; existing credentials retained.' : 'Administrator created.');
  }
} finally {
  await store.close();
}
