export const DELIVERY_RECEIPT_SCHEMA_VERSION = 1;

const ARTIFACT_OUTCOMES = new Set(['sent', 'rejected', 'failed', 'unknown']);
const DELIVERY_OUTCOMES = new Set(['sent', 'failed', 'unknown']);
const TEXT_FORMATS = new Set(['plain', 'markdown']);
const REJECTED_ARTIFACT_ERRORS = new Set([
  'artifact-changed',
  'artifact-context-required',
  'artifact-empty',
  'artifact-invalid',
  'artifact-not-file',
  'artifact-permission-required',
  'artifact-provider-rejected',
  'artifact-too-large',
  'artifact-unavailable',
]);

export function providerMessageIdsFor(value) {
  if (!value || typeof value !== 'object') return [];
  const ids = Array.isArray(value.providerMessageIds)
    ? value.providerMessageIds
      .filter((candidate) => (
        (typeof candidate === 'string' && candidate.trim())
          || Number.isSafeInteger(candidate)
      ))
      .map(String)
    : [];
  const candidates = [
    value.message_id,
    value.messageId,
    value.id,
    value.ts,
    value.message?.message_id,
    value.message?.messageId,
    value.message?.id,
    value.message?.ts,
    value.key?.id,
    value.data?.message_id,
    value.body?.msgid,
    value.body?.message_id,
  ];
  const id = candidates.find((candidate) => (
    (typeof candidate === 'string' && candidate.trim())
      || Number.isSafeInteger(candidate)
  ));
  if (id !== undefined) ids.push(String(id));
  return [...new Set(ids)];
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

export function createTextDeliveryBlock(value, format = 'plain') {
  const block = typeof value === 'string'
    ? { kind: 'text', text: value, format }
    : value;
  if (!block || typeof block !== 'object' || Array.isArray(block)
    || block.kind !== 'text' || typeof block.text !== 'string' || !block.text.trim()) {
    throw new TypeError('text delivery block must contain non-empty text');
  }
  if (!TEXT_FORMATS.has(block.format)) {
    throw new TypeError('text delivery format must be plain or markdown');
  }
  return Object.freeze({
    kind: 'text',
    text: block.text,
    format: block.format,
  });
}

function providerIds(values) {
  if (!Array.isArray(values)) throw new TypeError('providerMessageIds must be an array');
  const ids = [];
  const seen = new Set();
  for (const value of values) {
    const id = requiredString(value, 'providerMessageId');
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return Object.freeze(ids);
}

function artifactResults(values) {
  if (!Array.isArray(values)) throw new TypeError('artifacts must be an array');
  return Object.freeze(values.map((value) => {
    if (!value || typeof value !== 'object') {
      throw new TypeError('artifact result must be an object');
    }
    const artifactId = requiredString(value.artifactId, 'artifactId');
    if (!ARTIFACT_OUTCOMES.has(value.outcome)) {
      throw new TypeError('artifact outcome must be sent, rejected, failed, or unknown');
    }
    const reason = value.reason === undefined
      ? undefined
      : requiredString(value.reason, 'artifact reason');
    return Object.freeze({
      artifactId,
      outcome: value.outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  }));
}

export function artifactOutcomeForError(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (code === 'artifact-delivery-uncertain') return 'unknown';
  if (REJECTED_ARTIFACT_ERRORS.has(code)) return 'rejected';
  return 'failed';
}

export function createDeliveryReceipt({
  deliveryId,
  presentation,
  providerMessageIds = [],
  artifacts = [],
  deliveryOutcome,
  reason,
}) {
  if (deliveryOutcome !== undefined && !DELIVERY_OUTCOMES.has(deliveryOutcome)) {
    throw new TypeError('deliveryOutcome must be sent, failed, or unknown');
  }
  const normalizedReason = reason === undefined
    ? undefined
    : requiredString(reason, 'delivery reason');
  return Object.freeze({
    schemaVersion: DELIVERY_RECEIPT_SCHEMA_VERSION,
    deliveryId: requiredString(deliveryId, 'deliveryId'),
    presentation: requiredString(presentation, 'presentation'),
    providerMessageIds: providerIds(providerMessageIds),
    ...(deliveryOutcome === undefined ? {} : { deliveryOutcome }),
    ...(normalizedReason === undefined ? {} : { reason: normalizedReason }),
    artifacts: artifactResults(artifacts),
  });
}

export function createArtifactFailureReceipt({
  artifactId,
  deliveryId,
  error,
  presentation = 'text-fallback',
  providerMessageIds = [],
}) {
  const code = typeof error === 'string' ? error : error?.code;
  const reason = typeof code === 'string' && code
    ? code
    : 'artifact-provider-failed';
  return createDeliveryReceipt({
    deliveryId,
    presentation,
    providerMessageIds,
    artifacts: [{
      artifactId,
      outcome: artifactOutcomeForError(error),
      reason,
    }],
  });
}

export function mergeDeliveryReceipts({ deliveryId, presentation, receipts }) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    throw new TypeError('receipts must contain at least one delivery receipt');
  }
  const messageIds = [];
  const artifacts = new Map();
  let deliveryOutcome;
  let reason;
  for (const receipt of receipts) {
    if (!receipt || receipt.schemaVersion !== DELIVERY_RECEIPT_SCHEMA_VERSION) {
      throw new TypeError('receipt must use DeliveryReceipt schema version 1');
    }
    messageIds.push(...(receipt.providerMessageIds ?? []));
    if (deliveryOutcome === undefined && receipt.deliveryOutcome !== undefined) {
      deliveryOutcome = receipt.deliveryOutcome;
      reason = receipt.reason;
    }
    for (const artifact of receipt.artifacts ?? []) {
      artifacts.set(artifact.artifactId, artifact);
    }
  }
  return createDeliveryReceipt({
    deliveryId,
    presentation,
    providerMessageIds: messageIds,
    deliveryOutcome,
    reason,
    artifacts: [...artifacts.values()],
  });
}
