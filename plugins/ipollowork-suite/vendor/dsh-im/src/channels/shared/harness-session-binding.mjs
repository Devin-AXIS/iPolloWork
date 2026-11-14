import { mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const MAX_SESSION_ID_LENGTH = 256;
const UNSAFE_SESSION_ID = /[\p{White_Space}\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const UNSAFE_WORKSPACE_PATH = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function bindingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validatedSessionId(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_SESSION_ID_LENGTH
    || UNSAFE_SESSION_ID.test(value)) {
    throw bindingError('session-id-invalid', 'A non-empty, safe session id is required');
  }
  return value;
}

function sessionWorkspace(sessionId, value) {
  if (!Array.isArray(value?.items) || !Array.isArray(value?.archivedSessionIds)
    || value.archivedSessionIds.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('Harness returned an invalid response for workspace.list');
  }

  const owners = [];
  for (const workspace of value.items) {
    if (typeof workspace?.workspaceId !== 'string' || !workspace.workspaceId
      || typeof workspace.path !== 'string' || !isAbsolute(workspace.path)
      || !Array.isArray(workspace.sessionIds)
      || workspace.sessionIds.some((id) => typeof id !== 'string' || !id)) {
      throw new Error('Harness returned an invalid response for workspace.list');
    }
    for (const accountedId of workspace.sessionIds) {
      if (accountedId === sessionId) owners.push(workspace);
    }
  }

  if (owners.length > 1) {
    throw bindingError(
      'session-workspace-ambiguous',
      'The session is registered to more than one Harness workspace',
    );
  }
  if (owners.length && UNSAFE_WORKSPACE_PATH.test(owners[0].path)) {
    throw new Error('Harness returned an unsafe workspace path for the session');
  }
  return {
    workspace: owners[0],
    archived: value.archivedSessionIds.includes(sessionId),
  };
}

/**
 * @param {string} sessionId - the id the command asked for
 * @param {object} value - the `session.list` response
 * @param {boolean} knownToWorkspace - whether `workspace.list` already accounts for it
 */
function sessionSummary(sessionId, value, knownToWorkspace = false) {
  if (!Array.isArray(value?.items)
    || value.items.some((item) => typeof item?.sessionId !== 'string' || !item.sessionId)) {
    throw new Error('Harness returned an invalid response for session.list');
  }
  const matches = value.items.filter((item) => item.sessionId === sessionId);
  if (matches.length === 0) {
    // An id nobody ever registered is not a transient read failure: a workspace
    // that accounts for the session but has no summary yet may still appear, so
    // only the pair of answers means "no such session".
    if (!knownToWorkspace) {
      throw bindingError('session-not-registered', 'No session with this id is known to Harness');
    }
    throw bindingError('session-summary-unavailable', 'The session is no longer available from Harness');
  }
  if (matches.length !== 1) {
    throw new Error('Harness returned duplicate session summaries for session.list');
  }

  const [summary] = matches;
  if (summary.origin === 'subagent') {
    throw bindingError(
      'session-subagent-unsupported',
      'Subagent sessions cannot be adopted as a bot conversation',
    );
  }
  if (summary.origin !== undefined) {
    throw new Error('Harness returned an invalid session origin for session.list');
  }
  const title = summary.projections?.values?.title;
  if (title !== undefined && title !== null && typeof title !== 'string') {
    throw new Error('Harness returned an invalid session title for session.list');
  }
  return { cwd: summary.cwd, title: typeof title === 'string' ? title : null };
}

export async function adoptRegisteredWorkspaceSession(client, value, options = {}, timeoutMs = 30_000, method = 'session.create') {
  const sessionId = validatedSessionId(value);
  await client.ensureRunning(options);
  const workspaceList = await client.rpc('workspace.list', {}, timeoutMs, options);
  let { workspace, archived } = sessionWorkspace(sessionId, workspaceList);
  const summary = sessionSummary(
    sessionId,
    await client.rpc('session.list', {}, timeoutMs, options),
    workspace !== undefined || archived === true,
  );
  if (!workspace) {
    if (typeof summary.cwd !== 'string' || !isAbsolute(summary.cwd)
      || UNSAFE_WORKSPACE_PATH.test(summary.cwd)
      || !await client.isUngroupedWorkspace?.(summary.cwd)) {
      throw bindingError('session-not-registered', 'The session is not registered to a Harness workspace');
    }
    workspace = { path: summary.cwd };
  }
  if (await client.isUngroupedWorkspace?.(workspace.path)) {
    await mkdir(workspace.path, { recursive: true });
  }
  const adopted = await client.rpc(method, {
    ...(workspace.workspaceId ? { workspaceId: workspace.workspaceId } : { cwd: workspace.path }),
    sessionId,
  }, timeoutMs, options);
  if (!adopted || adopted.sessionId !== sessionId) {
    throw new Error(`Harness returned an invalid response for ${method}`);
  }
  return {
    sessionId,
    workspace: workspace.path,
    title: summary.title,
    archived,
  };
}
