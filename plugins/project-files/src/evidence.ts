import { basename } from 'node:path';
import { z } from 'zod';
import type { Input } from './API.ts';

const filename = z.string().min(1).max(512);
const attachment = z.object({
  attachmentId: z.string().min(1).max(128),
  name: filename.optional(),
  bytes: z.number().int().nonnegative(),
});
const image = attachment.extend({
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  originalDimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
});
const verbatim = attachment.extend({ name: filename });
const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), attachment: verbatim }),
  z.object({ type: z.literal('image'), attachment: image }),
]);
const message = z.object({ source: z.object({ kind: z.string() }), content: z.array(z.unknown()) });
const delivered = z.object({ files: z.array(z.object({
  path: z.string().min(1).max(4096),
  description: z.string().optional().catch(undefined),
})) });
const call = z.object({ callId: z.string(), name: z.string(), arguments: z.string() });
const result = z.object({
  meta: z.object({ path: z.string().optional() }).optional(),
  message: z.object({ source: z.object({ callId: z.string() }), isError: z.boolean().optional() }),
});
const text = z.object({ type: z.literal('text'), text: z.string() });

export type StoredImage = z.infer<typeof image>;
export type StoredFile = z.infer<typeof verbatim>;
export type Attachment = { type: 'file'; attachment: StoredFile } | { type: 'image'; attachment: StoredImage };
export interface Event { type: string; time: number; seq?: number; data: unknown }
export interface RecordedOutput {
  path: string;
  time: number;
  sessionId: string;
  source: 'presented' | 'written';
  title?: string;
}
export interface Evidence {
  inputs: (Input & { stored: Attachment })[];
  outputs: RecordedOutput[];
  references: { sessionId: string; path: string; time: number }[];
}

function outputPath(name: string, args: string): string | undefined {
  if (!['write', 'edit', 'str_replace_editor'].includes(name)) return;
  let parsed: unknown;
  try { parsed = JSON.parse(args); } catch { return; }
  if (name === 'str_replace_editor') {
    const value = z.object({ command: z.enum(['create', 'str_replace', 'insert']), path: z.string() }).safeParse(parsed);
    return value.data?.path;
  }
  return z.object({ file_path: z.string() }).safeParse(parsed).data?.file_path;
}

export function evidenceFor(sessionId: string, events: readonly Event[], changed?: (seq: number) => readonly { path: string }[]): Evidence {
  const inputs: Evidence['inputs'] = [];
  const outputs: RecordedOutput[] = [];
  const references: Evidence['references'] = [];
  const pending = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'user/message') {
      const data = message.safeParse(event.data).data;
      if (!data || !['user', 'retry'].includes(data.source.kind)) continue;
      for (const value of data.content) {
        const stored = block.safeParse(value).data;
        if (!stored) {
          const prompt = text.safeParse(value).data?.text;
          if (prompt) {
            for (const candidate of prompt.matchAll(/(?:^|\s)@(?:"([^"\n]+)"|([^\s"]+))/gu)) {
              const path = candidate[1] ?? candidate[2]?.replace(/[,.!?;，。！？；]+$/u, '');
              if (path) references.push({ sessionId, path, time: event.time });
            }
          }
          continue;
        }
        const { attachmentId: id, bytes, name } = stored.attachment;
        const storedName = name ? basename(name.replaceAll('\\', '/')) : '';
        const fallback = stored.type === 'image'
          ? (id.split(':').at(-1)?.slice(0, 8) || 'image') + '.' + stored.attachment.mediaType.slice('image/'.length)
          : 'attachment';
        inputs.push({ id, bytes, name: storedName || fallback, sessionId, type: stored.type, time: event.time, stored });
      }
    } else if (event.type === 'deliverables/presented') {
      for (const { path, description } of delivered.safeParse(event.data).data?.files ?? []) {
        const title = description?.replace(/\s+/gu, ' ').trim();
        outputs.push({ path, time: event.time, sessionId, source: 'presented', ...(title ? { title } : {}) });
      }
    } else if (event.type === 'tool/call') {
      const data = call.safeParse(event.data).data;
      const path = data && outputPath(data.name, data.arguments);
      if (data && path) pending.set(data.callId, path);
    } else if (event.type === 'tool/result') {
      const outcome = result.safeParse(event.data).data;
      if (!outcome) continue;
      const id = outcome.message.source.callId;
      const argument = pending.get(id);
      pending.delete(id);
      if (argument && outcome.message.isError !== true)
        outputs.push({ path: outcome.meta?.path ?? argument, time: event.time, sessionId, source: 'written' });
    } else if (event.type === 'workspace/changes' && event.seq !== undefined) {
      for (const { path } of changed?.(event.seq) ?? []) outputs.push({ path, time: event.time, sessionId, source: 'written' });
    }
  }
  return { inputs, outputs, references };
}
