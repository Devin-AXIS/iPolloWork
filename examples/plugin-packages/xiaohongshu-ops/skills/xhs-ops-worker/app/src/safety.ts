import { createHash } from 'node:crypto'

export type RiskLabel = 'complaint' | 'negative' | 'privacy' | 'price_promise' | 'legal' | 'medical' | 'finance'

const riskPatterns: Array<{ label: RiskLabel; patterns: RegExp[] }> = [
  { label: 'complaint', patterns: [/投诉/i, /举报/i, /维权/i, /退款/i, /退货/i, /客服.*不/i] },
  { label: 'negative', patterns: [/垃圾/i, /骗子/i, /骗人/i, /差评/i, /失望/i, /难用/i, /有问题/i] },
  { label: 'privacy', patterns: [/手机号/i, /身份证/i, /住址/i, /隐私/i, /微信号/i, /联系方式/i] },
  { label: 'price_promise', patterns: [/最低价/i, /保证.*价格/i, /绝对便宜/i, /赔偿/i, /承诺/i] },
  { label: 'legal', patterns: [/律师/i, /起诉/i, /法院/i, /违法/i, /合同/i, /法律责任/i] },
  { label: 'medical', patterns: [/治疗/i, /治愈/i, /诊断/i, /药物/i, /医生/i, /疾病/i] },
  { label: 'finance', patterns: [/投资/i, /收益/i, /股票/i, /基金/i, /贷款/i, /理财/i, /回报率/i] },
]

export function classifyCommentRisk(text: string): RiskLabel[] {
  return riskPatterns.flatMap(({ label, patterns }) => patterns.some((pattern) => pattern.test(text)) ? [label] : [])
}

export function findBannedPhrases(text: string, bannedPhrases: string[]): string[] {
  const normalized = text.toLocaleLowerCase('zh-CN')
  return bannedPhrases.filter((phrase) => phrase.trim() && normalized.includes(phrase.trim().toLocaleLowerCase('zh-CN')))
}

export function normalizeTopics(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/^#+/, '')).filter(Boolean))].slice(0, 20)
}

export function contentHash(input: { title: string; body: string; topics: string[]; mediaAssetIds?: string[] }): string {
  return createHash('sha256').update(JSON.stringify({
    title: input.title.trim(),
    body: input.body.trim(),
    topics: normalizeTopics(input.topics),
    mediaAssetIds: input.mediaAssetIds ?? [],
  })).digest('hex')
}

export function assertGeneratedContent(input: {
  title: string
  body: string
  topics: string[]
  sourceKnowledgeIds: string[]
  availableKnowledgeIds: string[]
  bannedPhrases: string[]
}): void {
  if (!input.title.trim() || input.title.length > 120) throw new Error('生成标题为空或过长')
  if (!input.body.trim() || input.body.length > 10_000) throw new Error('生成正文为空或过长')
  const available = new Set(input.availableKnowledgeIds)
  if (available.size && !input.sourceKnowledgeIds.length) throw new Error('生成内容没有引用可用的参考资料')
  if (!available.size && input.sourceKnowledgeIds.length) throw new Error('生成内容引用了不存在的参考资料')
  if (input.sourceKnowledgeIds.some((id) => !available.has(id))) throw new Error('生成内容引用了不存在的品牌资料')
  const banned = findBannedPhrases(`${input.title}\n${input.body}\n${input.topics.join('\n')}`, input.bannedPhrases)
  if (banned.length) throw new Error(`生成内容命中禁用表述：${banned.join('、')}`)
}
