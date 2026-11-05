import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { config } from './config.js'
import type { BrandProfile, ContentItem, MediaAsset } from './types.js'

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function hex(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function lines(text: string, width: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  const result: string[] = []
  let current = ''
  for (const char of clean) {
    if ((current.length + 1) > width) {
      result.push(current)
      current = char
      if (result.length === maxLines) break
    } else current += char
  }
  if (result.length < maxLines && current) result.push(current)
  if (result.join('').length < clean.length && result.length) result[result.length - 1] = `${result[result.length - 1]?.slice(0, -1) ?? ''}…`
  return result
}

function textNodes(values: string[], x: number, y: number, size: number, lineHeight: number, weight = 650): string {
  return values.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" font-size="${size}" font-weight="${weight}">${xml(line)}</text>`).join('')
}

function cardSvg(input: { brand: BrandProfile; heading: string; body: string; index: number; total: number; cover?: boolean }): string {
  const background = hex(input.brand.visual.background, '#f2f4ef')
  const foreground = hex(input.brand.visual.foreground, '#171a18')
  const accent = hex(input.brand.visual.accent, '#1769e0')
  const heading = lines(input.heading, input.cover ? 12 : 15, input.cover ? 4 : 3)
  const body = lines(input.body, 22, input.cover ? 5 : 10)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
    <rect width="1080" height="1440" fill="${background}"/>
    <rect x="72" y="72" width="936" height="1296" rx="32" fill="none" stroke="${foreground}" stroke-opacity="0.15" stroke-width="2"/>
    <rect x="96" y="104" width="64" height="12" rx="6" fill="${accent}"/>
    <g fill="${foreground}" font-family="-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif">
      <text x="96" y="172" font-size="28" font-weight="700" opacity="0.62">${xml(input.brand.name)}</text>
      ${textNodes(heading, 96, input.cover ? 390 : 330, input.cover ? 86 : 66, input.cover ? 106 : 84, 760)}
      ${textNodes(body, 100, input.cover ? 900 : 720, input.cover ? 36 : 38, input.cover ? 56 : 60, 480)}
      <text x="96" y="1320" font-size="25" font-weight="650" opacity="0.5">${String(input.index).padStart(2, '0')} / ${String(input.total).padStart(2, '0')}</text>
    </g>
  </svg>`
}

export async function renderCardSet(content: Pick<ContentItem, 'id' | 'title' | 'body' | 'cardData'>, brand: BrandProfile): Promise<Array<Omit<MediaAsset, 'id' | 'createdAt'>>> {
  mkdirSync(resolve(config.assetDir, 'generated'), { recursive: true, mode: 0o700 })
  const cards = [
    { heading: content.title, body: content.body.slice(0, 180), cover: true },
    ...content.cardData.map((card) => ({ ...card, cover: false })),
  ]
  const results: Array<Omit<MediaAsset, 'id' | 'createdAt'>> = []
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    if (!card) continue
    const filename = `${content.id}-${index + 1}.png`
    const relativePath = `generated/${filename}`
    const absolutePath = resolve(config.assetDir, relativePath)
    await sharp(Buffer.from(cardSvg({ brand, heading: card.heading, body: card.body, index: index + 1, total: cards.length, cover: card.cover })))
      .png({ compressionLevel: 9 }).toFile(absolutePath)
    const bytes = readFileSync(absolutePath)
    results.push({
      kind: 'generated', filename, mimeType: 'image/png', relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'), width: 1080, height: 1440,
    })
  }
  return results
}
