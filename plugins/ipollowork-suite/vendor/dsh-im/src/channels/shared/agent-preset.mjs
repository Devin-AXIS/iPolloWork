import { t } from './i18n.mjs';

/** Matches DeepSeek Harness agent-preset directory ids. */
export const AGENT_PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

export const EMPTY_AGENT_PRESET_CATALOG = Object.freeze({
  defaultId: '',
  items: Object.freeze([]),
});

export function normalizeAgentPresetId(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return AGENT_PRESET_ID.test(id) ? id : null;
}

export function validateAgentPresetId(value) {
  if (value == null || value === '') return null;
  const id = normalizeAgentPresetId(value);
  if (!id) {
    const error = new Error(t('Agent Preset 无效。'));
    error.code = 'agent-preset-invalid';
    throw error;
  }
  return id;
}

function catalogItem(value) {
  if (typeof value === 'string') {
    const id = normalizeAgentPresetId(value);
    return id ? { id, label: id } : null;
  }
  if (!value || typeof value !== 'object') return null;
  if (value.broken !== undefined) return null;
  const id = normalizeAgentPresetId(value.id);
  if (!id) return null;
  const label = typeof value.name === 'string' && value.name.trim()
    ? value.name.trim().slice(0, 128)
    : typeof value.label === 'string' && value.label.trim()
      ? value.label.trim().slice(0, 128)
      : id;
  return { id, label };
}

export function normalizeAgentPresetCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { defaultId: '', items: [] };
  }
  const items = [];
  const seen = new Set();
  for (const entry of Array.isArray(value.items) ? value.items : []) {
    const item = catalogItem(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return {
    defaultId: normalizeAgentPresetId(value.defaultId) ?? '',
    items,
  };
}

export async function listAgentPresetCatalog(ctx) {
  try {
    const service = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : ctx?.agentPresets;
    if (!service || typeof service.list !== 'function') return { defaultId: '', items: [] };
    const listed = await service.list();
    const suite = typeof ctx?.get === 'function' ? ctx.get('ipolloAgents') : ctx?.ipolloAgents;
    if (suite?.coordinatorPreset) {
      return normalizeAgentPresetCatalog({ defaultId: suite.coordinatorPreset, items: listed.filter(item => item.id === suite.coordinatorPreset) });
    }
    return normalizeAgentPresetCatalog({
      defaultId: typeof service.defaultId === 'string' ? service.defaultId : '',
      items: Array.isArray(listed) ? listed : [],
    });
  } catch {
    return { defaultId: '', items: [] };
  }
}
