import { createRequire } from 'node:module';
import { connectionStageError, extractConnectionEvidence } from './connection-error.mjs';
import { normalizeDiagnosticDetails, safeDiagnosticMessage } from './diagnostic-details.mjs';

const require = createRequire(import.meta.url);
let installedDependencies;

function resolvedPackage(name, from) {
  try {
    const path = from.resolve(`${name}/package.json`);
    return { version: from(path)?.version, require: createRequire(path) };
  } catch {
    // Diagnostics must not replace the original encoding failure.
    return undefined;
  }
}

function dependencies() {
  if (!installedDependencies) {
    const qrcode = resolvedPackage('qrcode', require);
    // Resolve from qrcode so nested installations report the PNG library it uses.
    const pngjs = qrcode && resolvedPackage('pngjs', qrcode.require);
    installedDependencies = Object.freeze(normalizeDiagnosticDetails({ dependencies: {
      qrcode: qrcode?.version, pngjs: pngjs?.version, zlib: process.versions.zlib,
    } }).dependencies ?? {});
  }
  return installedDependencies;
}

/** Attach only safe facts: no QR contents, no stack traces.
 *  The deepest cause's message is included when it reads as plain technical
 *  text (see `safeDiagnosticMessage`); it is the only fact that separates
 *  `QRCode.toDataURL is not a function` from a zlib failure with the same shape. */
export function qrEncodingError(cause) {
  if (cause?.name === 'AbortError') return cause;
  const evidence = extractConnectionEvidence(cause);
  const leaf = evidence.chain.at(-1);
  const causeMessage = safeDiagnosticMessage(leaf?.message);
  return connectionStageError(new Error('QR encoding failed', { cause }), 'qr.encode', undefined, {
    qrEncoder: 'qrcode', qrRenderer: 'png',
    errorTypes: evidence.errors.map(error => error.type),
    ...(causeMessage ? { causeMessage } : {}),
    dependencies: dependencies(),
  });
}
