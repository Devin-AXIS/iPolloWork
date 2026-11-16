import { extractConnectionEvidence, createConnectionDiagnostics } from '../shared/connection-error.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

import { t } from '../shared/i18n.mjs';
import { OfficeTransport } from './office-transport.mjs';
import { OFFICE_PROTOCOL_VERSION } from './protocol.mjs';
import { OfficeJobExecutor } from './office-job-executor.mjs';

const RETRY_DELAYS = Object.freeze([1_000, 3_000, 10_000, 30_000]);

function safeConnectionError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'office-connection-failed';
  const messages = {
    'invalid-device-token': t('AI Office 拒绝了 Device Token。'),
    'office-hook-unavailable': t('AI Office Connector Hook 尚未就绪。'),
    'office-protocol-mismatch': t('AI Office Connector 协议版本不兼容。'),
    'office-transport-failed': t('本机暂时无法访问 AI Office。'),
  };
  return { code, message: messages[code] ?? t('AI Office 连接已中断。') };
}

export class OfficeRuntime {
  #config;
  #token;
  #logger;
  #diagnostics;
  #transport;
  #sleep;
  #controller = null;
  #task = null;
  #status;
  #jobs;

  constructor({
    config,
    token,
    logger = console,
    transport,
    createHarness,
    jobExecutor,
    sleepImpl = sleep,
  }) {
    this.#config = config;
    this.#token = token;
    this.#logger = logger;
    this.#diagnostics = createConnectionDiagnostics({ channel: 'office', logger });
    this.#sleep = sleepImpl;
    this.#transport = transport ?? new OfficeTransport({
      baseUrl: config.baseUrl, deviceId: config.deviceId, token,
    });
    this.#status = {
      state: 'idle', connected: false, startedAt: null, lastHeartbeatAt: null,
      lastEventAt: null, lastEventId: null, lastEventType: null, reconnects: 0,
      jobsOffered: 0, error: null,
    };
    this.#jobs = jobExecutor ?? (createHarness ? new OfficeJobExecutor({
      config,
      transport: this.#transport,
      createHarness,
      logger,
    }) : null);
  }

  get status() {
    return structuredClone({
      ...this.#status,
      ...(this.#jobs ? { jobs: this.#jobs.status } : {}),
    });
  }

  capabilities() {
    return {
      protocolVersion: OFFICE_PROTOCOL_VERSION,
      deviceId: this.#config.deviceId,
      workspaces: Object.keys(this.#config.workspaces),
      instructionPresets: Object.keys(this.#config.instructionPresets),
      maxConcurrency: this.#config.maxConcurrency,
    };
  }

  async testConnection(signal) {
    await this.#transport.heartbeat({ ...this.capabilities(), probe: true }, { signal });
    return { ok: true };
  }

  start() {
    if (this.#task) return this.status;
    this.#controller = new AbortController();
    this.#status.startedAt = new Date().toISOString();
    this.#status.state = 'connecting';
    this.#task = this.#run(this.#controller.signal).finally(() => { this.#task = null; });
    this.#task.catch((error) => {
      if (this.#controller?.signal.aborted) return;
      this.#logger.error?.('[dsh-im:office] connector stopped:', extractConnectionEvidence(error).details);
    });
    return this.status;
  }

  async #run(signal) {
    let attempt = 0;
    while (!signal.aborted) {
      const attemptController = new AbortController();
      const attemptSignal = AbortSignal.any([signal, attemptController.signal]);
      try {
        const heartbeat = await this.#transport.heartbeat(this.capabilities(), { signal: attemptSignal });
        this.#offerJobs(heartbeat?.jobs);
        this.#status.lastHeartbeatAt = new Date().toISOString();
        let streamOpened = false;
        const heartbeatTask = this.#heartbeatLoop(attemptSignal, () => {
          if (streamOpened && !attemptSignal.aborted) attempt = 0;
        });
        const stream = this.#transport.stream({
          signal: attemptSignal,
          lastEventId: this.#status.lastEventId,
          onOpen: () => {
            this.#status.connected = true;
            this.#status.state = 'connected';
            this.#status.error = null; this.#diagnostics.clear();
            streamOpened = true;
          },
          onEvent: async (event) => {
            this.#status.lastEventAt = new Date().toISOString();
            this.#status.lastEventId = event.id ?? this.#status.lastEventId;
            this.#status.lastEventType = event.type;
            if (event.type === 'job.available') this.#status.jobsOffered += 1;
            this.#jobs?.handleEvent(event);
          },
        });
        await Promise.race([stream, heartbeatTask]);
      } catch (error) {
        if (signal.aborted) break;
        attemptController.abort();
        this.#status.connected = false;
        this.#status.state = 'reconnecting';
        this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', automatic: true, publicError: safeConnectionError(error) }).publicError;
        this.#status.reconnects += 1;
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        attempt += 1;
        try { await this.#sleep(delay, undefined, { signal }); } catch { break; }
      } finally {
        attemptController.abort();
      }
    }
    this.#status.connected = false;
    this.#status.state = 'idle';
  }

  async #heartbeatLoop(signal, onSuccess) {
    while (!signal.aborted) {
      await this.#sleep(this.#config.heartbeatSeconds * 1_000, undefined, { signal });
      const heartbeat = await this.#transport.heartbeat(this.capabilities(), { signal });
      this.#offerJobs(heartbeat?.jobs);
      this.#status.lastHeartbeatAt = new Date().toISOString();
      onSuccess?.();
    }
  }

  #offerJobs(jobs) {
    if (!Array.isArray(jobs)) return;
    for (const job of jobs) {
      if (typeof job?.id === 'string' && this.#jobs?.offer(job.id)) this.#status.jobsOffered += 1;
    }
  }

  async stop() {
    const task = this.#task;
    this.#controller?.abort();
    this.#controller = null;
    if (task) await task.catch(() => undefined);
    await this.#jobs?.close();
    this.#status.connected = false;
    this.#status.state = 'idle';
    return this.status;
  }
}
