import { prepareEvidence } from './evidence.ts';
import type { compileSkill } from './model.ts';
/** One standard npm tarball that DSH can install and disable independently. */
export function skillPackageFiles(compiled: ReturnType<typeof compileSkill>): Record<string, string> {
  const { name, manifest, skill, workflow } = compiled;
  const entry = `import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const name = ${JSON.stringify(name)};
export const inject = ['skills'];
export async function apply(ctx) {
 const root = new URL(${JSON.stringify(`./skills/${name}/`)}, import.meta.url);
 const content = await readFile(new URL('SKILL.md', root), 'utf8');
 ctx.effect(() => ctx.skills.register({ name, description: ${JSON.stringify(manifest.description)}, content, source: 'runtime', resourceBase: { kind: 'directory', path: fileURLToPath(root) } }));
}
`;
  const session = { id: workflow.source.sessionId, title: workflow.title, createdAt: workflow.source.recordedAt, status: workflow.source.reviewed ? 'reviewed' as const : 'draft' as const, steps: workflow.steps, ...('goal' in workflow ? {goal: workflow.goal} : {}) };
  const evidence = prepareEvidence(session);
  const evals = { skill_name: name, evals: [{ id: 1, prompt: session.goal ?? session.title, expected_output: evidence.checks.filter(c=>c.final).map(c=>c.expected).join('') || null, assertions: evidence.checks.map(c=>c.expected), status: 'not_run', missing: evidence.gaps.map(g=>g.code) }] };
  return {
    'package.json': JSON.stringify(manifest, null, 2),
    'cordis.patch.yml': `- insert:\n    - id: ${name}\n      name: ${JSON.stringify(manifest.name)}\n`,
    'index.js': entry,
    [`skills/${name}/SKILL.md`]: skill,
    [`skills/${name}/references/evidence.json`]: JSON.stringify(evidence, null, 2),
    [`skills/${name}/evals/evals.json`]: JSON.stringify(evals, null, 2),
    [`skills/${name}/references/workflow.json`]: JSON.stringify(workflow, null, 2),
  };
}
