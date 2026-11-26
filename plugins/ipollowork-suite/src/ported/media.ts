import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { randomUUID, createHash } from 'node:crypto'
import { lstat, realpath, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join, dirname, relative, resolve, isAbsolute, extname, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ServiceCenter } from '../shared/services.ts'
import { downloadMedia } from './download.ts'

declare module '@deepseek-ai/cordis' { interface Context { ipolloServices: ServiceCenter } }
const object = z.record(z.string(), z.unknown())
const catalog = z.object({ items: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string() })) })
const detail = z.object({ id: z.string(), models: z.array(z.object({ id: z.string(), name: z.string(), inputModalities: z.array(z.string()).optional() })) })
const receipt = z.object({ requestId: z.uuid(), kind: z.string().optional(), state: z.string(), result: object.optional() })

/** Real paths, including every existing parent, must stay inside the selected native workspace. */
export async function workspaceFile(root: string, path: string, create = false): Promise<string> {
  if (!path || isAbsolute(path) || path.replaceAll('\\', '/').split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Use a workspace-relative file')
  const base = await realpath(root), parts = path.replaceAll('\\', '/').split('/')
  let current = base
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!)
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return undefined })
    if (info?.isSymbolicLink()) throw new Error('Linked files are not supported')
    if (!info && create && index < parts.length - 1) await mkdir(current)
    else if (!info && !create) throw new Error('File does not exist')
  }
  const rest = relative(base, current)
  if (!rest || isAbsolute(rest) || rest === '..' || rest.startsWith('..' + sep)) throw new Error('Invalid workspace path')
  return current
}
const text = (input: Record<string, unknown>, key: string, fallback = '') => typeof input[key] === 'string' ? input[key] : fallback
const mimeOf = (path: string) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' })[extname(path)] ?? 'application/octet-stream'

/** Translate the old media service verbs to account-authorized native capabilities. */
export async function capabilityActions(ctx: Context, workspace: { id: string; path: string }, name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; result?: unknown; message?: string }> {
  const center = ctx.get('ipolloServices')
  if (!center?.capability) return { ok: false, message: '请启用 iPolloWork 服务中心并登录，再选择可用模型' }
  const call = center.capability.bind(center)
  const kind = name.startsWith('video-generation/') ? 'video' : name.startsWith('media/') ? 'speech' : 'image'
  const list = async () => {
    const values = catalog.parse(await call('/api/v1/capabilities?kind=' + kind, undefined, signal))
    return (await Promise.all(values.items.slice(0, 20).map(async item => ({ item, details: detail.parse(await call('/api/v1/capabilities/' + encodeURIComponent(item.id), undefined, signal)) })))).flatMap(({ item, details }) => details.models.map(model => ({ ...model, capability: item.id, provider: item.title,
      operations: kind === 'video' ? model.inputModalities?.includes('image') ? ['text', 'first'] : ['text'] : ['generate', ...(model.inputModalities?.includes('image') ? ['edit'] : [])],
      ...(kind === 'image' ? { label: model.name, available: true, parameters: {},
        capabilities: { generate: true, edit: model.inputModalities?.includes('image') ?? false } } : {}),
      ratios: ['adaptive'], durations: [5, 10], resolutions: ['720p', '1080p'], configured: true })))
  }
  const operation = name.split('/')[1]
  try {
    if (operation === 'status') {
      const models = await list()
      return { ok: true, result: { configured: models.length > 0, ready: models.length > 0, models, ratios: ['adaptive'], output: { configured: models.length > 0 } } }
    }
    const ledgerDir = '.ipollowork/plugins/media-studio/jobs'
    const loadJobs = async () => {
      const { readdir } = await import('node:fs/promises')
      const dir = await workspaceFile(workspace.path, ledgerDir + '/placeholder', true)
      const names = await readdir(dirname(dir))
      return Promise.all(names.filter(item => /^[a-f0-9-]{36}\.json$/.test(item)).slice(-100).map(async file => object.parse(JSON.parse(await readFile(join(dirname(dir), file), 'utf8')))))
    }
    const saveJob = async (job: Record<string, unknown>) => {
      const id = z.uuid().parse(job.id)
      const file = await workspaceFile(workspace.path, `${ledgerDir}/${id}.json`, true)
      const temporary = file + '.' + randomUUID() + '.tmp'
      await writeFile(temporary, JSON.stringify(job)); await rename(temporary, file)
      return job
    }
    if (operation === 'jobs') return { ok: true, result: { jobs: await loadJobs() } }
    if (operation === 'read') {
      const path = text(input, 'path', text(input, 'sourcePath')), file = await workspaceFile(workspace.path, path)
      const data = await readFile(file)
      if (data.byteLength > 256 * 1024 * 1024) throw new Error('文件超过 256 MB')
      return { ok: true, result: { path, sourcePath: path, mimeType: mimeOf(path), dataUrl: `data:${mimeOf(path)};base64,${data.toString('base64')}`, bytes: data.length } }
    }
    const saveOutput = async (raw: unknown, outputKind = kind, outputId?: string): Promise<Record<string, unknown>> => {
      const value = object.parse(raw)
      const output = value.output && typeof value.output === 'object' ? object.parse(value.output) : value
      const entries = Array.isArray(value.data) ? value.data : []
      const first = entries.length ? object.parse(entries[0]) : output
      const encoded = text(first, 'b64_json', text(output, 'base64'))
      const results = Array.isArray(output.results) ? output.results : []
      const nested = results.length ? object.parse(results[0]) : output
      const choices = Array.isArray(output.choices) ? output.choices : []
      const choice = choices.length ? object.parse(choices[0]) : {}
      const message = choice.message && typeof choice.message === 'object' ? object.parse(choice.message) : {}
      const content = Array.isArray(message.content) ? message.content : []
      const image = content.find(item => item && typeof item === 'object' && item.image)
      const remote = text(first, 'url', text(nested, 'url', text(output, 'video_url', text(output, 'audio_url', image ? text(object.parse(image), 'image') : ''))))
      const bytes = encoded ? Buffer.from(encoded, 'base64') : await downloadMedia(remote, signal)
      if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('生成结果为空或过大')
      const extension = outputKind === 'speech' ? '.mp3' : outputKind === 'video' ? '.mp4' : '.png'
      const path = text(input, 'outputPath', `artifacts/${outputKind}/${outputId ?? randomUUID()}${extension}`)
      const file = await workspaceFile(workspace.path, path, true)
      await writeFile(file, bytes, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
        if (!outputId || error.code !== 'EEXIST') throw error
        const existing = await lstat(file)
        if (!existing.isFile() || existing.size !== bytes.length || !(await readFile(file)).equals(bytes))
          throw new Error('同名图片已有修改，请先另存现有文件')
      })
      return { path, sourcePath: path, mimeType: mimeOf(path), bytes: bytes.length, revision: createHash('sha256').update(bytes).digest('hex') }
    }
    if (operation === 'image_recover') {
      const requestId = z.uuid().parse(input.requestId)
      const value = receipt.parse(await call('/api/v1/capability-tasks/' + requestId, undefined, signal))
      if (value.kind !== 'image' || value.requestId !== requestId) throw new Error('该任务编号不属于图片生成')
      if (value.state !== 'succeeded') throw new Error(value.state === 'pending' ? '图片仍在生成，请稍后再查询' : '该图片任务未成功完成，无法找回结果')
      return { ok: true, result: { ...await saveOutput(value.result, 'image', requestId), requestId } }
    }
    if (operation === 'recover') {
      const requestId = z.uuid().parse(input.requestId ?? input.jobId ?? input.id)
      const value = receipt.parse(await call('/api/v1/capability-tasks/' + requestId, undefined, signal))
      const job = { id: requestId, status: value.state === 'pending' ? 'running' : value.state, requestId, result: value.result }
      if (value.state === 'succeeded') Object.assign(job, { output: await saveOutput(value.result) })
      await saveJob(job); return { ok: true, result: { job } }
    }
    if (!['image_generate', 'image_edit', 'submit', 'speech_synthesize_workspace_file'].includes(operation ?? '')) return { ok: false, message: '此旧版专用操作尚无 DSH 服务接口；可将素材交给原生 Design / Video 编辑器继续处理' }
    const models = await list(), requested = text(input, 'model')
    const model = models.find(item => item.id === requested) ?? (!requested ? models[0] : undefined)
    if (!model) throw new Error('请选择已授权的可用模型')
    const requestId = input.requestId ? z.uuid().parse(input.requestId) : randomUUID()
    const payload: Record<string, unknown> = kind === 'speech' ? { text: text(input, 'text'), voice: text(input, 'voice', 'Cherry') } : { prompt: text(input, 'prompt') }
    if (kind === 'image') {
      if (input.size && input.size !== 'auto') payload.size = input.size
      if (operation === 'image_edit') {
        if (!model.inputModalities?.includes('image')) throw new Error('此模型不支持参考图片')
        if (input.maskDataUrl || input.selectionId) throw new Error('此模型接口不支持局部蒙版；请使用原生图片编辑工作流')
        const source = text(input, 'sourcePath'), file = await workspaceFile(workspace.path, source)
        const bytes = await readFile(file)
        if (bytes.length > 12 * 1024 * 1024) throw new Error('参考图片过大')
        payload.images = [`data:${mimeOf(source)};base64,${bytes.toString('base64')}`]
      }
    }
    if (kind === 'video') {
      if (!['text', 'first', ''].includes(text(input, 'operation'))) throw new Error('此模型接口支持文生视频及单首帧视频')
      payload.duration = Number(input.duration ?? 5)
      if (input.resolution) payload.resolution = input.resolution
      if (input.firstFrame) { const source = text(input, 'firstFrame'), bytes = await readFile(await workspaceFile(workspace.path, source)); payload.image = `data:${mimeOf(source)};base64,${bytes.toString('base64')}` }
      await saveJob({ id: requestId, requestId, status: 'submitting', model: model.id })
    }
    let value = receipt.parse(await call(`/api/v1/capabilities/${encodeURIComponent(model.capability)}/invoke`, { requestId, model: model.id, input: payload }, signal))
    if (kind === 'video') {
      const job: Record<string, unknown> = { id: requestId, requestId, status: value.state === 'pending' ? 'running' : value.state, model: model.id, result: value.result }
      if (value.state === 'succeeded') job.output = await saveOutput(value.result)
      await saveJob(job); return { ok: true, result: { job } }
    }
    if (kind === 'image' && value.state === 'pending') {
      // Poll the existing receipt. Submitting the generation request again can incur a second charge.
      const pollSignal = AbortSignal.any([signal, AbortSignal.timeout(90_000)])
      try {
        while (value.state === 'pending') {
          await delay(3_000, undefined, { signal: pollSignal })
          value = receipt.parse(await call('/api/v1/capability-tasks/' + requestId, undefined, pollSignal))
        }
      } catch (error) {
        if (signal.aborted) throw error
        throw new Error(`暂时无法确认图片生成结果，请按任务编号 ${requestId} 查询`, { cause: error })
      }
    }
    if (value.state !== 'succeeded') {
      if (['failed', 'canceled', 'cancelled', 'expired'].includes(value.state))
        throw new Error(`图片或语音生成任务已失败（任务编号 ${requestId}）`)
      throw new Error(`暂时无法确认生成结果，请按任务编号 ${requestId} 查询`)
    }
    const output = await saveOutput(value.result, kind, kind === 'image' ? requestId : undefined).catch(error => {
      const reason = error instanceof Error ? error.message : '下载失败'
      throw new Error(`生成已完成，但未能保存产物（任务编号 ${requestId}）：${reason}`, { cause: error })
    })
    return { ok: true, result: kind === 'speech' ? { output } : { ...output, provider: model.provider, model: model.id, requestId } }
  } catch (error) {
    if (error instanceof Error && error.message === 'SERVICE_UPSTREAM_REJECTED')
      return { ok: false, message: '模型供应商拒绝了本次请求（SERVICE_UPSTREAM_REJECTED）' }
    return { ok: false, message: error instanceof Error && !/token|secret|password|Bearer|sk-/i.test(error.message) ? error.message.slice(0, 500) : 'AI 能力暂不可用，请检查登录和模型配置' }
  }
}
