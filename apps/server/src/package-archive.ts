import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";
import { ApiError } from "./errors.js";

export type ZipEntry = { name: string; data: Buffer };
const MAX_TEMPLATE_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 1000;
const inflateRawAsync = promisify(inflateRaw);
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let entry = value;
  for (let bit = 0; bit < 8; bit += 1) entry = entry & 1 ? 0xedb88320 ^ (entry >>> 1) : entry >>> 1;
  return entry >>> 0;
});

function crc32(data: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of data) checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

export async function readPackageZip(buffer: Buffer, validateFile: (name: string, mode: number) => string, limits: { maximumExpandedBytes?: number; maximumFiles?: number } = {}): Promise<ZipEntry[]> {
  if (buffer.byteLength > MAX_TEMPLATE_PACKAGE_BYTES) throw new ApiError(413, "template_package_too_large", "Template package exceeds 50 MB");
  let eocd = -1;
  for (let offset = Math.max(0, buffer.length - 65_557); offset <= buffer.length - 22; offset += 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) eocd = offset;
  }
  if (eocd < 0) throw new ApiError(400, "invalid_template_package", "The template package is not a valid ZIP archive");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > (limits.maximumFiles ?? MAX_FILES)) throw new ApiError(413, "template_package_too_large", "Template package contains more than 1,000 files");
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let expanded = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new ApiError(400, "invalid_template_package", "Invalid ZIP directory");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const directoryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (directoryEnd > buffer.length) throw new ApiError(400, "invalid_template_package", "Invalid ZIP directory");
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor = directoryEnd;
    if (name.endsWith("/")) continue;
    const safeName = validateFile(name, externalAttributes >>> 16);
    if (names.has(safeName)) throw new ApiError(400, "invalid_template_package", `Duplicate package path: ${safeName}`);
    names.add(safeName);
    if (uncompressedSize > MAX_FILE_BYTES) throw new ApiError(413, "template_package_too_large", `${safeName} exceeds 25 MB`);
    expanded += uncompressedSize;
    if (expanded > (limits.maximumExpandedBytes ?? MAX_EXPANDED_BYTES)) throw new ApiError(413, "template_package_too_large", "Expanded template exceeds 200 MB");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ApiError(400, "invalid_template_package", "Invalid ZIP entry");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) throw new ApiError(400, "invalid_template_package", `Corrupt ZIP entry: ${safeName}`);
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    if (localName !== name) throw new ApiError(400, "invalid_template_package", `Mismatched ZIP entry: ${safeName}`);
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer | null = null;
    try {
      data = method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? await inflateRawAsync(compressed, { maxOutputLength: Math.max(1, uncompressedSize) })
          : null;
    }
    catch { throw new ApiError(400, "invalid_template_package", `Corrupt ZIP entry: ${safeName}`); }
    if (!data || data.byteLength !== uncompressedSize) throw new ApiError(400, "invalid_template_package", `Unsupported or corrupt ZIP entry: ${safeName}`);
    if (crc32(data) !== expectedCrc) throw new ApiError(400, "invalid_template_package", `Checksum mismatch: ${safeName}`);
    entries.push({ name: safeName, data: Buffer.from(data) });
  }
  return entries;
}

export function createStoredZip(files: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const checksum = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(file.data.byteLength, 18);
    local.writeUInt32LE(file.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(file.data.byteLength, 20);
    central.writeUInt32LE(file.data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.byteLength + name.byteLength + file.data.byteLength;
  }
  const centralSize = centralParts.reduce((size, part) => size + part.byteLength, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}
