import { z } from 'zod';
import { ServiceError } from './errors.js';
import type { MarketEntry } from './market.js';

const manifestSchema = z.object({
  name: z.string(), version: z.string(), displayName: z.unknown().optional(), description: z.unknown().optional(),
  homepage: z.string().optional(), author: z.union([z.string(), z.object({ name: z.string() })]).optional(),
  engines: z.object({ dsh: z.string().optional() }).optional(),
  dsh: z.object({ bundle: z.object({ patch: z.string().min(1), title: z.unknown().optional(), description: z.unknown().optional() }) }),
});
function label(input: unknown): string | undefined {
  if (typeof input === 'string') return input.trim() || undefined;
  if (!input || typeof input !== 'object') return;
  for (const key of ['zh-CN', 'zh', 'en']) {
    const v = Reflect.get(input, key);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
}
async function readRemote(url: string, fetcher: typeof fetch, optional = false): Promise<string> {
  try {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(9000), headers: { 'User-Agent': 'iPolloWork-plugin-catalog' } });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      if (optional && response.status === 404) return '';
      throw new ServiceError('MARKET_SOURCE_FETCH', response.status === 404 ? 404 : 503, response.status === 404 ? '没有找到该插件，请核对包名、仓库或插件子目录。' : '插件来源暂时无法读取，请稍后重试。');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1048576) { await reader.cancel(); throw new ServiceError('MARKET_SOURCE_SIZE', 413, '插件元数据超过 1 MB。'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('MARKET_SOURCE_FETCH', 503, '无法连接插件来源，请稍后重试。');
  }
}
function json(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new ServiceError('MARKET_SOURCE_JSON', 422, '插件来源没有返回有效的元数据。'); }
}
export async function discoverMarket(source: string, fetcher: typeof fetch = fetch): Promise<MarketEntry> {
  const input = source.trim().replace(/\/$/, '');
  const git = /^https:\/\/github\.com\/([\w-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w.-]+)(?:\/([\w@+.\/-]+))?)?$/.exec(input);
  const npm = /^(?:https:\/\/(?:www\.)?npmjs\.com\/package\/)?((?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*)(?:(?:@|\/v\/)([\w.+-]+))?$/.exec(input);
  let raw: unknown, readme = '', owner: string | undefined, homepage: string | undefined;
  let install: MarketEntry['versions'][0]['source'];
  let timestamp = Math.floor(Date.now() / 1000);
  if (git && git.slice(1).every(s => s === undefined || s.split('/').every(p => p && p !== '.' && p !== '..'))) {
    const [, org, repo, ref, path] = git;
    const commit = z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/), commit: z.object({ committer: z.object({ date: z.string().datetime() }) }) }).parse(json(await readRemote('https://api.github.com/repos/' + org + '/' + repo + '/commits/' + (ref || 'HEAD'), fetcher)));
    const base = 'https://raw.githubusercontent.com/' + org + '/' + repo + '/' + commit.sha + '/' + (path ? path + '/' : '');
    raw = json(await readRemote(base + 'package.json', fetcher));
    readme = await readRemote(base + 'README.md', fetcher, true).catch(() => '');
    owner = org; homepage = 'https://github.com/' + org + '/' + repo;
    timestamp = Math.floor(Date.parse(commit.commit.committer.date) / 1000);
    install = { type: 'git', url: homepage, commit: commit.sha, ...(path && { path }) };
  } else if (npm) {
    raw = json(await readRemote('https://registry.npmjs.org/' + encodeURIComponent(npm[1]) + '/' + (npm[2] || 'latest'), fetcher));
    if (!raw || typeof raw !== 'object' || Reflect.get(raw, 'name') !== npm[1]) throw new ServiceError('MARKET_SOURCE_NAME', 422, '注册表中的插件名称不匹配。');
    readme = label(Reflect.get(raw, 'readme')) || '';
    owner = label(Reflect.get(raw, '_npmUser')?.name);
    homepage = 'https://www.npmjs.com/package/' + npm[1];
    install = { type: 'npm' };
  } else throw new ServiceError('MARKET_SOURCE_FORMAT', 400, '请输入 npm 包名、npm 包页面或 GitHub 仓库／插件子目录地址。');
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError('MARKET_SOURCE_MANIFEST', 422, '此目录没有可安装的 DSH 插件清单，请检查 package.json 和 dsh.bundle.patch。');
  const m = parsed.data;
  const firstHeading = /^#\s+(.+)$/m.exec(readme)?.[1];
  const firstParagraph = readme.split(/\r?\n\s*\r?\n/).map(v => v.trim()).find(v => v && !/^[#<!\[|`*-]/.test(v));
  const descriptions = [label(m.dsh.bundle.description), label(m.description), firstParagraph].filter((v): v is string => !!v);
  const description = descriptions.find(v => /\p{Script=Han}/u.test(v)) ?? descriptions[0];
  const author = (typeof m.author === 'string' ? m.author.replace(/\s*<[^>]*>.*/, '') : m.author?.name) || owner;
  const safeHome = m.homepage && URL.canParse(m.homepage) ? new URL(m.homepage) : undefined;
  return {
    name: m.name, title: (label(m.dsh.bundle.title) || label(m.displayName) || firstHeading || m.name).slice(0, 100),
    ...(description && { description: description.slice(0, 2000) }), ...(author && { author: author.slice(0, 100) }),
    homepage: safeHome && ['https:', 'http:'].includes(safeHome.protocol) && !safeHome.username && !safeHome.password ? safeHome.href : homepage,
    metadata: { category: 'productivity' },
    versions: [{ version: m.version, publishTimestamp: timestamp, source: install, ...(m.engines?.dsh && { engines: { dsh: m.engines.dsh } }) }],
  };
}
