import { setTimeout as sleep } from 'node:timers/promises';

import { t } from '../shared/i18n.mjs';
import { harnessApprovalText } from '../shared/harness-approval.mjs';
import {
  harnessAnswerForQuestion,
  harnessQuestionText,
  validHarnessQuestion,
} from '../shared/harness-question.mjs';

const JOB_ID = /^job-[a-f0-9]{32}$/;
const RENEW_MS = 30_000;
const COMPLETED_LIMIT = 2_048;

function abortError() {
  return new DOMException('Office Job was cancelled', 'AbortError');
}

function clean(value, max = 8_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeFailure(error) {
  if (error?.code === 'office-job-alias-invalid') return error.message;
  if (error?.code === 'turn-stopped') return t('本机 Harness 已停止这次执行。');
  if (error?.code === 'office-job-conflict') return t('Office Job 已被领取、取消或结束。');
  return t('本机 Harness 未能完成任务；请检查 Harness 会话后重试。');
}

function renderPrompt(job, preset) {
  return [
    '# AI Office Handoff',
    '',
    t('你正在本机 DeepSeek Harness 中继续一个来自 AI Office 的任务。'),
    t('只在当前 Workspace 内行动。完成后必须返回：结果摘要、改动文件、验证证据、未解决风险。'),
    '',
    t('## 本机 Instruction Preset'),
    preset,
    '',
    ...(clean(job.instruction) ? [t('## 本轮补充指令'), clean(job.instruction), ''] : []),
    t('## Office 时间线'),
    clean(job.markdown, 200_000),
  ].join('\n');
}

function approvalRequest(interaction) {
  const id = clean(interaction?.interactionId || interaction?.rpcId, 180);
  if (!id || typeof interaction?.respond !== 'function') return null;
  if (interaction.kind === 'approval') {
    const prompt = harnessApprovalText(interaction.payload, {
      toolCall: interaction.toolCall,
      maxArgumentsLength: 10_000,
    });
    if (!prompt) return null;
    return {
      id,
      kind: 'approval',
      title: t('批准 {tool}', { tool: clean(interaction.payload?.toolName, 120) || t('Harness 工具') }),
      prompt,
      toolName: clean(interaction.payload?.toolName, 120),
    };
  }
  if (interaction.kind !== 'question') return null;
  const questions = interaction.payload?.questions;
  if (!Array.isArray(questions) || questions.length === 0
    || questions.some((question) => !validHarnessQuestion(question))) return null;
  return {
    id,
    kind: 'question',
    title: questions.length > 1 ? t('Harness 需要 {count} 项补充信息', { count: questions.length }) : clean(questions[0].header || questions[0].question, 160),
    prompt: questions.map((question, index) => harnessQuestionText(question, index, questions.length)).join('\n\n---\n\n'),
    questions,
  };
}

function waitForReply(entry, approvalId) {
  return new Promise((resolve, reject) => {
    if (entry.controller.signal.aborted) return reject(entry.controller.signal.reason ?? abortError());
    const onAbort = () => {
      entry.approvals.delete(approvalId);
      reject(entry.controller.signal.reason ?? abortError());
    };
    entry.controller.signal.addEventListener('abort', onAbort, { once: true });
    entry.approvals.set(approvalId, {
      resolve(value) {
        entry.controller.signal.removeEventListener('abort', onAbort);
        entry.approvals.delete(approvalId);
        resolve(value);
      },
    });
  });
}

export class OfficeJobExecutor {
  #config;
  #transport;
  #createHarness;
  #logger;
  #sleep;
  #active = new Map();
  #queued = new Set();
  #completed = new Set();
  #closed = false;
  #status = {
    running: 0,
    completed: 0,
    failed: 0,
    lastJobId: null,
    lastJobAt: null,
  };

  constructor({
    config,
    transport,
    createHarness,
    logger = console,
    sleepImpl = sleep,
  }) {
    if (!config || !transport || typeof createHarness !== 'function') {
      throw new TypeError('OfficeJobExecutor requires config, transport, and createHarness');
    }
    this.#config = config;
    this.#transport = transport;
    this.#createHarness = createHarness;
    this.#logger = logger;
    this.#sleep = sleepImpl;
  }

  get status() { return structuredClone(this.#status); }

  offer(jobId) {
    if (this.#closed || !JOB_ID.test(jobId) || this.#active.has(jobId)
      || this.#queued.has(jobId) || this.#completed.has(jobId)) return false;
    this.#queued.add(jobId);
    this.#drain();
    return true;
  }

  handleEvent(event) {
    const jobId = clean(event?.data?.jobId, 80);
    if (!JOB_ID.test(jobId)) return false;
    if (event.type === 'job.available') return this.offer(jobId);
    if (event.type === 'job.cancel') return this.cancel(jobId);
    if (event.type === 'approval.reply') {
      const entry = this.#active.get(jobId);
      const approvalId = clean(event.data?.approvalId, 180);
      const pending = entry?.approvals.get(approvalId);
      if (!pending) return false;
      pending.resolve({
        decision: event.data?.decision === 'approved' ? 'approved' : 'rejected',
        answer: clean(event.data?.answer),
      });
      return true;
    }
    return false;
  }

  cancel(jobId) {
    this.#queued.delete(jobId);
    const entry = this.#active.get(jobId);
    if (!entry) return false;
    entry.cancelled = true;
    entry.controller.abort(abortError());
    if (entry.sessionId && entry.harness) {
      void entry.harness.rpc('session.cancel', {
        sessionId: entry.sessionId,
        keepInbox: true,
      }, 10_000).catch(() => undefined);
    }
    return true;
  }

  async close() {
    this.#closed = true;
    this.#queued.clear();
    for (const entry of this.#active.values()) entry.controller.abort(abortError());
    await Promise.allSettled([...this.#active.values()].map((entry) => entry.task));
  }

  #drain() {
    while (!this.#closed && this.#active.size < this.#config.maxConcurrency && this.#queued.size > 0) {
      const jobId = this.#queued.values().next().value;
      this.#queued.delete(jobId);
      const entry = {
        controller: new AbortController(),
        approvals: new Map(),
        harness: null,
        sessionId: null,
        leaseToken: null,
        cancelled: false,
        lastProgressAt: 0,
        lastProgress: '',
        task: null,
      };
      entry.task = this.#run(jobId, entry).finally(() => {
        this.#active.delete(jobId);
        this.#status.running = this.#active.size;
        this.#drain();
      });
      this.#active.set(jobId, entry);
      this.#status.running = this.#active.size;
      void entry.task.catch((error) => this.#logger.warn?.('[dsh-im:office] Job task ended:', error.message));
    }
  }

  async #run(jobId, entry) {
    const signal = entry.controller.signal;
    let renewTask = null;
    try {
      const fetched = await this.#transport.getJob(jobId, { signal });
      const job = fetched?.job;
      if (!job || job.id !== jobId) throw new Error('Office returned an invalid Job payload');
      const accepted = await this.#transport.acceptJob(jobId, { signal });
      if (!clean(accepted?.leaseToken, 200)) throw new Error('Office returned an invalid Job lease');
      entry.leaseToken = accepted.leaseToken;
      renewTask = this.#renew(jobId, entry);
      const workspace = this.#config.workspaces[job.workspaceAlias];
      const preset = this.#config.instructionPresets[job.instructionPreset];
      if (!workspace || !preset) {
        const error = new Error(t('Office Job 引用了本机未配置的 Workspace/Preset alias。'));
        error.code = 'office-job-alias-invalid';
        throw error;
      }
      entry.harness = this.#createHarness({ workspace });
      await this.#progress(jobId, entry, { kind: 'status', message: t('已领取 Job，准备 Workspace alias：{alias}', { alias: job.workspaceAlias }) }, true);
      entry.sessionId = await entry.harness.createSession({ signal, workspace });
      await this.#progress(jobId, entry, { kind: 'status', message: t('Harness Session 已创建。'), sessionId: entry.sessionId }, true);
      const answer = await entry.harness.ask(entry.sessionId, renderPrompt(job, preset), {
        timeoutMs: 30 * 60_000,
        signal,
        onUpdate: (update) => this.#handleUpdate(jobId, entry, update),
        onInteraction: (interaction) => this.#handleInteraction(jobId, entry, interaction),
        onInteractionResolved: (resolution) => {
          const id = clean(resolution?.interactionId, 180);
          entry.approvals.get(id)?.resolve({ decision: 'rejected', answer: '' });
        },
      });
      if (signal.aborted) throw signal.reason ?? abortError();
      await this.#transport.completeJob(jobId, entry.leaseToken, {
        resultMarkdown: answer,
        sessionId: entry.sessionId,
      }, { signal });
      this.#status.completed += 1;
      this.#rememberCompleted(jobId);
    } catch (error) {
      if (!entry.cancelled && entry.leaseToken) {
        await this.#transport.failJob(jobId, entry.leaseToken, {
          error: safeFailure(error),
          ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
        }).catch(() => undefined);
        this.#status.failed += 1;
      }
      if (error?.code === 'office-job-conflict' || error?.code === 'office-hook-unavailable') {
        this.#rememberCompleted(jobId);
        return;
      }
      if (!entry.cancelled && !signal.aborted) this.#logger.warn?.(`[dsh-im:office] Job ${jobId} failed:`, error.message);
    } finally {
      entry.controller.abort(abortError());
      await renewTask?.catch(() => undefined);
      this.#status.lastJobId = jobId;
      this.#status.lastJobAt = new Date().toISOString();
    }
  }

  async #renew(jobId, entry) {
    while (!entry.controller.signal.aborted) {
      try { await this.#sleep(RENEW_MS, undefined, { signal: entry.controller.signal }); }
      catch { return; }
      try {
        await this.#transport.renewJob(jobId, entry.leaseToken, { signal: entry.controller.signal });
      } catch (error) {
        if (entry.controller.signal.aborted) return;
        entry.cancelled = true;
        entry.controller.abort(error);
        if (entry.sessionId && entry.harness) {
          void entry.harness.rpc('session.cancel', {
            sessionId: entry.sessionId,
            keepInbox: true,
          }, 10_000).catch(() => undefined);
        }
        return;
      }
      try {
        const snapshot = await this.#transport.getJob(jobId, { signal: entry.controller.signal });
        const approval = snapshot?.job?.approval;
        if (approval && (approval.status === 'approved' || approval.status === 'rejected')) {
          entry.approvals.get(approval.id)?.resolve({
            decision: approval.status,
            answer: clean(approval.answer),
          });
        }
      } catch (error) {
        if (entry.controller.signal.aborted) return;
        this.#logger.warn?.(
          `[dsh-im:office] Job ${jobId} approval poll failed; will retry after the next renewal:`,
          error.message,
        );
      }
    }
  }

  async #handleUpdate(jobId, entry, update) {
    const message = update?.type === 'tool' ? t('正在使用 {tool}…', { tool: clean(update.name, 160) || t('Harness 工具') })
      : clean(update?.text, 4_000);
    if (!message) return;
    const key = `${update.type}:${message}`;
    if (key === entry.lastProgress) return;
    const now = Date.now();
    if (update.type === 'text' && now - entry.lastProgressAt < 1_000) return;
    entry.lastProgress = key;
    entry.lastProgressAt = now;
    await this.#progress(jobId, entry, {
      kind: update.type === 'tool' ? 'tool' : update.type === 'text' ? 'text' : 'status',
      message,
      ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    });
  }

  #progress(jobId, entry, value, required = false) {
    const request = this.#transport.progressJob(jobId, entry.leaseToken, value, {
      signal: entry.controller.signal,
    });
    return required ? request : request.catch((error) => {
      this.#logger.debug?.('[dsh-im:office] ignored a progress delivery failure:', error.message);
    });
  }

  async #handleInteraction(jobId, entry, interaction) {
    const request = approvalRequest(interaction);
    if (!request) {
      if (interaction?.kind === 'approval' && typeof interaction.respond === 'function') {
        await interaction.respond({
          ok: true,
          value: {
            sessionId: interaction.sessionId,
            approvalId: interaction.payload?.approvalId,
            outcome: 'rejected',
          },
        });
      }
      return;
    }
    const reply = waitForReply(entry, request.id);
    try {
      await this.#transport.requestApproval(jobId, entry.leaseToken, request, {
        signal: entry.controller.signal,
      });
      const decision = await reply;
      if (request.kind === 'approval') {
        await interaction.respond({
          ok: true,
          value: {
            sessionId: interaction.sessionId,
            approvalId: interaction.payload.approvalId,
            outcome: decision.decision === 'approved' ? 'allowed-once' : 'rejected',
          },
        });
        return;
      }
      if (decision.decision !== 'approved') {
        await interaction.respond({
          ok: false,
          error: { code: 'cancelled', message: 'The AI Office user rejected this question.', details: {} },
        });
        return;
      }
      const answers = clean(decision.answer).split(/\r?\n/);
      await interaction.respond({
        ok: true,
        value: {
          sessionId: interaction.sessionId,
          answer: {
            answers: request.questions.map((question, index) => (
              harnessAnswerForQuestion(question, answers[index] || answers[0] || '')
            )),
          },
        },
      });
    } catch (error) {
      entry.approvals.delete(request.id);
      throw error;
    }
  }

  #rememberCompleted(jobId) {
    this.#completed.add(jobId);
    if (this.#completed.size <= COMPLETED_LIMIT) return;
    this.#completed.delete(this.#completed.values().next().value);
  }
}
