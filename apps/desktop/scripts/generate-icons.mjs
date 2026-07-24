import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require(resolve(dirname(fileURLToPath(import.meta.url)), "../../../node_modules/.pnpm/node_modules/sharp"));

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const iconRoot = resolve(desktopRoot, "resources", "icons");
const sourceSvg = readFileSync(resolve(iconRoot, "logo-source.svg"), "utf8");

const WINDOWS_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];
const WINDOWS_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_ENTRIES = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
];

const variants = {
  mac: {
    background: "#FFFFFF",
    foreground: "#050505",
    insetRatio: 0.225,
    radiusRatio: 0.2237,
  },
  windows: {
    background: "#FFFFFF",
    foreground: "#050505",
    insetRatio: 0.115,
    radiusRatio: 0.176,
  },
};

function encodeWindowsIcon(entries) {
  const headerSize = 6;
  const entrySize = 16;
  const directory = Buffer.alloc(headerSize + entrySize * entries.length);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);

  let imageOffset = directory.length;
  for (const [index, entry] of entries.entries()) {
    const offset = headerSize + index * entrySize;
    directory.writeUInt8(entry.size === 256 ? 0 : entry.size, offset);
    directory.writeUInt8(entry.size === 256 ? 0 : entry.size, offset + 1);
    directory.writeUInt8(0, offset + 2);
    directory.writeUInt8(0, offset + 3);
    directory.writeUInt16LE(1, offset + 4);
    directory.writeUInt16LE(32, offset + 6);
    directory.writeUInt32LE(entry.png.length, offset + 8);
    directory.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += entry.png.length;
  }

  return Buffer.concat([directory, ...entries.map((entry) => entry.png)]);
}

function encodeIcns(entries) {
  const chunks = entries.map(([type, png]) => {
    const chunk = Buffer.alloc(8 + png.length);
    chunk.write(type, 0, 4, "ascii");
    chunk.writeUInt32BE(chunk.length, 4);
    png.copy(chunk, 8);
    return chunk;
  });
  const length = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(length, 4);
  return Buffer.concat([header, ...chunks], length);
}

function markSvg(color) {
  return Buffer.from(sourceSvg
    .replace(/<rect x="-3" width="106" height="106" fill="white"\/>\s*/m, "")
    .replaceAll('fill="black"', `fill="${color}"`));
}

function roundedMask(size, radius) {
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
}

async function renderIconPng(size, variant) {
  const inset = Math.round(size * variant.insetRatio);
  const markSize = size - inset * 2;
  const base = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: variant.background,
    },
  })
    .composite([{ input: roundedMask(size, Math.round(size * variant.radiusRatio)), blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(base)
    .composite([{
      input: await sharp(markSvg(variant.foreground)).resize(markSize, markSize, { fit: "contain" }).png().toBuffer(),
      left: inset,
      top: inset,
    }])
    .png()
    .toBuffer();
}

async function writePng(filePath, size, variant) {
  writeFileSync(filePath, await renderIconPng(size, variant));
}

async function main() {
  const macDir = resolve(iconRoot, "mac");
  const windowsDir = resolve(iconRoot, "windows");
  mkdirSync(macDir, { recursive: true });
  mkdirSync(windowsDir, { recursive: true });

  const macPngs = await Promise.all(ICNS_ENTRIES.map(async ([type, size]) => [type, await renderIconPng(size, variants.mac)]));
  writeFileSync(resolve(macDir, "icon.icns"), encodeIcns(macPngs));
  await writePng(resolve(macDir, "icon.png"), 1024, variants.mac);

  for (const size of WINDOWS_ICON_SIZES) {
    await writePng(resolve(windowsDir, `icon-${size}.png`), size, variants.windows);
  }
  const windowsIcoEntries = await Promise.all(WINDOWS_ICO_SIZES.map(async (size) => ({ size, png: await renderIconPng(size, variants.windows) })));
  writeFileSync(resolve(windowsDir, "icon.ico"), encodeWindowsIcon(windowsIcoEntries));

  await writePng(resolve(iconRoot, "icon.png"), 1024, variants.windows);
  writeFileSync(resolve(iconRoot, "icon.ico"), encodeWindowsIcon(windowsIcoEntries));
  if (!existsSync(resolve(iconRoot, "icon.icns"))) {
    writeFileSync(resolve(iconRoot, "icon.icns"), encodeIcns(macPngs));
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    mac: "resources/icons/mac/icon.icns",
    windows: "resources/icons/windows/icon.ico",
  }, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
