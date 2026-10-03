import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { config } from './config.js'
import type { AccountBinding, BrandProfile, Campaign, DiscoveredComment, GeneratedCard, KnowledgeItem } from './types.js'

export interface GeneratedNote {
  title: string
  body: string
  topics: string[]
  cards: GeneratedCard[]
  sourceKnowledgeIds: string[]
  managedComments: Array<{ accountId: number; body: string }>
}

export interface ContentGenerator {
  generateNote(input: {
    brand: BrandProfile
    knowledge: KnowledgeItem[]
    campaign: Campaign
    author: AccountBinding
    commenters: AccountBinding[]
  }): Promise<GeneratedNote>
  generateReplies(input: {
    brand: BrandProfile
    knowledge: KnowledgeItem[]
    account: AccountBinding
    comments: DiscoveredComment[]
  }): Promise<Map<string, string>>
}

function runCodex(schema: string, prompt: string): Promise<unknown> {
  if (!existsSync(config.codex.executable)) throw new Error(`Codex executable was not found at ${config.codex.executable}`)
  const directory = mkdtempSync(resolve(tmpdir(), 'xiaohongshu-ops-'))
  const outputPath = resolve(directory, 'result.json')
  return new Promise((resolvePromise, reject) => {
    const child = spawn(config.codex.executable, [
      'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'read-only',
      '-m', config.codex.model, '-c', `model_reasoning_effort="${config.codex.reasoningEffort}"`, '-C', config.projectRoot,
      '--output-schema', resolve(config.projectRoot, 'schemas', schema), '-o', outputPath, '-',
    ], { cwd: config.projectRoot, env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('Codex content generation timed out'))
    }, 180_000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-12_000) })
    child.on('error', (error) => { clearTimeout(timer); rmSync(directory, { recursive: true, force: true }); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        if (code !== 0) throw new Error(stderr.trim() || `Codex exited with code ${code ?? 'unknown'}`)
        resolvePromise(JSON.parse(readFileSync(outputPath, 'utf8')) as unknown)
      } catch (error) {
        reject(error)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
    child.stdin.end(prompt)
  })
}

function notePrompt(input: {
  brand: BrandProfile; knowledge: KnowledgeItem[]; campaign: Campaign; author: AccountBinding; commenters: AccountBinding[]
}): string {
  return `Create one Chinese Xiaohongshu image-note package for a brand-owned account. Return only JSON matching the schema.

Hard rules:
- When knowledge items are supplied, every factual claim must be grounded in them and every used item id must appear in sourceKnowledgeIds.
- When no knowledge item is supplied, sourceKnowledgeIds must be empty. Write only general, process-oriented content based on the task theme and the account's stated position; do not make product-specific factual claims.
- Never invent metrics, customers, prices, product capabilities, awards, endorsements, people, policies, or results.
- Do not include any banned phrase or banned topic.
- The author account and commenter accounts are disclosed brand-operated accounts. Never write as an unrelated customer or pretend independent experience.
- Keep the note useful and specific. No engagement bait, fake testimonials, contact details, QR codes, or unsupported promises.
- Write exactly three content cards. The cover is rendered separately from title.
- Produce at most one useful top-level comment per supplied commenter. Each comment must fit that account's real position and must not merely praise or repeat the note.

Brand:
${JSON.stringify(input.brand, null, 2)}

Knowledge items:
${JSON.stringify(input.knowledge, null, 2)}

Campaign:
${JSON.stringify({ theme: input.campaign.theme, noteTones: input.campaign.noteTones, commentTones: input.campaign.commentTones }, null, 2)}

Author account:
${JSON.stringify(input.author, null, 2)}

Managed commenter accounts:
${JSON.stringify(input.commenters, null, 2)}
`
}

function parseNote(value: unknown): GeneratedNote {
  if (!value || typeof value !== 'object') throw new Error('Codex 返回的内容不是对象')
  const item = value as Record<string, unknown>
  if (typeof item.title !== 'string' || typeof item.body !== 'string') throw new Error('Codex 返回的标题或正文无效')
  if (!Array.isArray(item.topics) || !Array.isArray(item.cards) || !Array.isArray(item.sourceKnowledgeIds) || !Array.isArray(item.managedComments)) {
    throw new Error('Codex 返回的内容结构不完整')
  }
  return {
    title: item.title.trim(), body: item.body.trim(),
    topics: item.topics.flatMap((topic) => typeof topic === 'string' ? [topic.trim()] : []).filter(Boolean),
    cards: item.cards.flatMap((card) => card && typeof card === 'object' && typeof (card as Record<string, unknown>).heading === 'string' && typeof (card as Record<string, unknown>).body === 'string'
      ? [{ heading: String((card as Record<string, unknown>).heading).trim(), body: String((card as Record<string, unknown>).body).trim() }] : []),
    sourceKnowledgeIds: item.sourceKnowledgeIds.flatMap((id) => typeof id === 'string' ? [id] : []),
    managedComments: item.managedComments.flatMap((comment) => {
      if (!comment || typeof comment !== 'object') return []
      const value = comment as Record<string, unknown>
      return Number.isInteger(value.accountId) && typeof value.body === 'string' ? [{ accountId: Number(value.accountId), body: value.body.trim() }] : []
    }),
  }
}

export const codexContentGenerator: ContentGenerator = {
  async generateNote(input) {
    return parseNote(await runCodex('note-content.schema.json', notePrompt(input)))
  },
  async generateReplies(input) {
    if (!input.comments.length) return new Map()
    const value = await runCodex('replies.schema.json', `Write concise replies from the brand-owned account to routine Xiaohongshu comments.
Return only JSON matching the schema. Do not answer complaints, negative feedback, privacy, price promises, legal, medical, or financial questions; omit those ids. Ground factual claims in the supplied knowledge and do not invent facts.

Brand: ${JSON.stringify(input.brand)}
Knowledge: ${JSON.stringify(input.knowledge)}
Account: ${JSON.stringify(input.account)}
Comments: ${JSON.stringify(input.comments)}
`)
    const replies = value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).replies)
      ? (value as { replies: unknown[] }).replies : []
    return new Map(replies.flatMap((reply) => {
      if (!reply || typeof reply !== 'object') return []
      const item = reply as Record<string, unknown>
      return typeof item.remoteCommentId === 'string' && typeof item.body === 'string'
        ? [[item.remoteCommentId, item.body.trim()] as [string, string]] : []
    }))
  },
}
