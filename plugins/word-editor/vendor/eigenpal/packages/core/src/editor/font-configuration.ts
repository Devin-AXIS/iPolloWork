import {
  EditorFontError,
  type EditorFontErrorCode,
  type FontConfiguration,
  type FontFaceRequest,
} from '@docx-editor.dev/core/contracts/editor';
import {
  FontResolutionError,
  HarfBuzzShapingError,
  LayoutShapingConfigurationError,
  createLayoutShaping as createNeutralLayoutShaping,
  disposeLayoutShaping,
  type LayoutShapingInstrumentation,
  type LayoutShapingOptions,
  type FontShapingOptions,
} from '@docx-editor.dev/core/layout';

import { fontShapingPolicy } from '../layout/font-shaping-policy.ts';

export type { LayoutShapingInstrumentation };

/** Freeze the host execution selection before document or font loading can yield. @internal */
export function sampleFontShapingOptions(
  options: FontShapingOptions | undefined
): FontShapingOptions | undefined {
  return options === undefined
    ? undefined
    : Object.freeze({ maxFontBytes: fontShapingPolicy(options).maxFontBytes });
}

function publicRequest(request: FontFaceRequest): FontFaceRequest {
  return Object.freeze({ family: request.family, weight: request.weight, style: request.style });
}

let warnedFontFailure = false;

export function warnFontFailureOnce(error: { readonly diagnostic?: string }): void {
  if (warnedFontFailure) return;
  warnedFontFailure = true;
  const detail = error.diagnostic ? `: ${error.diagnostic}` : '.';
  console.error(
    `[@docx-editor.dev/core] text shaping is disabled${detail}\n` +
      'Text is being measured with fallback metrics, so line and page breaks will not match Word.'
  );
}

export function resetFontFailureWarningForTests(): void {
  warnedFontFailure = false;
}

export function toEditorFontError(error: unknown): EditorFontError {
  if (error instanceof EditorFontError) return error;
  if (error instanceof FontResolutionError) {
    return new EditorFontError(error.code as EditorFontErrorCode, error.message, {
      request: publicRequest(error.request),
      diagnostic: error.diagnostic,
    });
  }
  if (error instanceof LayoutShapingConfigurationError) {
    return new EditorFontError('overLimit', error.message, { diagnostic: error.message });
  }
  if (error instanceof HarfBuzzShapingError) {
    const code: EditorFontErrorCode =
      error.code === 'wasmUnavailable' || error.code === 'shapingLibraryMismatch'
        ? 'wasmUnavailable'
        : 'initializationFailed';
    return new EditorFontError(code, error.message, {
      diagnostic: error.diagnostic ?? error.message,
      cause: error,
    });
  }
  return new EditorFontError(
    'initializationFailed',
    error instanceof Error ? error.message : 'Font initialization failed',
    { diagnostic: error instanceof Error ? error.message : String(error), cause: error }
  );
}

export async function createLayoutShaping(
  configuration: FontConfiguration,
  instrumentation?: LayoutShapingInstrumentation,
  execution?: FontShapingOptions
): Promise<LayoutShapingOptions> {
  try {
    return await createNeutralLayoutShaping(configuration, instrumentation, execution);
  } catch (error) {
    throw toEditorFontError(error);
  }
}

export { disposeLayoutShaping };
