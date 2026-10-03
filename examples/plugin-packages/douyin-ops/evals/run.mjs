import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const evalRoot = dirname(fileURLToPath(import.meta.url));
const hostRoot = process.env.IPOLLOWORK_ROOT?.trim() || resolve(evalRoot, '../../../..');
export const hostModule = path => import(pathToFileURL(resolve(hostRoot, path)).href);
export const { connect, evaluate, listTargets } = await hostModule('evals/runner/cdp.mjs');
const { parseVoiceoverScript } = await hostModule('evals/runner/voiceover.mjs');
export async function loadVoiceoverParagraphs(id) {
  const paragraphs = parseVoiceoverScript(await readFile(resolve(evalRoot, 'voiceovers', id + '.md'), 'utf8'));
  if (!paragraphs.length) throw new Error('Voiceover has no numbered paragraphs: ' + id);
  return paragraphs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.includes('--out')) args.push('--out', resolve(evalRoot, 'results', new Date().toISOString().replace(/[:.]/g, '-')));
  const child = spawnSync(process.execPath, [...process.execArgv, resolve(hostRoot, 'evals/runner/run.mjs'), ...args], {
    stdio: 'inherit', env: { ...process.env, IPOLLOWORK_EVAL_FLOWS_DIR: resolve(evalRoot, 'flows') },
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}
