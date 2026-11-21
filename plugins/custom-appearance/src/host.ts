import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { appearanceIndex } from './brand.ts';
import { choices, defaultPalette, endpoint, logoPath, maxEncodedLogo, maxLogoBytes, maxLogoSide,
  maxName, pluginId, validColor, type Appearance } from './model.ts';

export const name = pluginId;
export const inject = ['connection', 'connection.authentication', 'storageDomain', 'webServer'];

const hex = z.string().refine(validColor).transform(color => color.toLowerCase());
const colors = z.strictObject({ primary: hex, secondary: hex, text: hex, background: hex });
const palette = z.strictObject({ light: colors, dark: colors });
const appName = z.string().trim().max(maxName).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value));
const revision = z.number().int().nonnegative();
const version = z.enum(choices);
const logo = z.string().max(maxEncodedLogo).refine(value => pngBuffer(value) !== undefined);
const profile = z.object({ revision, active: version, name: appName, custom: palette, logo: logo.nullable() });
type Profile = z.infer<typeof profile>;
const config = { name: 'ipollo_custom_appearance', version: 1,
  tables: { preferences: { valueSchema: profile } } } as const;
const action = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('activate'), active: version }),
  z.strictObject({ action: z.literal('save'), revision, name: appName, custom: palette,
    useCustom: z.boolean(), logo: logo.nullable().optional() }),
]);
const defaults: Profile = { revision: 0, active: 'default', name: '', custom: defaultPalette, logo: null };
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function pngBuffer(value: string): Buffer | undefined {
  if (value.length > maxEncodedLogo || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 45 || bytes.length > maxLogoBytes || !bytes.subarray(0, 8).equals(pngSignature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > maxLogoSide || height > maxLogoSide) return;
  let image = false;
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    offset += 12 + length;
    if (offset > bytes.length) return;
    if (type === 'IDAT') image = image || length > 0;
    if (type === 'IEND') return image && length === 0 && offset === bytes.length ? bytes : undefined;
  }
}

interface Host {
  connection: { admit(req: IncomingMessage): { rejection: number } | { peer: { principal: { kind: string } } } };
  webServer: {
    register(spec: { kind: 'exact'; path: string; auth?: 'anonymous';
      handler(req: IncomingMessage, res: ServerResponse): Promise<void> }): () => void;
    tapIndex(transform: (html: string) => string): () => void;
  };
  storageDomain: { open(spec: typeof config): Promise<{
    table(name: 'preferences'): { get(key: string): Profile | undefined; put(key: string, value: Profile): Promise<void> };
    close(): Promise<void>;
  }> };
  effect(setup: () => () => void | Promise<void>, description?: string): unknown;
}
const key = 'active';
const privateHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function json(res: ServerResponse, status: number, value: Appearance | { error: string }) {
  res.writeHead(status, { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
function view({ logo, ...settings }: Profile): Appearance {
  return { ...settings, hasLogo: logo !== null };
}
async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxEncodedLogo + 2048) return undefined;
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { return undefined; }
}

export async function apply(ctx: Host) {
  const domain = await ctx.storageDomain.open(config);
  const table = domain.table('preferences');
  let current = table.get(key) ?? defaults;
  let currentLogo = current.logo ? pngBuffer(current.logo) : undefined;
  let queue: Promise<void> = Promise.resolve();
  ctx.effect(() => async () => { await queue; await domain.close(); }, 'appearance profile storage');
  ctx.effect(() => ctx.webServer.tapIndex(html => appearanceIndex(html, current.name, !!currentLogo, current.revision)),
    'appearance name and favicon');
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: logoPath, auth: 'anonymous', async handler(req, res) {
    if (req.method !== 'GET' || !currentLogo) { res.writeHead(404, privateHeaders).end(); return; }
    res.writeHead(200, { ...privateHeaders, 'Content-Type': 'image/png',
      'Content-Security-Policy': "sandbox; default-src 'none'" }).end(currentLogo);
  } }), 'appearance logo');
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: endpoint, async handler(req, res) {
    const admitted = ctx.connection.admit(req);
    if ('rejection' in admitted) return json(res, admitted.rejection, { error: 'unauthorized' });
    if (admitted.peer.principal.kind !== 'owner'
      || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'] ?? ''))
      return json(res, 403, { error: 'unauthorized' });
    if (req.method === 'GET') return json(res, 200, view(current));
    if (req.method !== 'POST') return json(res, 405, { error: 'invalid' });
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json'))
      return json(res, 415, { error: 'invalid' });
    const parsed = action.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: 'invalid' });
    const wanted = parsed.data;
    const operation = queue.then(async () => {
      if (wanted.action === 'save' && wanted.revision !== current.revision)
        return json(res, 409, { error: 'changed' });
      if (wanted.action === 'activate' && wanted.active === current.active)
        return json(res, 200, view(current));
      const updated: Profile = wanted.action === 'activate'
        ? { ...current, revision: current.revision + 1, active: wanted.active }
        : { revision: current.revision + 1, active: wanted.useCustom ? 'custom' : current.active, name: wanted.name,
          custom: wanted.custom, logo: wanted.logo === undefined ? current.logo : wanted.logo };
      await table.put(key, updated);
      current = updated;
      currentLogo = updated.logo ? pngBuffer(updated.logo) : undefined;
      json(res, 200, view(current));
    });
    queue = operation.catch(() => undefined);
    try { await operation; } catch { json(res, 500, { error: 'save' }); }
  } }), 'appearance settings API');
}
