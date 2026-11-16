import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createArchive } from '../service/archive.ts';
import { skillPackageFiles } from '../service/skill-package.ts';
import { compileSkill, importChromeFlow } from '../service/model.ts';

test('npm export retains long skill names, resources and reversible DSH registration', async () => {
 const root = await mkdtemp(join(tmpdir(), 'dsh-skill-package-'));
 try {
  const compiled = compileSkill(importChromeFlow({ title: 'Example', steps: [{ type: 'navigate', url: 'https://example.com' }] }), { skillName: 'a'.repeat(64) });
  await writeFile(join(root, 'skill.tgz'), createArchive(skillPackageFiles(compiled)));
  execFileSync('tar', ['-xzf', join(root, 'skill.tgz'), '-C', root]);
  const manifest = JSON.parse(await readFile(join(root, 'package/package.json'), 'utf8'));
  assert.equal(manifest.name, compiled.manifest.name);
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  const plugin = await import(pathToFileURL(join(root, 'package/index.js')).href);
  let registered: {name: string; resourceBase: {path: string}} | undefined;
  let active = false; let dispose: (() => void) | undefined;
  await plugin.apply({ effect: (fn: () => () => void) => { dispose = fn(); }, skills: { register: (skill: typeof registered) => { registered = skill; active = true; return () => { active = false; }; } } });
  assert.equal(registered?.name, compiled.name);
  assert.match(await readFile(join(registered!.resourceBase.path, 'references/workflow.json'), 'utf8'), /example.com/);
  const evals = JSON.parse(await readFile(join(registered!.resourceBase.path, 'evals/evals.json'), 'utf8'));
  assert.equal(evals.evals[0].status, 'not_run');
  assert.equal(evals.evals[0].expected_output, null);
  assert(evals.evals[0].missing.includes('completion_missing'));
  const evidence = JSON.parse(await readFile(join(registered!.resourceBase.path, 'references/evidence.json'), 'utf8'));
  assert.equal(evidence.observedStepCount, 1);
  assert(active); dispose!(); assert(!active);
 } finally { await rm(root, { recursive: true, force: true }); }
});
