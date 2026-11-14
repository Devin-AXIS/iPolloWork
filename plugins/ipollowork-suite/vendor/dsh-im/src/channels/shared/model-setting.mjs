const MAX_PROVIDER_ID_LENGTH = 256;
const MAX_MODEL_ID_LENGTH = 1_024;
const MAX_EFFORT_ID_LENGTH = 256;
const MAX_LABEL_LENGTH = 256;
const UNSAFE_DISPLAY_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const UNSAFE_ID_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function cleanId(value, maxLength) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  if (!id || id.length > maxLength || UNSAFE_ID_TEXT.test(id)) return '';
  return id;
}

function cleanLabel(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const label = value.replace(UNSAFE_DISPLAY_TEXT, ' ').replace(/\s+/gu, ' ').trim();
  return label ? label.slice(0, MAX_LABEL_LENGTH) : fallback;
}

export const EMPTY_MODEL_CATALOG = Object.freeze({
  groups: Object.freeze([]),
  failures: Object.freeze([]),
});

export function normalizeModelSelection(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const provider = cleanId(value.provider, MAX_PROVIDER_ID_LENGTH);
  const model = cleanId(value.model, MAX_MODEL_ID_LENGTH);
  const reasoningEffort = value.reasoningEffort === undefined
    ? undefined : cleanId(value.reasoningEffort, MAX_EFFORT_ID_LENGTH);
  if (!provider || !model || reasoningEffort === '') return null;
  return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
}

export function validateModelSelection(value) {
  if (value == null || value === '') return null;
  const selection = normalizeModelSelection(value);
  if (!selection) {
    const error = new Error('模型无效。');
    error.code = 'model-selection-invalid';
    throw error;
  }
  return selection;
}

export function sameModelSelection(left, right) {
  return left?.provider === right?.provider && left?.model === right?.model
    && left?.reasoningEffort === right?.reasoningEffort;
}

// Harness may resolve an omitted effort to the model's default.
export function confirmsModelSelection(actual, requested) {
  return actual?.provider === requested?.provider && actual?.model === requested?.model
    && (requested?.reasoningEffort === undefined
      || actual?.reasoningEffort === requested.reasoningEffort);
}

function normalizeReasoning(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.efforts)) return undefined;
  const efforts = [];
  const seen = new Set();
  for (const entry of value.efforts) {
    const id = cleanId(entry?.id, MAX_EFFORT_ID_LENGTH);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const description = cleanLabel(entry.description, '');
    efforts.push({ id, name: cleanLabel(entry.name, id), ...(description ? { description } : {}) });
  }
  if (!efforts.length) return undefined;
  const defaultEffort = cleanId(value.defaultEffort, MAX_EFFORT_ID_LENGTH);
  return { efforts, ...(seen.has(defaultEffort) ? { defaultEffort } : {}) };
}

export function modelSelectionId(value) {
  const selection = normalizeModelSelection(value);
  return selection ? `${selection.provider}/${selection.model}` : '';
}

export function normalizeModelCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { groups: [], failures: [] };
  }
  const groups = [];
  const seen = new Set();
  for (const candidate of Array.isArray(value.groups) ? value.groups : []) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const provider = cleanId(candidate.id, MAX_PROVIDER_ID_LENGTH);
    if (!provider) continue;
    const models = [];
    for (const entry of Array.isArray(candidate.models) ? candidate.models : []) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const model = cleanId(entry.id, MAX_MODEL_ID_LENGTH);
      if (!model) continue;
      const key = `${provider}\u0000${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const description = cleanLabel(entry.description, '');
      const reasoning = normalizeReasoning(entry.reasoning);
      models.push({
        id: model,
        name: cleanLabel(entry.name, model),
        ...(description ? { description } : {}),
        ...(reasoning ? { reasoning } : {}),
      });
    }
    if (models.length > 0) {
      groups.push({
        id: provider,
        name: cleanLabel(candidate.name, provider),
        models,
      });
    }
  }
  const failures = [];
  for (const candidate of Array.isArray(value.failures) ? value.failures : []) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const id = cleanId(candidate.id, MAX_PROVIDER_ID_LENGTH);
    if (!id) continue;
    failures.push({ id, name: cleanLabel(candidate.name, id) });
  }
  return { groups, failures };
}

export function modelCatalogEntry(catalog, selection) {
  const normalized = normalizeModelSelection(selection);
  if (!normalized) return undefined;
  return normalizeModelCatalog(catalog).groups
    .filter((group) => group.id === normalized.provider)
    .flatMap((group) => group.models).find((model) => model.id === normalized.model);
}

export function modelCatalogHas(catalog, selection) {
  return modelCatalogEntry(catalog, selection) !== undefined;
}

export async function listModelCatalog(harness, { throwOnError = false, ...options } = {}) {
  try {
    if (typeof harness?.listModels !== 'function') throw new Error('Harness model catalog is unavailable');
    return normalizeModelCatalog(await harness.listModels(options));
  } catch (error) {
    // Status reads may degrade; save validation must distinguish a failed read
    // from a successful catalog that no longer contains the selected model.
    if (throwOnError) throw error;
    return normalizeModelCatalog(null);
  }
}
