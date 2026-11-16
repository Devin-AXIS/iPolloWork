import { randomUUID } from 'node:crypto';
import { conversationSessionWorkspace, workspacePathSnapshot } from '../shared/workspace-command.mjs';
import { t } from '../shared/i18n.mjs';

export const DINGTALK_MENU_TEMPLATE_ID = '9ca31362-e5b3-409c-a694-6993706a6004.schema';
export const DINGTALK_CARD_TOPIC = '/v1.0/card/instances/callback';
export const DINGTALK_MENU_BUTTONS = Object.freeze({
  new: '/new', history: '/history', stop: '/stop', compact: '/compact', clear: '/clear',
  status: '/status', help: '/help',
});

export function isDingtalkMenuCommand(text) {
  return typeof text === 'string' && /^\/(?:m|menu)$/iu.test(text.trim());
}

const presetCommand = (id) => `/preset ${/^\d+$/u.test(id) ? 'id:' : ''}${id}`;

// Keep exact commands alongside the displayed options. Never interpret a callback
// as a command supplied by the client or as a prompt for the model.
export async function dingtalkMenuSnapshot(harness, state, key, signal) {
  const workspace = harness.currentWorkspace?.();
  const currentSessionWorkspace = () => conversationSessionWorkspace(harness, key, { signal });
  const sessionWorkspace = await currentSessionWorkspace();
  const sessionId = state.sessionFor(key);
  const options = { signal };
  const results = await Promise.allSettled([
    workspacePathSnapshot(harness, options),
    harness.listWorkspaceSessions?.(sessionWorkspace, options),
    (async () => {
      const session = sessionId ? harness.workspaceSession?.(sessionId, key) : null;
      return typeof session?.models === 'function'
        ? session.models(options) : harness.listModels?.(options);
    })(),
    harness.agentPresetSettings?.(options),
  ]);
  signal?.throwIfAborted();
  if (harness.currentWorkspace?.() !== workspace
    || await currentSessionWorkspace() !== sessionWorkspace || state.sessionFor(key) !== sessionId) {
    throw new Error(t('会话或工作区已变化，请重新发送 /m。'));
  }
  const [paths, listed, catalog, settings] = results.map((r) => r.status === 'fulfilled' ? r.value : null);
  const selections = {
    session: [[t('新会话'), '/new'], ...(listed?.sessions ?? []).map((item) => [
      item.title || item.sessionId, `/session ${item.sessionId}`,
    ])],
    workspace: (paths?.paths ?? (workspace ? [workspace] : [])).map((path) => [path, `/workspace ${path}`]),
    preset: [[t('跟随 Host 默认'), '/preset --default'], ...(settings?.agentPresetCatalog?.items ?? []).map((item) => [
      item.label || item.id, presetCommand(item.id),
    ])],
    model: (catalog?.groups ?? []).flatMap((group) => group.models.map((model) => [
      `${model.name} (${group.id})`, `/model ${group.id}/${model.id}`,
    ])),
  };
  const current = {
    session: sessionId ? `/session ${sessionId}` : '/new',
    workspace: `/workspace ${workspace}`,
    preset: settings?.agentPreset ? presetCommand(settings.agentPreset) : '/preset --default',
    model: catalog?.current ? `/model ${catalog.current.provider}/${catalog.current.model}` : null,
  };
  const data = { revision: randomUUID(), notice: '' };
  for (const [name, entries] of Object.entries(selections)) {
    // Keep the active value visible even when the session listing is paginated.
    if (current[name] && !entries.some(([, command]) => command === current[name])) {
      entries.unshift([name === 'session' ? sessionId : current[name].replace(/^\/\w+\s+/u, ''), current[name]]);
    }
    data[`${name}_options`] = entries.map(([label], index) => ({
      value: String(index), text: { zh_CN: label, en_US: label },
    }));
    data[`${name}_index`] = entries.findIndex(([, command]) => command === current[name]);
  }
  return { workspace, sessionWorkspace, sessionId, selections, data };
}

export function dingtalkMenuCommand(entry, callback) {
  let content;
  try {
    content = typeof callback?.content === 'string' ? JSON.parse(callback.content) : callback?.content;
  } catch { return null; }
  const { actionIds, params } = content?.cardPrivateData ?? {};
  if (!Array.isArray(actionIds) || actionIds.length !== 1
    || params?.revision !== entry.data.revision) return null;
  const action = actionIds[0];
  if (Object.hasOwn(DINGTALK_MENU_BUTTONS, action)) return DINGTALK_MENU_BUTTONS[action];
  const entries = entry.selections[action];
  const index = params[action]?.index;
  if (!Array.isArray(entries) || !Number.isSafeInteger(index) || index < 0) return null;
  return entries[index]?.[1] ?? null;
}

export function dingtalkMenuCardData(data) {
  return { cardParamMap: Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key, typeof value === 'string' ? value : JSON.stringify(value),
  ])) };
}
