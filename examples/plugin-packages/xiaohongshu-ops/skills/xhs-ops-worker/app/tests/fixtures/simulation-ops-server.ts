import { serve } from '@hono/node-server'
import { config } from '../../src/config.js'
import type { ContentGenerator } from '../../src/content-generator.js'
import { OpsDatabase } from '../../src/db.js'
import { createApp } from '../../src/server.js'
import { OpsService } from '../../src/service.js'

const generator: ContentGenerator = {
  async generateNote(input) {
    return {
      title: '把内容运营流程放回自己手里',
      body: '这是一条端到端模拟笔记。根据品牌资料，本地运营台支持整理内容计划，并把浏览器任务绑定到指定账号。',
      topics: ['内容运营', '本地工具', '工作流'],
      cards: [
        { heading: '统一资料', body: '事实、规则和素材放在同一个本地资料库。' },
        { heading: '锁定账号', body: '每个任务只允许由预登记账号执行。' },
        { heading: '保留证据', body: '结果地址、截图和执行时间都会记录。' },
      ],
      sourceKnowledgeIds: input.knowledge.map((item) => item.id),
      managedComments: input.commenters.map((account) => ({ accountId: account.id, body: '从编辑视角补充：先把品牌事实和禁用表述整理清楚，再安排内容会更稳。' })),
    }
  },
  async generateReplies(input) {
    return new Map(input.comments.map((comment) => [comment.remoteCommentId, '可以先从一个主题和两个测试账号开始，确认流程后再逐步增加。']))
  },
}

const db = new OpsDatabase(config.databasePath)
const service = new OpsService(db, generator)
const app = createApp(service)
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port })

const close = () => server.close(() => { db.close(); process.exit(0) })
process.on('SIGINT', close)
process.on('SIGTERM', close)
process.stdout.write(`Simulation ops: ${config.origin}\n`)
