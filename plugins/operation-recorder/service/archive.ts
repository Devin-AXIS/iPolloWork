import { gzipSync } from 'node:zlib';
/** Deterministic npm tarball with bounded, relative entries. */
export function createArchive(files: Readonly<Record<string, string | Buffer>>): Buffer {
 const chunks: Buffer[] = []; let total = 0;
 const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
 if (entries.length > 512) throw new Error('Archive contains too many files');
 for (const [path, value] of entries) {
   if (!/^[A-Za-z0-9._/-]+$/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe archive resource path');
   const name = `package/${path}`;
   const split = name.lastIndexOf('/');
   const prefix = Buffer.byteLength(name) > 100 ? name.slice(0, split) : '';
   const leaf = prefix ? name.slice(split + 1) : name;
   if (Buffer.byteLength(leaf) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('Archive path too long');
   const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
   total += data.length; if (total > 10 * 1024 * 1024) throw new Error('Archive exceeds 10 MiB');
   const header = Buffer.alloc(512);
   header.write(leaf); if (prefix) header.write(prefix, 345); header.write('0000600\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
   header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
   header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write('0', 156);
   header.write('ustar\0', 257); header.write('00', 263);
   const sum = header.reduce((a, b) => a + b, 0);
   header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
   chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
 }
 chunks.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(chunks), { level: 9 });
}
