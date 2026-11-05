#!/usr/bin/env node
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from './config.js'

interface LeaseFile { jobId: string; leaseToken: string; accountId: number }

function parse(argv: string[]): { command: string[]; flags: Map<string, string> } {
  const command: string[] = []
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item) continue
    if (!item.startsWith('--')) { command.push(item); continue }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) flags.set(item.slice(2), 'true')
    else { flags.set(item.slice(2), value); index += 1 }
  }
  return { command, flags }
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)
  if (!value) throw new Error(`缺少 --${name}`)
  return value
}

function leasePath(jobId: string): string {
  return resolve(config.leaseDir, `${jobId}.json`)
}

function readLease(jobId: string): LeaseFile {
  const path = leasePath(jobId)
  if (!existsSync(path)) throw new Error('找不到任务租约，请先执行 worker claim')
  return JSON.parse(readFileSync(path, 'utf8')) as LeaseFile
}

async function api(path: string, method = 'POST', body: unknown = {}): Promise<unknown> {
  const response = await fetch(`${config.origin}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  })
  const value = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `请求失败 (${response.status})`)
  return value
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function main(): Promise<void> {
  const { command, flags } = parse(process.argv.slice(2))
  const action = command.join(' ')
  if (!action || flags.has('help')) {
    process.stdout.write(`xhs-ops commands:
  dispatch
  worker claim --job <id> --account <id>
  complete --job <id> --observed-account <handle> [--observed-profile-id <id>] [--result-url <url>] [--screenshot <path>] [--comments-file <json>]
  block --job <id> --code <code> --message <text> [--screenshot <path>]
  fail --job <id> --code <code> --message <text> [--screenshot <path>]
  uncertain --job <id> --message <text> [--screenshot <path>]
  reconcile --job <id> --resolution <found|not_found|uncertain> [--observed-account <handle>] [--result-url <url>]
`)
    return
  }
  if (action === 'dispatch') {
    output(await api('/api/executor/dispatch'))
    return
  }
  if (action === 'worker claim') {
    const jobId = required(flags, 'job')
    const accountId = Number(required(flags, 'account'))
    if (!Number.isInteger(accountId) || accountId < 1) throw new Error('--account 必须是正整数')
    const result = await api(`/api/executor/jobs/${encodeURIComponent(jobId)}/claim`, 'POST', { accountId }) as { job: unknown; leaseToken: string }
    writeFileSync(leasePath(jobId), `${JSON.stringify({ jobId, leaseToken: result.leaseToken, accountId })}\n`, { mode: 0o600 })
    output({ job: result.job, leaseStored: leasePath(jobId) })
    return
  }
  if (['complete', 'block', 'fail', 'uncertain'].includes(action)) {
    const jobId = required(flags, 'job')
    const lease = readLease(jobId)
    const screenshotPath = flags.get('screenshot') ?? null
    if (action === 'complete') {
      const commentsFile = flags.get('comments-file')
      const analyticsFile = flags.get('analytics-file')
      if (analyticsFile && statSync(resolve(analyticsFile)).size > 500_000) throw new Error('同步数据文件超过 500 KB')
      const discoveredComments = commentsFile ? JSON.parse(readFileSync(resolve(commentsFile), 'utf8')) as unknown : []
      const result = await api(`/api/executor/jobs/${encodeURIComponent(jobId)}/complete`, 'POST', {
        leaseToken: lease.leaseToken, actualAccount: required(flags, 'observed-account'), resultUrl: flags.get('result-url') ?? null,
        actualProfileId: flags.get('observed-profile-id'),
        ...(analyticsFile ? { analyticsCsv: readFileSync(resolve(analyticsFile), 'utf8') } : {}),
        screenshotPath, discoveredComments,
      })
      unlinkSync(leasePath(jobId))
      output(result)
      return
    }
    const route = action
    const result = await api(`/api/executor/jobs/${encodeURIComponent(jobId)}/${route}`, 'POST', {
      leaseToken: lease.leaseToken, code: action === 'uncertain' ? 'result_uncertain' : required(flags, 'code'),
      message: required(flags, 'message'), screenshotPath,
    })
    unlinkSync(leasePath(jobId))
    output(result)
    return
  }
  if (action === 'reconcile') {
    const jobId = required(flags, 'job')
    output(await api(`/api/executor/jobs/${encodeURIComponent(jobId)}/reconcile`, 'POST', {
      resolution: required(flags, 'resolution'), actualAccount: flags.get('observed-account') ?? null, resultUrl: flags.get('result-url') ?? null,
    }))
    return
  }
  throw new Error(`未知命令：${action}`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : '命令执行失败'}\n`)
  process.exitCode = 1
})
