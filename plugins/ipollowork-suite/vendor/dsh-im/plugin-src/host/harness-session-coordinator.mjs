import { randomUUID } from 'node:crypto';
import { COORDINATOR_PRESET } from '../../../../src/shared/coordinator.ts';
import { AssistantTextAccumulator, accumulateFinalAssistantText } from '../../src/channels/shared/harness-client.mjs';
import { retainInboundMedia } from '../../../../src/host/im-media.ts';
import { createTelegramVoiceTranscriber, VOICE_MAX_BYTES } from '../../src/channels/telegram/voice.mjs';

import {
  InboundFileError,
  stageInboundFiles,
} from '../../src/channels/shared/inbound-file.mjs';

function agentsFromContext(ctx) {
  if (typeof ctx?.get !== 'function') return undefined;
  let agents;
  try {
    agents = ctx.get('agents');
  } catch {
    return undefined;
  }
  if (agents === undefined || agents === null) return undefined;
  if (typeof agents.get !== 'function') {
    throw new TypeError('dsh-im requires a callable AgentRegistry when ctx.get("agents") is present');
  }
  return agents;
}

function currentOwnedTurn(agent, expectedTurn, promptRpcId) {
  if (agent?.status !== 'running') return false;
  const events = typeof agent?.session?.snapshotEvents === 'function'
    ? agent.session.snapshotEvents()
    : agent?.session?.events;
  if (!Array.isArray(events)) return false;

  let openTurn = null;
  let owned = false;
  for (const event of events) {
    if (event?.type === 'turn/start') {
      openTurn = event.data?.turn ?? null;
      owned = false;
      continue;
    }
    if (event?.type === 'turn/end' && event.data?.turn === openTurn) {
      openTurn = null;
      owned = false;
      continue;
    }
    if (openTurn === expectedTurn
      && event?.type === 'user/message'
      && event.data?.source?.rpcId === promptRpcId) {
      owned = true;
    }
  }
  return openTurn === expectedTurn && owned;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function steeringMessage(text, rpcId) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user', rpcId },
  });
}

function agentBusyError(cause) {
  const error = new Error('Session is busy with an active turn or maintenance task', { cause });
  error.code = 'agent-busy';
  return error;
}

function createControlExecutor(agents) {
  return ({ sessionId, expectedTurn, promptRpcId, inputRpcId, action, text }) => {
    const agent = agents.get(sessionId);
    // An unattached Session cannot be coordinated in-process. Let the client
    // retain its legacy HTTP path for deployments where attachment is lazy.
    if (!agent) return undefined;
    if (!currentOwnedTurn(agent, expectedTurn, promptRpcId)) return false;

    if (action === 'stop') {
      agent.cancel({ kind: 'user' }, { keepInbox: true });
      return true;
    }
    if (action === 'steer') {
      if (typeof text !== 'string' || !text.trim()
        || typeof inputRpcId !== 'string' || !inputRpcId) return false;
      // inject() never wakes an idle driver. Because validation and injection
      // share one JS tick, this context can only target this live turn's next step.
      agent.inject(steeringMessage(text, inputRpcId));
      return true;
    }
    throw new TypeError(`Unsupported Harness control action: ${String(action)}`);
  };
}

function createSessionMaintenanceExecutor(agents) {
  return ({ sessionId, operation }) => {
    if (typeof operation !== 'function') throw new TypeError('maintenance operation is required');
    const agent = agents.get(sessionId);
    if (!agent) return operation();
    try {
      // runMaintenance claims the true-idle phase synchronously. A prompt or a
      // second maintenance operation therefore cannot interleave with the RPC.
      return agent.runMaintenance((signal) => {
        if (agents.get(sessionId) !== agent) {
          const error = new Error('Session agent changed before maintenance started');
          error.code = 'agent-unavailable';
          throw error;
        }
        return operation(signal);
      });
    } catch (error) {
      throw agentBusyError(error);
    }
  };
}

function createFileIngressExecutor(agents, { inboundTtlService, ctx } = {}) {
  return async ({ sessionId, workspace, files, signal }) => {
    const agent = agents.get(sessionId);
    const attachedWorkspace = agent?.session?.header?.cwd;
    const exactWorkspace = typeof attachedWorkspace === 'string' && attachedWorkspace
      ? attachedWorkspace
      : workspace;
    if (typeof exactWorkspace !== 'string' || !exactWorkspace) {
      throw new InboundFileError(
        'inbound-file-workspace-unavailable',
        'The Harness Session workspace is unavailable for inbound files.',
      );
    }
    const staged = await stageInboundFiles({ files }, {
      workspace: exactWorkspace,
      signal,
      ...(inboundTtlService ? { retention: inboundTtlService.stagingRetention() } : {}),
      // Registration at creation time closes the mid-staging sweep window;
      // trackStaged later re-registers idempotently and owns the release.
      ...(typeof inboundTtlService?.trackDirectory === 'function'
        ? { onStagedDirectory: (directory) => inboundTtlService.trackDirectory(directory) }
        : {}),
    });
    if (!staged) return staged;
    try {
      const uploads = ctx?.get?.('fileUploads');
      if (!uploads) throw new Error('iPolloWork messaging requires native file uploads');
      const transcriber = createTelegramVoiceTranscriber({ speechToText: ctx?.get?.('speechToText') });
      const retained = await retainInboundMedia(staged, sessionId, {
        upload: (request) => uploads.uploadStream(request),
        maxSpeechBytes: VOICE_MAX_BYTES,
        ...(transcriber ? { transcribe: (audio, mediaType, signal) => transcriber.transcribe({ audio, voice: { mimeType: mediaType }, signal }) } : {}),
      }, signal);
      return inboundTtlService ? inboundTtlService.trackStaged(retained) : retained;
    } catch (error) {
      await staged.cleanup();
      throw error;
    }
  };
}

/**
 * Build optional same-process Session executors. File ingress also works for
 * cold Sessions by using the authoritative cwd returned by session.list;
 * when an Agent is attached, its live Session header remains authoritative.
 */
export function createHarnessSessionExecutors(ctx, provided = {}) {
  const {
    controlExecutor, sessionMaintenanceExecutor, fileIngressExecutor, inboundTtlService,
  } = provided;
  if (controlExecutor !== undefined && typeof controlExecutor !== 'function') {
    throw new TypeError('controlExecutor must be a function');
  }
  if (sessionMaintenanceExecutor !== undefined
    && typeof sessionMaintenanceExecutor !== 'function') {
    throw new TypeError('sessionMaintenanceExecutor must be a function');
  }
  if (fileIngressExecutor !== undefined && typeof fileIngressExecutor !== 'function') {
    throw new TypeError('fileIngressExecutor must be a function');
  }
  if (inboundTtlService !== undefined
    && (typeof inboundTtlService?.stagingRetention !== 'function'
      || typeof inboundTtlService?.trackStaged !== 'function')) {
    throw new TypeError('inboundTtlService must expose stagingRetention() and trackStaged()');
  }

  const agents = controlExecutor && sessionMaintenanceExecutor && fileIngressExecutor
    ? undefined
    : agentsFromContext(ctx);
  return {
    completionExecutor: async ({ sessionId, afterSeq, signal }) => {
      const agent = agentsFromContext(ctx)?.get(sessionId);
      const subagents = ctx?.get?.('subagents');
      if (agent?.session.header.agentPreset !== COORDINATOR_PRESET || !subagents) return undefined;
      const join = async () => {
        do { await agent.whenIdle(); } while (await subagents.waitForTreeWork(agent));
        await agent.whenIdle();
      };
      let abort;
      try {
        signal?.throwIfAborted();
        await Promise.race([join(), new Promise((_, reject) => {
          abort = () => reject(signal.reason);
          signal?.addEventListener('abort', abort, { once: true });
        })]);
        signal?.throwIfAborted();
      } finally { if (abort) signal?.removeEventListener('abort', abort); }
      const events = agent.session.snapshotEvents();
      const end = events.findLast(event => event.type === 'turn/end');
      if (!end || end.seq <= afterSeq) return undefined;
      const text = new AssistantTextAccumulator();
      for (const event of events) {
        if (event.data?.turn === end.data.turn) accumulateFinalAssistantText(text, event);
      }
      return { answer: text.text, reason: end.data.reason };
    },
    controlExecutor: controlExecutor ?? (agents ? createControlExecutor(agents) : undefined),
    sessionMaintenanceExecutor: sessionMaintenanceExecutor
      ?? (agents ? createSessionMaintenanceExecutor(agents) : undefined),
    fileIngressExecutor: fileIngressExecutor
      ?? createFileIngressExecutor(agents ?? { get: () => undefined }, { inboundTtlService, ctx }),
  };
}
