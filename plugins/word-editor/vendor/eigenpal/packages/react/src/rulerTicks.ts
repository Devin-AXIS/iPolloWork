// Display-only ruler geometry — re-exported from the engine.
//
// The logic is shared by both adapters (see engine-editor/src/ruler-ticks.ts);
// this shim keeps the React package's public API stable.

export {
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from '@docx-editor.dev/core/editor';
