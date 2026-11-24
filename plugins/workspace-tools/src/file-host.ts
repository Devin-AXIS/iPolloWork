import { dirname, extname, resolve } from 'node:path';
import { z } from 'zod';
import { decodeText, Failure, projectFile, readFileBounded, readRequest, rootFor,
  versionOf, writeVersion, type FileHost } from '../../_shared/workspace-document-files.ts';
import { endpoint, feature, limit, type CellChange, type Sheet } from './api.ts';
import { addressOf, cellPosition, maxCellChanges, type FileDocument } from './file-contract.ts';
import { parseDelimitedSpreadsheet, serializeDelimitedSpreadsheet } from './delimited.ts';
import { readWorkbook, updateWorkbook, type WorkbookNumberFormatter } from './workbook.ts';

export const name = endpoint;
export const inject = ['connection', 'workspaceFiles', 'sandboxPolicy', 'sessions', 'fs'];

const documentQuery = z.object({ session: z.string().min(1).max(160), path: z.string().min(1).max(4096) });
const imagePath = z.string().min(1).max(4096);
const imageTypes = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.gif', 'image/gif'],
  ['.webp', 'image/webp'], ['.bmp', 'image/bmp'], ['.avif', 'image/avif'],
]);
const version = z.string().regex(/^[0-9a-f]{64}$/);
const cellChanges = z.array(z.object({
  sheet: z.string().min(1).max(100), address: z.string().max(10),
  kind: z.enum(['text', 'number', 'boolean', 'empty']),
  value: z.string().max(32_767).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)),
})).max(maxCellChanges);
const edit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown'), version, text: z.string().max(2_000_000) }),
  z.object({ kind: z.literal('workbook'), version, changes: cellChanges }),
]);

interface ExcelCodecs {
  format: WorkbookNumberFormatter;
  readLegacy(bytes: Uint8Array, path: string): Sheet[];
  convert(bytes: Uint8Array, path: string): Uint8Array;
}
const isLegacy = (path: string) => /\.(xls|ods)$/i.test(path);
const utf8Bom = '\ufeff';

function readDelimited(bytes: Uint8Array, delimiter: string) {
  if (bytes.length > 2_000_000) throw new Failure('too-large', 413);
  const decoded = decodeText(bytes);
  const bom = decoded.startsWith(utf8Bom) ? utf8Bom : '';
  const source = decoded.slice(bom.length);
  const rows = parseDelimitedSpreadsheet(source, delimiter);
  const columns = rows.reduce((width, row) => Math.max(width, row.length), 1);
  if (rows.length * columns > 100_000) throw new Failure('too-large', 413);
  return { rows, columns, bom, lineEnding: source.match(/\r\n|[\r\n]/)?.[0] ?? '\n' };
}

function changeDelimited(bytes: Uint8Array, delimiter: string, changes: CellChange[]) {
  const { rows, columns, lineEnding, bom } = readDelimited(bytes, delimiter);
  const positions = changes.map(change => {
    const point = cellPosition(change.address);
    if (!point || change.sheet !== 'Sheet1') throw new Failure('invalid-cell');
    return { ...point, value: change.kind === 'empty' ? '' : change.value };
  });
  const width = Math.max(columns, ...positions.map(point => point.column));
  const height = Math.max(rows.length, ...positions.map(point => point.row));
  if (width * height > 100_000) throw new Failure('too-large', 413);
  const next = Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => rows[row]?.[col] ?? ''));
  for (const point of positions) next[point.row - 1]![point.column - 1] = point.value;
  return Buffer.from(bom + serializeDelimitedSpreadsheet(next, delimiter, lineEnding));
}

function readMarkdown(bytes: Uint8Array) {
  const source = decodeText(bytes);
  const bom = source.startsWith(utf8Bom) ? utf8Bom : '';
  const text = source.slice(bom.length).replace(/\r\n?/g, '\n');
  if (text.length > 2_000_000) throw new Failure('too-large', 413);
  return { text, bom, lineEnding: source.match(/\r\n|[\r\n]/)?.[0] ?? '\n' };
}

function workbookView(bytes: Uint8Array, path: string, codecs?: ExcelCodecs) {
  if (/\.xlsx$/i.test(path)) return readWorkbook(bytes, codecs?.format);
  if (codecs && isLegacy(path)) return codecs.readLegacy(bytes, path);
  const { rows, columns } = readDelimited(bytes, /\.tsv$/i.test(path) ? '\t' : ',');
  return [{ name: 'Sheet1', rows: rows.length, columns, cells: rows.flatMap((row, i) =>
    row.flatMap((value, j) => value ? [{ address: addressOf(i + 1, j + 1), value, kind: 'text' as const }] : [])) }];
}

function fileView(bytes: Uint8Array, path: string, writable: boolean, codecs?: ExcelCodecs): FileDocument {
  const current = versionOf(bytes);
  if (feature === 'markdown-editor') return { kind: 'markdown', version: current, text: readMarkdown(bytes).text, writable };
  return { kind: 'workbook', version: current, sheets: workbookView(bytes, path, codecs), writable,
    delimited: /\.(csv|tsv)$/i.test(path), ...(isLegacy(path) && { legacy: true }) };
}

export function apply(ctx: FileHost) { return applyFileRoutes(ctx); }

export function applyFileRoutes(ctx: FileHost, codecs?: ExcelCodecs) {
  async function handle(request: Request) {
    const respond = (status: number, value: unknown) => Response.json(value, { status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    try {
      const url = new URL(request.url);
      const action = url.searchParams.get('action');
      const markdown = feature === 'markdown-editor';
      const readingImage = markdown && action === 'image' && request.method === 'GET';
      const converting = codecs !== undefined && action === 'convert' && request.method === 'POST';
      if (action !== 'document' && !readingImage && !converting) throw new Failure('missing', 404);
      const input = documentQuery.parse(Object.fromEntries(url.searchParams));
      const supported = markdown ? /\.(md|markdown)$/i.test(input.path)
        : /\.(xlsx|csv|tsv)$/i.test(input.path) || (codecs !== undefined && isLegacy(input.path));
      if (!supported || (converting && !isLegacy(input.path))) throw new Failure('unsupported-file', 415);
      const writing = request.method === 'POST';
      const root = await rootFor(ctx, input.session, writing && !converting, request.signal);
      const path = await projectFile(root, input.path);
      if (readingImage) {
        const image = imagePath.parse(url.searchParams.get('image'));
        const mime = imageTypes.get(extname(image).toLowerCase());
        if (!mime) throw new Failure('unsupported-file', 415);
        const bytes = await readFileBounded(await projectFile(root, resolve(dirname(path), image)));
        return new Response(new Uint8Array(bytes), { headers: {
          'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        } });
      }
      const before = await readFileBounded(path);
      if (!writing) {
        const writable = await rootFor(ctx, input.session, true, request.signal).then(() => true, error => {
          if (error instanceof Failure && error.code === 'read-only') return false;
          throw error;
        });
        return respond(200, fileView(before, path, writable, codecs));
      }
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
        throw new Failure('invalid-request', 415);
      const raw = await readRequest(request, 8 * 1024 * 1024);
      let value: unknown;
      try { value = JSON.parse(raw.toString('utf8')); }
      catch { throw new Failure('invalid-request'); }
      const change = edit.parse(value);
      if (markdown !== (change.kind === 'markdown')) throw new Failure('unsupported-file', 415);
      if (versionOf(before) !== change.version) throw new Failure('conflict', 409);
      if (isLegacy(path)) {
        if (!converting || !codecs || change.kind !== 'workbook') throw new Failure('unsupported-file', 415);
        const converted = codecs.convert(before, path);
        const output = change.changes.length ? updateWorkbook(converted, change.changes) : converted;
        if (output.length > limit) throw new Failure('too-large', 413);
        return new Response(new Uint8Array(output), { headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        } });
      }
      let updated: Uint8Array;
      if (change.kind === 'markdown') {
        const { bom, lineEnding } = readMarkdown(before);
        updated = Buffer.from(bom + change.text.replace(/\r\n?|\n/g, lineEnding));
      } else {
        if (!change.changes.length) throw new Failure('invalid-request');
        updated = /\.xlsx$/i.test(path) ? updateWorkbook(before, change.changes)
          : changeDelimited(before, /\.tsv$/i.test(path) ? '\t' : ',', change.changes);
      }
      const view = fileView(updated, path, true, codecs);
      await writeVersion(root, path, change.version, updated, request.signal);
      return respond(200, view);
    } catch (error) {
      if (error instanceof Failure) return respond(error.status, { error: error.code });
      if (error instanceof z.ZodError) return respond(400, { error: 'invalid-request' });
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return respond(404, { error: 'missing' });
      if (code && ['EACCES', 'EPERM', 'EBUSY'].includes(code)) return respond(409, { error: 'file-busy' });
      return respond(500, { error: 'failed' });
    }
  }
  ctx.connection.fetch.register({ path: '/api/' + endpoint, methods: ['GET'], requestBody: 'buffered', fetch: handle });
  ctx.connection.fetch.register({ path: '/api/' + endpoint + '/write', methods: ['POST'], requestBody: 'streaming', fetch: handle });
}
