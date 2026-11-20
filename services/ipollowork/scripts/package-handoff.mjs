/** Export only the independent service's source, lockfile and deployment materials. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'out');
mkdirSync(out, { recursive: true });
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const staging = mkdtempSync(join(out, 'handoff-'));
const source = join(staging, 'ipollowork-services');
mkdirSync(source);
const excluded = /^(?:node_modules|dist|data|out|\.git)$|\.(?:pem|key|secret|p12|pfx|dump|sqlite(?:-wal|-shm)?)$/i;
for (const name of ['src', 'web', 'scripts', 'tests', 'deploy', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts', 'Dockerfile', 'compose.yml', '.env.example', '.dockerignore', '.gitignore', 'README.md', 'README.zh.md', 'HANDOFF.md', 'HANDOFF.zh.md', 'VALIDATION.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  cpSync(join(root, name), join(source, name), { recursive: true, filter: path => {
    const file = basename(path);
    return !lstatSync(path).isSymbolicLink() && !excluded.test(file) && (file === '.env.example' || !file.startsWith('.env'));
  } });
}
const hashes = [];
function hashFiles(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name), relative = prefix + entry.name;
    if (entry.isDirectory()) hashFiles(path, relative + '/');
    else hashes.push(createHash('sha256').update(readFileSync(path)).digest('hex') + '  ' + relative);
  }
}
let commit = null, dirty = true;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  dirty = !!execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: root, encoding: 'utf8' }).trim();
} catch { /* An exported handoff can be packaged again without Git. */ }
writeFileSync(join(source, 'VERSION.json'), JSON.stringify({ version, sourceCommit: commit, includesWorkingTreeChanges: dirty, packagedAt: new Date().toISOString(),
  node: '>=24.15.0', targets: ['runtime', 'operations'], imageBuilt: false,
}, null, 2) + '\n');
hashFiles(source);
writeFileSync(join(source, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
const archive = join(out, 'ipollowork-services-' + version + '-' + new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + '.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', staging, 'ipollowork-services'], { stdio: 'inherit' });
const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(archive + '.sha256', digest + '  ' + basename(archive) + '\n');
console.log(JSON.stringify({ archive, source, sha256: digest, imageBuilt: false }, null, 2));
