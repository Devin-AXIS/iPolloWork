/** Platform-curated references; code stays in its publisher's registry or repository. */
import { z } from 'zod';
import semver from 'semver';
import type { App } from './http.js';
import type { Store } from './database.js';
import { Settings } from './settings.js';
import { audit, requireAdmin } from './domain.js';
import { ServiceError } from './errors.js';

const httpsUrl = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
});
const version = z.string().max(100).refine(value => semver.valid(value) !== null && !/^[v=\s]/.test(value));
export const marketEntry = z.object({
  name: z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/),
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(2000).optional(),
  author: z.string().trim().min(1).max(100).optional(),
  homepage: z.string().max(2048).url().refine(value => { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password }).optional(),
  icon: z.string().max(45000).regex(/^data:image\/(?:svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).optional(),
  metadata: z.object({ category: z.enum(['productivity', 'communication', 'creative']) }).strict(),
  versions: z.tuple([z.object({
    version,
    publishTimestamp: z.number().int().nonnegative().lt(100_000_000_000),
    source: z.discriminatedUnion('type', [
      z.object({ type: z.literal('npm'), registry: httpsUrl.optional() }).strict(),
      z.object({ type: z.literal('git'), url: httpsUrl.refine(value => new URL(value).href === value && new URL(value).pathname.split('/').filter(Boolean).length >= 2 && !/\.(tgz|tar\.gz)$/i.test(value)), commit: z.string().regex(/^[a-f0-9]{40}$/), path: z.string().max(500).regex(/^[a-zA-Z0-9_@+.-]+(?:\/[a-zA-Z0-9_@+.-]+)*$/).refine(value => !value.split('/').some(part => part === '.' || part === '..')).optional() }).strict(),
    ]),
    engines: z.object({ dsh: z.string().trim().min(1).max(120).refine(value => !value.startsWith('workspace:') && semver.validRange(value) !== null) }).strict().optional(),
  }).strict()]),
}).strict();
const key = 'market.catalog';
const maxEntries = 200;

export function mountMarket(app: App, store: Store, settings: Settings) {
  const entries = async () => {
    const record = await settings.get(key);
    return z.array(marketEntry).max(maxEntries).parse(JSON.parse(record.entries ?? '[]'));
  };
  // Catalog references are intentionally public; only authenticated platform admins may change them.
  app.get('/api/market/catalog', async c => {
    c.header('Cache-Control', 'no-store');
    return c.json({ plugins: await entries() });
  });
  app.get('/api/v1/market/manage', c => c.json({ canManage: c.get('actor').role === 'admin' }));
  app.post('/api/v1/market/plugins', async c => {
    const actor = c.get('actor');
    requireAdmin(actor);
    const entry = marketEntry.parse(await c.req.json());
    await store.transaction(async () => {
      // One global, bounded catalog uses the existing operator settings lifecycle and audit log.
      await store.run("SELECT pg_advisory_xact_lock(hashtext('ipollowork.market.catalog'))");
      const plugins = await entries();
      if (plugins.some(item => item.name === entry.name)) throw new ServiceError('MARKET_DUPLICATE', 409);
      if (plugins.length >= maxEntries) throw new ServiceError('MARKET_FULL', 409);
      plugins.push(entry);
      const data = JSON.stringify(plugins);
      if (Buffer.byteLength(data) > 524288) throw new ServiceError('MARKET_FULL', 413);
      await settings.set(key, { entries: data });
      await audit(store, actor, 'market.add', entry.name);
    });
    return c.json({ ok: true }, 201);
  });
}
