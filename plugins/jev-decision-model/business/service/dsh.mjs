import { readFile } from 'node:fs/promises';
import { createJevActions } from './jev.mjs';

export const name = 'jev-decision-model';
export const inject = ['tools', 'credentials', 'skills'];

export async function apply(ctx) {
  const manifest = JSON.parse(await readFile(new URL('../ipollowork.plugin.json', import.meta.url), 'utf8'));
  const skillFile = await readFile(new URL('../skills/jev-decision/SKILL.md', import.meta.url), 'utf8');
  const service = createJevActions({ getApiKey: async () => (await ctx.credentials.resolve('TYPESAFE_API_KEY'))?.value });
  ctx.effect(() => service.dispose);
  const resource = manifest.resources.find(item => item.type === 'local-service');
  for (const action of resource.actions) {
    ctx.tools.register({
      name: `jev_${action.id.replaceAll('-', '_')}`,
      description: action.description,
      parameters: action.inputSchema,
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      timeoutMs: 25_000,
      isConcurrencySafe: () => true,
      execute: (args, exec) => service.actions[action.id](args, { signal: exec.signal }),
    });
  }
  const skill = manifest.resources.find(item => item.type === 'skill');
  ctx.skills.register({
    name: skill.id,
    description: skill.description,
    content: skillFile.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim(),
    source: 'bundled',
  });
}
