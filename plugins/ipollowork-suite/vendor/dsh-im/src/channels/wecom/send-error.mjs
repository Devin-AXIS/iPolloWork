import { channelDeliveryFailure } from '../shared/message-failure.mjs';

// Normalize only errors from SDK send calls, never Harness or menu-building errors.
export function wecomSendError(error, operation) {
  if (error?.wecomOperation || error?.name === 'AbortError'
    || error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) return error;
  const value = error?.errcode ?? error?.body?.errcode ?? error?.providerCode;
  const providerCode = typeof value === 'number'
    || (typeof value === 'string' && /^-?\d+$/u.test(value)) ? Number(value) : NaN;
  const rejected = Number.isSafeInteger(providerCode) && providerCode !== 0;
  const disconnected = error?.message === 'WebSocket not connected, unable to send data';
  const wrapped = channelDeliveryFailure(error, { uncertain: !rejected && !disconnected });
  // Keep the same provider mappings as wecomArtifactError.
  if (providerCode === 48002) wrapped.code = 'channel-permission';
  if (providerCode === 45009) wrapped.code = 'channel-rate-limit';
  if (rejected) wrapped.providerCode = providerCode;
  wrapped.wecomOperation = operation;
  wrapped.message = `Enterprise WeChat ${operation} failed (${wrapped.code}, provider=${wrapped.providerCode ?? '-'})`;
  return wrapped;
}

// The SDK rejection frame can contain private payloads. Log only diagnostic fields.
export function wecomSendDiagnostic(error) {
  if (!error?.wecomOperation) return undefined;
  return {
    operation: error.wecomOperation,
    code: error.code,
    providerCode: error.providerCode,
    status: error.status,
  };
}
