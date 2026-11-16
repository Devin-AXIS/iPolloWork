import { createTextBridgeStatus, TextHarnessBridge } from '../shared/text-harness-bridge.mjs';

export const MATRIX_DESCRIPTOR = Object.freeze({
  key: 'matrix',
  label: 'Matrix',
  connectionLabel: ' CS API 长轮询',
  reactions: Object.freeze({
    processing: '👀',
    success: '✔',
    error: '✕',
  }),
});

export class MatrixHarnessBridge extends TextHarnessBridge {
  constructor(options) {
    super({ descriptor: MATRIX_DESCRIPTOR, ...options });
  }
}

export { createTextBridgeStatus as createMatrixBridgeStatus };
