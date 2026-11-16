export const FEISHU_STEP_PUSH_MODES = Object.freeze({
  POST: 'post',
  STREAMING_CARD: 'streaming_card',
  LIVE_COT: 'live_cot',
});

/** New connections explicitly opt into the process-card presentation. */
export const DEFAULT_FEISHU_STEP_PUSH_MODE = FEISHU_STEP_PUSH_MODES.STREAMING_CARD;

export const DEFAULT_FEISHU_STEP_CARD_PANELS = Object.freeze({
  thinkingExpanded: false,
  toolsExpanded: true,
});

export function normalizeFeishuStepCardPanels(value) {
  return Object.freeze({
    thinkingExpanded: typeof value?.thinkingExpanded === 'boolean'
      ? value.thinkingExpanded : DEFAULT_FEISHU_STEP_CARD_PANELS.thinkingExpanded,
    toolsExpanded: typeof value?.toolsExpanded === 'boolean'
      ? value.toolsExpanded : DEFAULT_FEISHU_STEP_CARD_PANELS.toolsExpanded,
  });
}

export function isFeishuStepCardPanels(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => key === 'thinkingExpanded' || key === 'toolsExpanded')
    && typeof value.thinkingExpanded === 'boolean'
    && typeof value.toolsExpanded === 'boolean';
}

export function normalizeFeishuStepPushMode(value) {
  // Bots created before modes existed used posts when step push was enabled.
  if (value === FEISHU_STEP_PUSH_MODES.STREAMING_CARD) {
    return FEISHU_STEP_PUSH_MODES.STREAMING_CARD;
  }
  if (value === FEISHU_STEP_PUSH_MODES.LIVE_COT) {
    return FEISHU_STEP_PUSH_MODES.LIVE_COT;
  }
  return FEISHU_STEP_PUSH_MODES.POST;
}

export function isFeishuStepPushMode(value) {
  return value === FEISHU_STEP_PUSH_MODES.POST
    || value === FEISHU_STEP_PUSH_MODES.STREAMING_CARD
    || value === FEISHU_STEP_PUSH_MODES.LIVE_COT;
}
