import { ServiceError } from './errors.js';
import type { App } from './http.js';

export interface QueueLimits { concurrency: number; queue: number; waitMs: number }
export type Lane = 'api' | 'auth' | 'execution' | 'transfer' | 'mcp';
export type AdmissionConfig = Record<Lane, QueueLimits>;
type Release = () => void;
interface Waiter { grant(): void; reject(error: Error): void }

/** FIFO admission bounds work before request bodies or upstream calls are allocated. */
export class AdmissionQueue {
  private active = 0;
  private readonly waiting = new Set<Waiter>();
  private stopped = false;
  private admitted = 0;
  private rejected = 0;
  private peak = 0;
  constructor(readonly limits: QueueLimits) {}
  snapshot() { return { active: this.active, queued: this.waiting.size, admitted: this.admitted, rejected: this.rejected, peak: this.peak, ...this.limits }; }
  acquire(signal?: AbortSignal): Promise<Release> {
    if (this.stopped) return Promise.reject(this.busy('SERVICE_DRAINING'));
    if (signal?.aborted) return Promise.reject(this.busy('REQUEST_CANCELLED'));
    if (this.active < this.limits.concurrency) return Promise.resolve(this.lease());
    if (this.waiting.size >= this.limits.queue) return Promise.reject(this.busy('SERVICE_BUSY'));
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.waiting.delete(waiter); };
      const waiter: Waiter = {
        grant: () => { cleanup(); resolve(this.lease()); },
        reject: error => { cleanup(); reject(error); },
      };
      const abort = () => waiter.reject(this.busy('REQUEST_CANCELLED'));
      const timer = setTimeout(() => waiter.reject(this.busy('SERVICE_QUEUE_TIMEOUT')), this.limits.waitMs);
      timer.unref();
      this.waiting.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  close() { this.stopped = true; for (const item of this.waiting) item.reject(this.busy('SERVICE_DRAINING')); }
  private busy(code: string) {
    this.rejected++;
    return new ServiceError(code, 503, code === 'SERVICE_DRAINING' ? '服务正在重启，请稍后重试' : '当前请求较多，请稍后重试');
  }
  private lease(): Release {
    this.active++; this.admitted++; this.peak = Math.max(this.peak, this.active);
    let released = false;
    return () => {
      if (released) return;
      released = true; this.active--;
      if (!this.stopped) this.waiting.values().next().value?.grant();
    };
  }
}

export function requestLane(path: string, method: string, headers: Headers): Lane {
  if (path.startsWith('/api/auth/') && method === 'POST') return 'auth';
  if (/^\/api\/v1\/me\/enterprise-mcp\/[^/]+\/connect$/.test(path)) return 'mcp';
  if (/^\/api\/v1\/(?:services|capabilities)\/[^/]+\/invoke$/.test(path) || path.startsWith('/api/v1/capability-tasks/') || /^\/api\/v1\/stage\/(?:generate|export|task|source)$/.test(path)) return 'execution';
  if (path.startsWith('/p/') || /^\/api\/v1\/publications\/[^/]+\/files\//.test(path) || /\/(?:artifacts\/upload|download|content)$/.test(path)
    || Number(headers.get('content-length')) > 1024 * 1024 || headers.has('transfer-encoding')) return 'transfer';
  return 'api';
}

/** A lease lasts through response consumption, including SSE and slow downloads. */
function leasedResponse(response: Response, release: Release, signal: AbortSignal): Response {
  if (!response.body) { release(); return response; }
  const reader = response.body.getReader();
  let done = false;
  const finish = () => { if (!done) { done = true; signal.removeEventListener('abort', abort); release(); } };
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}).finally(finish); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { finish(); reader.releaseLock(); controller.close(); }
        else controller.enqueue(chunk.value);
      } catch (error) { finish(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export class Admission {
  private draining = false;
  private readonly lanes: Record<Lane, AdmissionQueue>;
  constructor(config: AdmissionConfig) {
    this.lanes = { api: new AdmissionQueue(config.api), auth: new AdmissionQueue(config.auth), execution: new AdmissionQueue(config.execution), transfer: new AdmissionQueue(config.transfer), mcp: new AdmissionQueue(config.mcp) };
  }
  get isDraining() { return this.draining; }
  snapshot() { return Object.fromEntries(Object.entries(this.lanes).map(([name, queue]) => [name, queue.snapshot()])); }
  close() { this.draining = true; for (const queue of Object.values(this.lanes)) queue.close(); }
  mount(app: App) {
    app.use('*', async (c, next) => {
      if (c.req.path === '/api/health' || c.req.path === '/api/ready') return next();
      const lane = requestLane(c.req.path, c.req.method, c.req.raw.headers);
      const release = await this.lanes[lane].acquire(c.req.raw.signal);
      let streaming = false;
      try {
        await next();
        const streamsUpstream = lane === 'mcp' || (lane === 'execution' && /^\/api\/v1\/services\/[^/]+\/invoke$/.test(c.req.path))
          || (lane === 'transfer' && c.req.method === 'GET' && !c.res.headers.get('content-type')?.startsWith('application/json'));
        if (!streamsUpstream || c.res.status >= 400 || c.req.method === 'HEAD') release();
        else c.res = leasedResponse(c.res, release, c.req.raw.signal);
        streaming = true;
      } finally { if (!streaming) release(); }
    });
  }
}
