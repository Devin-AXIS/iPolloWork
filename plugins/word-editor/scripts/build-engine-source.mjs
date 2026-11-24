import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../vendor/eigenpal', import.meta.url));
const options = { cwd, stdio: 'inherit' };
execFileSync('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], options);
for (const name of ['i18n', 'core', 'react'])
  execFileSync('bun', ['run', '--filter', '@docx-editor.dev/' + name, 'build'], options);
execFileSync(process.execPath, ['scripts/generate-third-party-notices.mjs'], options);
