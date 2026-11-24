import { posix } from 'node:path';
import type { Element } from '@xmldom/xmldom';
import type { Reference } from './api.ts';
import { decodeText, Failure } from '../../_shared/workspace-document-files.ts';
import { descendants, parts, parseXml } from './workbook.ts';

const maxText = 250_000;
const maxPages = 120;
const raster = /\.(?:png|jpe?g|gif|webp|bmp|tiff?)$/i;

export type Extracted = {
  chunks: { page: number; text: string }[];
  assets: { name: string; data: Uint8Array; page?: number }[];
  style?: { fonts: string[]; colors: string[] };
  warning?: string;
};

const elementText = (node: Element) => descendants(node, 't').map(tag => tag.textContent ?? '').join('');

function office(name: string, bytes: Uint8Array): Extracted {
  const archive = parts(bytes);
  const word = name.endsWith('.docx');
  const directory = word ? 'word' : 'ppt';
  const keys = Object.keys(archive);
  const pagePaths = word ? ['word/document.xml'] : (() => {
    const packageXml = parseXml(archive['ppt/presentation.xml']);
    const relationships = new Map(descendants(parseXml(archive['ppt/_rels/presentation.xml.rels']), 'Relationship')
      .filter(node => node.getAttribute('TargetMode') !== 'External')
      .map(node => [node.getAttribute('Id'), node.getAttribute('Target')]));
    return descendants(packageXml, 'sldId').flatMap(node => {
      const id = Array.from(node.attributes).find(attr => attr.localName === 'id' && attr.namespaceURI)?.value;
      const location = id ? relationships.get(id) : null;
      return location ? [location.startsWith('/') ? location.slice(1) : posix.join('ppt', location)] : [];
    });
  })();
  if (!pagePaths.length) throw new Failure('unsupported-file', 415);
  if (pagePaths.length > maxPages) throw new Failure('too-large', 413);
  const colors = new Set<string>();
  const fonts = new Set<string>();
  const pagesByAsset = new Map<string, number>();
  const chunks = pagePaths.map((path, index) => {
    const xml = parseXml(archive[path]);
    for (const node of descendants(xml, 'srgbClr')) {
      const color = node.getAttribute('val');
      if (color && /^[0-9A-F]{6}$/i.test(color)) colors.add('#' + color.toUpperCase());
    }
    for (const node of [...descendants(xml, 'latin'), ...descendants(xml, 'rFonts')]) {
      for (const attr of Array.from(node.attributes)) {
        if (attr.localName && ['typeface', 'ascii', 'eastAsia', 'hAnsi'].includes(attr.localName) && attr.value) fonts.add(attr.value);
      }
    }
    const rel = archive[posix.join(posix.dirname(path), '_rels', posix.basename(path) + '.rels')];
    if (rel) {
      for (const node of descendants(parseXml(rel), 'Relationship')) {
        const url = node.getAttribute('Target');
        if (url && node.getAttribute('Type')?.endsWith('/image') && node.getAttribute('TargetMode') !== 'External') {
          const assetPath = url.startsWith('/') ? url.slice(1) : posix.join(posix.dirname(path), url);
          if (!pagesByAsset.has(assetPath)) pagesByAsset.set(assetPath, index + 1);
        }
      }
    }
    const paragraphs = descendants(xml, 'p').filter(node => {
      for (let parent = node.parentNode; parent?.nodeType === 1; parent = parent.parentNode) {
        if ((parent as Element).localName === 'tc') return false;
      }
      return true;
    });
    const tables = descendants(xml, 'tbl').map(table =>
      descendants(table, 'tr').map(row => descendants(row, 'tc').map(elementText).join('\t')).join('\n'));
    return { page: index + 1, text: [...paragraphs.map(elementText), ...tables].filter(Boolean).join('\n') };
  });
  const assets = keys.filter(path => path.startsWith(directory + '/media/') && raster.test(path)).map(path => {
    const page = pagesByAsset.get(path);
    return { name: posix.basename(path), data: archive[path]!, ...(page === undefined ? {} : { page }) };
  });
  if (assets.length > 96 || assets.reduce((total, asset) => total + asset.data.byteLength, 0) > 32 * 1024 * 1024)
    throw new Failure('too-large', 413);
  return { chunks, assets, style: { fonts: [...fonts], colors: [...colors] },
    warning: 'Only declared fonts, colors and raster assets were extracted. Exact layout is unavailable.' };
}

export async function extract(name: string, bytes: Uint8Array): Promise<Extracted> {
  const lower = name.toLowerCase();
  let result: Extracted;
  if (lower.endsWith('.pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      if (pdf.numPages > maxPages) throw new Failure('too-large', 413);
      const { text } = await extractText(pdf, { mergePages: false });
      result = { chunks: text.map((page, index) => ({ page: index + 1, text: page })), assets: [],
        warning: 'PDF text layers only. Scanned pages require OCR.' };
    } finally {
      await pdf.loadingTask.destroy();
    }
  } else if (/\.(?:docx|pptx)$/.test(lower)) {
    result = office(lower, bytes);
  } else {
    result = { chunks: [{ page: 1, text: decodeText(bytes) }], assets: [] };
  }
  if (result.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) > maxText)
    throw new Failure('too-large', 413);
  if (result.chunks.every(chunk => !chunk.text.trim()))
    result.warning = 'No readable text was found.';
  return result;
}

export function referenceSummary(name: string, result: Extracted): Reference {
  return {
    name, text: result.chunks.map(chunk => chunk.text).join('\n\n').slice(0, 12_000),
    pages: result.chunks.length, assets: result.assets.length,
    ...(result.warning ? { warning: result.warning } : {}),
  };
}
