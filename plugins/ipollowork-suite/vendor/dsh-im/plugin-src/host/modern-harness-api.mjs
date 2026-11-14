import { randomUUID } from 'node:crypto';

import { activeHarnessInteractionOwner, clearModelCatalogCache, hasActiveHarnessInteractionOwner, harnessToolCallFromEvent, HarnessInteractionError } from '../../src/channels/shared/harness-client.mjs';
import { extractConnectionEvidence } from '../../src/channels/shared/connection-error.mjs';
import { harnessPeer } from './harness-peer.mjs';
import { sameWorkspacePath } from '../../src/channels/shared/default-workspace.mjs';

const modernApis = new WeakMap();

function failureOf(error) {
  const failure = error?.failure ?? (error?.isDSHRemoteError === true ? error : undefined);
  if (failure && typeof failure === 'object'
    && typeof failure.code === 'string'
    && typeof failure.message === 'string') {
    return {
      code: failure.code,
      message: failure.message,
      details: failure.details && typeof failure.details === 'object' ? failure.details : {},
    };
  }
  if (error?.name === 'AbortError' || error?.name === 'RemoteInvocationCancelled') {
    return {
      code: 'cancelled',
      message: error instanceof Error ? error.message : 'Harness request was cancelled',
      details: {},
    };
  }
  return {
    code: 'internal',
    message: error instanceof Error ? error.message : String(error),
    details: extractConnectionEvidence(error).details,
  };
}

function rpcResult(request, operation) {
  return Promise.resolve().then(operation).then(
    (value) => ({ rpcId: request.rpcId, result: { ok: true, value } }),
    (error) => ({ rpcId: request.rpcId, result: { ok: false, error: failureOf(error) } }),
  );
}

function remoteRequest(namespace, method, args, signal, peer) {
  return {
    namespace,
    method,
    args,
    ...(signal === undefined ? {} : { signal }),
    ...(peer === undefined ? {} : { peer }),
  };
}

function questionError(message, code) {
  const error = new Error(message);
  error.name = 'UserQuestionError';
  error.code = code;
  return error;
}

function adoptionError(code, message) {
  const error = new Error(message);
  error.failure = { code, message, details: {} };
  return error;
}

function sessionEvents(session) {
  if (typeof session?.snapshotEvents === 'function') {
    const events = session.snapshotEvents();
    if (Array.isArray(events)) return events;
  }
  const events = session?.events;
  return Array.isArray(events) ? events : null;
}

function matchesQuestions(value, pending) {
  if (!value || typeof value !== 'object'
    || value.sessionId !== pending.sessionId
    || !value.answer || typeof value.answer !== 'object'
    || !Array.isArray(value.answer.answers)
    || value.answer.answers.length !== pending.questions.length) return false;
  return value.answer.answers.every((answer, index) => {
    const question = pending.questions[index];
    if (!answer || typeof answer !== 'object'
      || answer.id !== question.id
      || !Array.isArray(answer.selected)
      || answer.selected.some((label) => typeof label !== 'string')
      || new Set(answer.selected).size !== answer.selected.length
      || (answer.custom !== undefined && typeof answer.custom !== 'string')) return false;
    const custom = answer.custom?.trim();
    if (custom !== undefined && !custom) return false;
    if (question.multiSelect !== true
      && ((custom !== undefined && answer.selected.length > 0) || answer.selected.length > 1)) return false;
    const labels = new Set(question.options?.map((option) => option.label) ?? []);
    return answer.selected.every((label) => labels.has(label));
  });
}

function expandChunkRecord(record) {
  if (record?.type === 'event' && record.event && typeof record.event === 'object') {
    return [{ event: record.event }];
  }
  const packed = record?.type === 'chunks' ? record.event : null;
  if (!packed || typeof packed !== 'object') {
    throw new Error('Harness returned an invalid session history record');
  }
  const { data } = packed;
  const kind = packed.type;
  const members = kind === 'chunkrow/tool-call-chunks' ? data?.args : data?.texts;
  if (!data || !Array.isArray(members) || members.length === 0
    || members.some((member) => typeof member !== 'string')
    || !Array.isArray(data.dt) || data.dt.length !== members.length - 1) {
    throw new Error('Harness returned an invalid packed session chunk');
  }
  let time = packed.time;
  return members.map((member, index) => {
    if (index > 0) time += data.dt[index - 1];
    let chunk;
    if (kind === 'chunkrow/text-chunks') {
      chunk = { type: 'text-delta', index: data.index, text: member };
    } else if (kind === 'chunkrow/reasoning-chunks') {
      chunk = { type: 'reasoning-delta', index: data.index, text: member };
    } else if (kind === 'chunkrow/tool-call-chunks') {
      chunk = {
        type: 'tool-call-delta',
        index: data.index,
        id: data.id,
        ...(Object.hasOwn(data, 'name') ? { name: data.name } : {}),
        argumentsDelta: member,
      };
    } else {
      throw new Error(`Harness returned an unsupported packed session chunk: ${String(kind)}`);
    }
    return {
      event: {
        type: 'assistant/chunk',
        seq: packed.seq + index,
        time,
        data: { turn: data.turn, step: data.step, chunk },
      },
    };
  });
}

function historyEntries(records) {
  if (!Array.isArray(records)) throw new Error('Harness returned invalid session history records');
  return records.flatMap(expandChunkRecord);
}

class MuxSubscription {
  #frames = [];
  #waiting = null;
  #closed = false;
  #signal;
  #onAbort;
  #dispose;

  constructor(signal, dispose) {
    this.#signal = signal;
    this.#dispose = dispose;
    this.#onAbort = () => this.close();
    signal?.addEventListener('abort', this.#onAbort, { once: true });
    if (signal?.aborted) this.close();
  }

  push(frame) {
    if (this.#closed) return;
    if (this.#waiting) {
      const resolve = this.#waiting;
      this.#waiting = null;
      resolve({ value: frame, done: false });
    } else {
      this.#frames.push(frame);
    }
  }

  next() {
    if (this.#frames.length > 0) {
      return Promise.resolve({ value: this.#frames.shift(), done: false });
    }
    if (this.#closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => { this.#waiting = resolve; });
  }

  return() {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#signal?.removeEventListener('abort', this.#onAbort);
    this.#dispose?.();
    this.#dispose = null;
    if (this.#waiting) {
      const resolve = this.#waiting;
      this.#waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

class ModernHarnessApi {
  #gateway;
  #peer;
  #deliveryService;
  #scope;
  #mux = new Set();
  #pendingQuestions = new Map();
  #pendingApprovals = new Map();
  #sessionCursors = new Map();
  #assistantStreams = new Map();
  #disposers = [];
  #disposed = false;

  constructor(ctx, gateway, scope) {
    this.#gateway = gateway;
    this.#scope = scope;
    this.#peer = harnessPeer(ctx);

    this.host = Object.freeze({
      describe: (request) => rpcResult(request, () => ({ ready: true, transport: 'typert' })),
    });
    this.workspace = Object.freeze({
      rename: (request, signal) => rpcResult(request, () => this.#invoke(
        'workspace', 'rename', { request: request.payload }, signal,
      )),
      list: (request, signal) => rpcResult(request, () => this.#workspaceList(signal)),
      create: (request, signal) => rpcResult(request, () => this.#invoke(
        'workspace', 'create', { request: request.payload }, signal,
      )),
    });
    this.sessions = Object.freeze({
      list: (request, signal) => rpcResult(request, () => this.#invoke(
        'session', 'list', { _request: request.payload }, signal,
      )),
      create: (request, signal) => rpcResult(request, () => this.#invoke(
        'session', 'create', { request: request.payload }, signal,
      )),
      adopt: (request, signal) => rpcResult(request, () => this.#adoptSession(request.payload, signal)),
      history: (request, signal) => rpcResult(request, () => this.#history(request.payload, signal)),
      prompt: (request, signal) => rpcResult(request, () => this.#invoke(
        'session',
        'prompt',
        { request: { requestId: request.rpcId, ...request.payload } },
        signal,
      )),
      rename: (request, signal) => rpcResult(request, () => this.#invoke(
        'session', 'rename', { request: request.payload }, signal,
      )),
      fork: (request, signal) => rpcResult(request, () => this.#invoke(
        'session', 'fork', { request: request.payload }, signal,
      )),
      cancel: (request, signal) => rpcResult(request, () => this.#invoke(
        'session', 'cancel', { request: { sessionId: request.payload.sessionId } }, signal,
      )),
      models: (request, signal) => rpcResult(request, () => this.#sessionModels(
        request.payload.sessionId, signal,
      )),
      permissions: (request, signal) => rpcResult(request, () => this.#sessionPermissions(
        request.payload.sessionId, signal,
      )),
      selectModel: (request, signal) => rpcResult(request, () => this.#invoke(
        'session', 'selectModel', { request: request.payload }, signal,
      )),
    });
    this.llm = Object.freeze({
      models: (request, signal) => rpcResult(request, async () => {
        const catalog = await this.#modelCatalog(signal);
        return { groups: catalog.groups, failures: catalog.failures };
      }),
    });
    this.events = Object.freeze({
      mux: (_request, signal) => this.#openMux(signal),
    });
    this.respond = (message) => Promise.resolve(this.#respond(message));

    if (typeof ctx?.on === 'function') {
      this.#disposers.push(ctx.on('session/event', (session, event) => {
        const sessionId = session?.id;
        if (typeof sessionId !== 'string' || !event || typeof event !== 'object') return;
        if (Number.isSafeInteger(event.seq)) this.#rememberCursor(sessionId, event.seq);
        this.#broadcast({ type: 'session/event', sessionId, event });
      }, { global: true }));
      this.#disposers.push(ctx.on('agent/assistant-stream', ({ agent, frame }) => {
        this.#acceptAssistantStream(agent, frame);
      }, { global: true }));
      this.#disposers.push(ctx.on('agent/disposed', ({ agent }) => {
        const sessionId = agent?.session?.id;
        if (typeof sessionId === 'string') this.#assistantStreams.delete(sessionId);
      }, { global: true }));
      this.#disposers.push(ctx.on(
        'approval/request',
        (request, next) => this.#requestApproval(request, next),
        { global: true, prepend: true },
      ));
      this.#disposers.push(ctx.on(
        'user-questions/request',
        (request, next) => this.#requestQuestion(request, next),
        { global: true, prepend: true },
      ));
    }
  }

  setDeliveryService(service) {
    if (service) this.#deliveryService = service;
  }

  async #invoke(namespace, method, args, signal) {
    return this.#gateway.invoke(remoteRequest(namespace, method, args, signal, this.#peer));
  }

  async #streamFirst(namespace, method, args, signal) {
    const controller = new AbortController();
    const streamSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    let iterator;
    try {
      const source = await this.#gateway.stream(remoteRequest(
        namespace, method, args, streamSignal, this.#peer,
      ));
      iterator = source[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done) throw new Error(`Harness ${namespace}.${method} stream ended before its baseline`);
      return first.value;
    } finally {
      controller.abort(new DOMException('Baseline received', 'AbortError'));
      await Promise.resolve(iterator?.return?.()).catch(() => undefined);
    }
  }

  async #workspaceList(signal) {
    const frame = await this.#streamFirst('workspace', 'follow', {}, signal);
    if (frame?.type !== 'baseline' || !frame.value || typeof frame.value !== 'object') {
      throw new Error('Harness workspace.follow returned no baseline');
    }
    return frame.value;
  }

  async #sessionSnapshot(sessionId, maxMessages, signal) {
    const frame = await this.#streamFirst('session', 'follow', {
      request: {
        address: { kind: 'session', sessionId },
        maxMessages,
      },
    }, signal);
    if (frame?.type !== 'snapshot' || !Number.isSafeInteger(frame.cursor)) {
      throw new Error('Harness session.follow returned no snapshot');
    }
    this.#rememberCursor(sessionId, frame.cursor);
    return frame;
  }

  async #adoptSession({ sessionId, workspaceId, cwd }, signal) {
    // Since DSH 0.2.1, create only reuses blank Sessions and can replace their
    // preset. Binding must observe the exact existing identity instead; the
    // next prompt resumes its Agent with the persisted configuration.
    const { header } = await this.#sessionSnapshot(sessionId, 1, signal);
    if (header?.id !== sessionId || typeof header.cwd !== 'string') {
      throw new Error('Harness returned an invalid Session header for adoption');
    }
    if (header.origin !== undefined) {
      throw adoptionError('session-subagent-unsupported', 'Only ordinary Sessions can be adopted');
    }
    let expectedCwd = cwd;
    if (workspaceId !== undefined) {
      const baseline = await this.#workspaceList(signal);
      const workspace = baseline.items?.find(item => item.workspaceId === workspaceId);
      if (cwd !== undefined || !workspace?.sessionIds?.includes(sessionId)) {
        throw adoptionError('session-workspace-ambiguous', 'Session workspace membership changed during adoption');
      }
      expectedCwd = workspace.path;
    }
    if (!await sameWorkspacePath(header.cwd, expectedCwd)) {
      throw adoptionError('session-workspace-ambiguous', 'Session directory does not match its workspace');
    }
    signal?.throwIfAborted();
    return { sessionId };
  }

  async #history(payload, signal) {
    const { sessionId, maxMessages = 50, beforeSeq } = payload;
    let cursor = this.#sessionCursors.get(sessionId);
    if (cursor === undefined) {
      const snapshot = await this.#sessionSnapshot(sessionId, maxMessages, signal);
      cursor = this.#sessionCursors.get(sessionId) ?? snapshot.cursor;
      if (beforeSeq === undefined && cursor === snapshot.cursor) {
        return {
          events: this.#withAssistantStream(sessionId, historyEntries(snapshot.records)),
          hasMore: snapshot.hasMore === true,
          ...(snapshot.projections === undefined ? {} : { projections: snapshot.projections }),
        };
      }
    }
    const page = await this.#invoke('session', 'page', {
      request: {
        address: { kind: 'session', sessionId },
        throughSeq: cursor,
        maxMessages,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      },
    }, signal);
    return {
      events: beforeSeq === undefined
        ? this.#withAssistantStream(sessionId, historyEntries(page.records))
        : historyEntries(page.records),
      hasMore: page.hasMore === true,
    };
  }

  #acceptAssistantStream(agent, frame) {
    const sessionId = agent?.session?.id;
    if (typeof sessionId !== 'string' || !frame || typeof frame !== 'object') return;
    if (frame.type === 'start') {
      const nextSeq = agent?.session?.seq;
      const startedAfterSeq = Number.isSafeInteger(nextSeq) && nextSeq >= 0
        ? nextSeq - 1
        : this.#sessionCursors.get(sessionId) ?? -1;
      this.#assistantStreams.set(sessionId, {
        attemptId: frame.attemptId,
        turn: frame.turn,
        step: frame.step,
        startedAfterSeq,
        entries: [],
      });
      return;
    }
    const stream = this.#assistantStreams.get(sessionId);
    if (!stream || stream.attemptId !== frame.attemptId) return;
    if (frame.type === 'end') {
      this.#assistantStreams.delete(sessionId);
      return;
    }
    if (frame.type !== 'chunk' || frame.index !== stream.entries.length) return;
    const entry = {
      type: 'transient',
      event: {
        type: 'assistant/chunk',
        // Match DSH's Web client ordering: live chunks sit in the numeric gap
        // before the durable assistant/message that replaces them.
        seq: stream.startedAfterSeq + 1 - 1 / (frame.index + 2),
        time: frame.time,
        data: { turn: stream.turn, step: stream.step, chunk: frame.chunk },
      },
    };
    stream.entries.push(entry);
    // History only exposes these transient chunks while the attempt is open.
    // Broadcast each one as it arrives so live IM renderers cannot miss a
    // short reasoning phase that starts and commits between two history polls.
    this.#broadcast({ type: 'session/event', sessionId, event: entry.event });
  }

  #withAssistantStream(sessionId, entries) {
    const transient = this.#assistantStreams.get(sessionId)?.entries ?? [];
    return transient.length === 0 ? entries : [...entries, ...transient];
  }

  #rememberCursor(sessionId, cursor) {
    const previous = this.#sessionCursors.get(sessionId);
    if (previous === undefined || cursor > previous) this.#sessionCursors.set(sessionId, cursor);
  }

  #modelCatalog(signal) {
    return this.#invoke('session', 'modelCatalog', {}, signal);
  }

  async #sessionPermissions(sessionId, signal) {
    const [catalog, projection] = await Promise.all([
      this.#invoke('permissionPresets', 'catalog', {}, signal),
      this.#invoke('session', 'projections', { request: { sessionId } }, signal),
    ]);
    if (projection === null) {
      const error = new Error('Session not found');
      error.failure = { code: 'session-not-found', message: error.message, details: {} };
      throw error;
    }
    const currentValue = projection?.values?.permissions?.currentValue;
    if (typeof currentValue !== 'string' || !Array.isArray(catalog?.options)) {
      const error = new Error('Host permission presets are unavailable');
      error.failure = { code: 'permissions-unavailable', message: error.message, details: {} };
      throw error;
    }
    return { currentValue, options: catalog.options };
  }

  async #sessionModels(sessionId, signal) {
    const [catalog, list] = await Promise.all([
      this.#modelCatalog(signal),
      this.#invoke('session', 'list', { _request: {} }, signal),
    ]);
    const summary = list?.items?.find((item) => item?.sessionId === sessionId);
    if (!summary) {
      const error = new Error(`session "${sessionId}" not found`);
      error.failure = {
        code: 'session-not-found',
        message: error.message,
        details: { sessionId },
      };
      throw error;
    }
    const selection = summary.projections?.values?.modelSelection;
    const current = selection?.next ?? selection?.lastUsed ?? catalog.default;
    return {
      current,
      routable: catalog.routableProviders.includes(current.provider),
      groups: catalog.groups,
      failures: catalog.failures,
    };
  }

  #openMux(signal) {
    let subscription;
    subscription = new MuxSubscription(signal, () => this.#mux.delete(subscription));
    this.#mux.add(subscription);
    for (const pending of this.#pendingQuestions.values()) {
      if (pending.broadcast) subscription.push(this.#questionFrame(pending));
    }
    for (const pending of this.#pendingApprovals.values()) {
      if (pending.broadcast !== false && pending.imAvailable !== false) subscription.push(this.#approvalFrame(pending));
    }
    return subscription;
  }

  #broadcast(payload, rpcId = randomUUID()) {
    const frame = { rpcId, payload };
    for (const subscription of this.#mux) subscription.push(frame);
  }

  #claimableAgent(agent) {
    const session = agent?.session;
    const sessionId = session?.id ?? agent?.id;
    const events = sessionEvents(session);
    if (typeof sessionId !== 'string' || !events) return null;
    return hasActiveHarnessInteractionOwner(
      this.#scope,
      sessionId,
      events,
    ) ? { sessionId, events } : null;
  }

  #questionFrame(pending) {
    return {
      rpcId: pending.rpcId,
      payload: {
        type: 'question/requested',
        sessionId: pending.sessionId,
        questions: pending.questions,
      },
    };
  }

  #requestQuestion(request, next) {
    const owner = this.#claimableAgent(request?.agent);
    const sessionId = owner?.sessionId ?? request?.agent?.session?.id ?? request?.agent?.id;
    if (typeof sessionId !== 'string'
      || (!owner && typeof this.#deliveryService?.presentSessionSyncQuestion !== 'function')) return next();
    const turnSignal = request.signal;
    if (turnSignal?.aborted) {
      return Promise.reject(questionError(
        'ask_user_question was aborted before the user answered', 'ASK_ABORTED',
      ));
    }
    // Give this question a lifetime of its own instead of lending it the enclosing
    // turn's. `dsh-agent-loop` mints one abort controller per turn and every tool
    // call in that turn shares the one signal, and under PTC two consumers of it
    // react to the abort EVENT rather than to `signal.aborted`: `run_code` flips its
    // own program controller from an abort listener (dsh-tools `onOuterAbort`) and
    // the worker code runtime retires the worker the same way
    // (dsh-code-runtime-worker-thread `onAbort`). Retiring the Web card by firing
    // that event therefore also killed the program that was merely waiting for this
    // answer — `code run failed (abort)`. A private controller keeps the retirement
    // below local: real upstream cancellation is forwarded into it, and every
    // listener on this waterfall — the Remote/Web forwarder that renders the card,
    // and our own IM pending — sees a lifetime that ends with this question rather
    // than with the turn.
    //
    // Handing it downstream means replacing `request.signal`, because the Cordis
    // waterfall passes the same request object to every remaining listener and
    // `next()` takes no replacement arguments. The object is a per-call copy made by
    // `UserQuestionService.ask`, and the signal it carried stays reachable here as
    // `turnSignal`, so the caller's own view of the request is untouched.
    const question = new AbortController();
    const forwardTurnAbort = () => question.abort(turnSignal?.reason);
    turnSignal?.addEventListener('abort', forwardTurnAbort, { once: true });
    request.signal = question.signal;
    // Race the IM answer against the host's own answerers (Web/CLI). Claiming the
    // request exclusively used to keep the question out of Web entirely, leaving
    // whoever happened to be looking at that Session with a card they could not
    // answer. Racing keeps both surfaces usable: the first answer wins.
    const im = this.#askThroughIm(request, { sessionId }, { broadcast: Boolean(owner) });
    let imAvailable = true;
    let nativeError;
    const withdraw = () => {
      imAvailable = false;
      im.withdraw();
      // No binding/provider must preserve the native error, not leave the tool waiting forever.
      if (nativeError) im.dismiss(nativeError);
    };
    let answeredByIm = false;
    const native = Promise.resolve()
      .then(() => next())
      .catch((error) => {
        nativeError = error;
        if (!imAvailable) throw error;
        // A pure-IM session has no client connected, so the host rejects with
        // NO_PROVIDER — an expected state rather than a failure — and ASK_ABORTED
        // is this adapter's own retire signal below. Any other error is real, so
        // log it instead of swallowing it silently; the question still stays open
        // for IM rather than being failed outright.
        if (error?.code !== 'NO_PROVIDER' && error?.code !== 'ASK_ABORTED') {
          console.warn(
            '[dsh-im] the host user-question answerer failed; waiting for the IM answer:',
            error?.message ?? error,
          );
        }
        return new Promise(() => {});
      });
    const result = Promise.race([
      native,
      im.promise.then((value) => {
        answeredByIm = true;
        return value;
      }),
    ]).finally(() => {
      // Losing side cleanup. A host answer already settled this request, so drop
      // the IM pending: leaving it registered would let a late press answer a
      // question the model has moved past. Settling is idempotent.
      im.dismiss(new Error('another client answered this question'));
      turnSignal?.removeEventListener('abort', forwardTurnAbort);
      if (answeredByIm) {
        // The host's own answerer (DSH Web) keeps its question card until its own
        // pending settles, and a host-side adapter has no other handle on it. A Web
        // client holds that pending through the lifetime this question handed
        // downstream, so ending that lifetime makes the client drop a card whose
        // answer was already given on IM — otherwise it keeps offering choices for a
        // question the model has moved past.
        //
        // Ending it is `abort`, not a dispatched `abort` event: a listener that
        // reads `signal.aborted` must see the same thing one that listens for the
        // event does. Either way it reaches only this question's controller, so the
        // turn and every other tool call in it — a waiting `run_code` program above
        // all — keep running. The reason carries `ASK_ABORTED` so the host answerer
        // rejecting alongside us stays an expected retirement rather than a logged
        // failure.
        question.abort(questionError('the question was answered on IM', 'ASK_ABORTED'));
      } else if (!owner) {
        // Also stop a bound-chat lookup/delivery still in flight when the Host wins.
        question.abort(questionError('the question ended', 'ASK_ABORTED'));
      }
    });
    if (!owner) {
      Promise.resolve().then(() => {
        if (question.signal.aborted) return false;
        return this.#deliveryService.presentSessionSyncQuestion(sessionId, {
          ...im.interaction, withdraw,
        }, { signal: question.signal, completion: result });
      }).then((available) => {
        if (!available) withdraw();
      }, (error) => {
        if (!question.signal.aborted) console.warn('[dsh-im] synced question delivery unavailable:', error?.code ?? error?.name);
        withdraw();
      });
    }
    return result;
  }

  /**
   * Present one question to IM clients. Returns the answer promise plus a
   * `dismiss` used to retire the pending when the host answers first.
   */
  #askThroughIm(request, owner, { broadcast = true } = {}) {
    let pending = null;
    const promise = new Promise((resolve, reject) => {
      pending = {
        rpcId: randomUUID(),
        sessionId: owner.sessionId,
        questions: request.questions,
        broadcast,
        imAvailable: true,
        signal: request.signal,
        settle: (outcome, value) => {
          if (!this.#pendingQuestions.delete(pending.rpcId)) return;
          request.signal?.removeEventListener('abort', onAbort);
          if (broadcast) this.#broadcast({
            type: 'question/resolved',
            sessionId: pending.sessionId,
            questionRpcId: pending.rpcId,
            outcome,
          });
          if (outcome === 'answered') resolve(value);
          else reject(value);
        },
      };
      const onAbort = () => pending.settle('cancelled', questionError(
        'ask_user_question was aborted before the user answered', 'ASK_ABORTED',
      ));
      this.#pendingQuestions.set(pending.rpcId, pending);
      request.signal?.addEventListener('abort', onAbort, { once: true });
      if (broadcast) this.#broadcast(this.#questionFrame(pending).payload, pending.rpcId);
    });
    return {
      promise,
      dismiss: (reason) => pending?.settle('cancelled', reason),
      withdraw: () => { pending.imAvailable = false; },
      interaction: {
        kind: 'question', interactionId: pending.rpcId, rpcId: pending.rpcId,
        sessionId: pending.sessionId, payload: this.#questionFrame(pending).payload,
        respond: async (response) => {
          const receipt = this.#respond({ rpcId: pending.rpcId, result: response });
          if (!receipt.accepted) throw new HarnessInteractionError(
            `interaction-${receipt.reason}`, 'This question is no longer answerable',
          );
          return receipt;
        },
      },
    };
  }

  #approvalFrame(pending) {
    return {
      rpcId: pending.rpcId,
      payload: {
        type: 'approval/requested',
        sessionId: pending.sessionId,
        approvalId: pending.approvalId,
        ...(pending.competitive ? { competitive: true } : {}),
        toolName: pending.toolName,
        ...(pending.callId === undefined ? {} : { callId: pending.callId }),
        ...(pending.reason === undefined ? {} : { reason: pending.reason }),
      },
    };
  }

  #requestApproval(request, next) {
    const session = request?.agent?.session;
    const sessionId = session?.id ?? request?.agent?.id;
    const events = sessionEvents(session);
    if (typeof sessionId !== 'string' || !events) return next();
    const owner = activeHarnessInteractionOwner(this.#scope, sessionId, events);
    if (owner && !owner.competitiveApprovals) return this.#requestExclusiveApproval(request, next);
    if (!owner && typeof this.#deliveryService?.presentSessionSyncApproval !== 'function') return next();
    const turnSignal = request.signal;
    if (turnSignal?.aborted) return Promise.resolve('cancelled');
    const claimed = new Set([...this.#pendingApprovals.values()].map((entry) => entry.approvalId));
    const decided = new Set();
    let approvalId;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === 'approval/decided') decided.add(event.data?.id);
      if (event.type !== 'approval/asked') continue;
      const id = event.data?.id;
      if (!id || decided.has(id) || claimed.has(id)
        || (request.callId ?? null) !== (event.data?.callId ?? null)) continue;
      approvalId = id;
      break;
    }
    if (!approvalId) return next();
    let toolCall = owner?.toolCalls.get(request.callId);
    if (!toolCall) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === 'turn/start') break;
        const call = harnessToolCallFromEvent(event);
        if (call?.callId === request.callId && call.name === request.toolName) {
          toolCall = call;
          break;
        }
      }
    }
    // This controller retires only this approval; the caller keeps its turn signal.
    const lifetime = new AbortController();
    request.signal = lifetime.signal;
    let nativeAvailable = true;
    let resolveResult;
    const result = new Promise((resolve) => { resolveResult = resolve; });
    const pending = {
      rpcId: randomUUID(), sessionId, approvalId,
      toolName: request.toolName, callId: request.callId, reason: request.reason,
      competitive: true, broadcast: Boolean(owner), imAvailable: true,
      settle: (outcome) => {
        if (!this.#pendingApprovals.delete(pending.rpcId)) return false;
        turnSignal?.removeEventListener('abort', onAbort);
        if (pending.broadcast) this.#broadcast({
          type: 'approval/resolved', sessionId, approvalId, outcome,
        });
        // Reserve the result before aborting the losing native presentation.
        resolveResult(outcome);
        lifetime.abort(new Error('approval settled'));
        if (request.signal === lifetime.signal) request.signal = turnSignal;
        return true;
      },
      withdraw: () => {
        if (!this.#pendingApprovals.has(pending.rpcId) || !pending.imAvailable) return false;
        pending.imAvailable = false;
        if (pending.broadcast) this.#broadcast({
          type: 'approval/resolved', sessionId, approvalId, outcome: 'unavailable',
        });
        if (!nativeAvailable) pending.settle('unavailable');
        return true;
      },
    };
    const onAbort = () => pending.settle('cancelled');
    this.#pendingApprovals.set(pending.rpcId, pending);
    turnSignal?.addEventListener('abort', onAbort, { once: true });
    if (turnSignal?.aborted) onAbort();
    // Start both providers without waiting for target lookup or platform delivery.
    Promise.resolve().then(() => {
      if (lifetime.signal.aborted) return 'cancelled';
      return next();
    }).then((outcome) => {
      if (outcome === 'allowed-once' || outcome === 'rejected') pending.settle(outcome);
      else {
        nativeAvailable = false;
        if (!pending.imAvailable) pending.settle('unavailable');
      }
    }, (error) => {
      nativeAvailable = false;
      if (!lifetime.signal.aborted) console.warn('[dsh-im] native approval provider unavailable:', error?.code ?? error?.name);
      if (!pending.imAvailable) pending.settle('unavailable');
    });
    if (!lifetime.signal.aborted && owner) {
      this.#broadcast(this.#approvalFrame(pending).payload, pending.rpcId);
    } else if (!lifetime.signal.aborted) {
      const respond = async (response) => {
        const receipt = this.#respond({ rpcId: pending.rpcId, result: response });
        if (!receipt.accepted) throw new HarnessInteractionError(
          `interaction-${receipt.reason}`, 'This approval is no longer answerable',
        );
        return receipt;
      };
      const interaction = {
        kind: 'approval', interactionId: approvalId, rpcId: pending.rpcId, sessionId,
        payload: this.#approvalFrame(pending).payload, toolCall, respond,
        withdraw: async () => pending.withdraw(),
      };
      Promise.resolve().then(() => {
        if (lifetime.signal.aborted) return false;
        return this.#deliveryService.presentSessionSyncApproval(sessionId, interaction, {
          signal: lifetime.signal, completion: result,
        });
      }).then((available) => {
        if (!available) pending.withdraw();
      }, (error) => {
        if (!lifetime.signal.aborted) console.warn('[dsh-im] synced approval delivery unavailable:', error?.code ?? error?.name);
        pending.withdraw();
      });
    }
    return result;
  }

  #requestExclusiveApproval(request, next) {
    const owner = this.#claimableAgent(request?.agent);
    if (!owner) return next();
    if (request.signal?.aborted) return Promise.resolve('cancelled');
    const claimed = new Set([...this.#pendingApprovals.values()].map((entry) => entry.approvalId));
    const decided = new Set();
    let approvalId;
    for (let index = owner.events.length - 1; index >= 0; index -= 1) {
      const event = owner.events[index];
      if (event.type === 'approval/decided') {
        decided.add(event.data?.id);
      } else if (event.type === 'approval/asked') {
        const id = event.data?.id;
        if (!id || decided.has(id) || claimed.has(id)) continue;
        if ((request.callId ?? null) !== (event.data?.callId ?? null)) continue;
        approvalId = id;
        break;
      }
    }
    if (approvalId === undefined) return next();
    return new Promise((resolve) => {
      const pending = {
        rpcId: randomUUID(),
        sessionId: owner.sessionId,
        approvalId,
        toolName: request.toolName,
        callId: request.callId,
        reason: request.reason,
        settle: (outcome) => {
          if (!this.#pendingApprovals.delete(pending.rpcId)) return;
          request.signal?.removeEventListener('abort', onAbort);
          this.#broadcast({
            type: 'approval/resolved',
            sessionId: pending.sessionId,
            approvalId: pending.approvalId,
            outcome,
          });
          resolve(outcome);
        },
      };
      const onAbort = () => pending.settle('cancelled');
      this.#pendingApprovals.set(pending.rpcId, pending);
      request.signal?.addEventListener('abort', onAbort, { once: true });
      this.#broadcast(this.#approvalFrame(pending).payload, pending.rpcId);
    });
  }

  #respond(message) {
    const approval = this.#pendingApprovals.get(message?.rpcId);
    if (approval) {
      if (approval.imAvailable === false) return { accepted: false, reason: 'not-pending' };
      if (approval.competitive && message?.result?.ok === false
        && message?.result?.error?.code === 'unavailable') {
        return approval.withdraw()
          ? { accepted: true } : { accepted: false, reason: 'not-pending' };
      }
      const value = message?.result?.value;
      if (message?.result?.ok !== true
        || !value || typeof value !== 'object'
        || value.sessionId !== approval.sessionId
        || value.approvalId !== approval.approvalId
        || (value.outcome !== 'allowed-once' && value.outcome !== 'rejected')) {
        return { accepted: false, reason: 'bad-response' };
      }
      approval.settle(value.outcome);
      return { accepted: true };
    }
    const question = this.#pendingQuestions.get(message?.rpcId);
    if (!question || !question.imAvailable) return { accepted: false, reason: 'not-pending' };
    if (message?.result?.ok !== true) {
      if (message?.result?.error?.code !== 'cancelled') {
        return { accepted: false, reason: 'bad-response' };
      }
      question.settle('cancelled', questionError(
        'the user cancelled ask_user_question', 'ASK_CANCELLED',
      ));
      return { accepted: true };
    }
    if (!matchesQuestions(message.result.value, question)) {
      return { accepted: false, reason: 'bad-response' };
    }
    const answer = {
      answers: message.result.value.answer.answers.map((item) => ({
        id: item.id,
        selected: [...item.selected],
        ...(item.custom === undefined ? {} : { custom: item.custom }),
      })),
    };
    question.settle('answered', answer);
    return { accepted: true };
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    clearModelCatalogCache(this);
    for (const subscription of [...this.#mux]) subscription.close();
    this.#assistantStreams.clear();
    for (const pending of [...this.#pendingApprovals.values()]) pending.settle('cancelled');
    for (const pending of [...this.#pendingQuestions.values()]) pending.settle(
      'cancelled',
      questionError('dsh-im interaction adapter was disposed', 'ASK_ABORTED'),
    );
    for (const dispose of this.#disposers.splice(0).reverse()) dispose?.();
  }
}

/** Create one modern compatibility API per Cordis Host root. */
export function modernHarnessApi(ctx, { deliveryService } = {}) {
  const scope = ctx?.root ?? ctx;
  if (!scope || !['object', 'function'].includes(typeof scope)) {
    throw new TypeError('dsh-im requires a Cordis Host context');
  }
  const cached = modernApis.get(scope);
  if (cached) {
    cached.setDeliveryService(deliveryService);
    return cached;
  }
  const gateway = ctx?.typertGateway;
  if (!gateway || typeof gateway.invoke !== 'function' || typeof gateway.stream !== 'function') {
    throw new TypeError('dsh-im requires the modern Host Typert gateway');
  }
  const api = new ModernHarnessApi(ctx, gateway, scope);
  api.setDeliveryService(deliveryService);
  modernApis.set(scope, api);
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      if (modernApis.get(scope) === api) modernApis.delete(scope);
      return api.dispose();
    }, 'dsh-im: modern Harness compatibility API');
  }
  return api;
}
