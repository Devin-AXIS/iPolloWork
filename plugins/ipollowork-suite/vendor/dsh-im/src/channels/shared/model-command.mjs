import { isSessionNotFound } from './session-error.mjs';
import { splitWorkspaceCommandMessage } from './workspace-command.mjs';
import { t } from './i18n.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';
import { withSessionBindingLock } from './session-binding-lock.mjs';

const MODEL_COMMAND = /^\/model(?=$|\s)/i;
const MODELS_COMMAND = /^\/models(?=$|\s)/i;
const REASONING_COMMAND = /^\/reasoning(?=$|\s)/i;
const REASONINGS_COMMAND = /^\/reasonings(?=$|\s)/i;
const REASONING_LIST_COMMAND = /^\/reasoninglist(?=$|\s)/i;
const MODEL_USAGE = '用法：/model <序号或 provider/model> [推理等级ID]';
const MODELS_USAGE = '用法：/models（不带参数）';
const REASONING_USAGE = '用法：/reasoning [序号、等级ID或 --default]';
const REASONING_LIST_USAGE = '用法：/reasoninglist 或 /reasonings（不带参数）';
const SESSION_BINDING_CHANGED = 'session-binding-changed';
const MODEL_SELECTION_MISMATCH = 'model-selection-mismatch';
const UNSAFE_DISPLAY_TEXT_GLOBAL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;

function commandResult(message) {
  return {
    handled: true,
    message,
    messages: splitWorkspaceCommandMessage(message),
  };
}

function safeDisplayText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(UNSAFE_DISPLAY_TEXT_GLOBAL, ' ').replace(/\s+/gu, ' ').trim();
}

function rpcOptions(signal) {
  return signal ? { signal } : {};
}

function normalizeReasoning(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object'
    || !Array.isArray(value.efforts) || value.efforts.length === 0) {
    throw new TypeError('Harness returned invalid model reasoning metadata');
  }
  const efforts = value.efforts.map((effort) => {
    if (!effort || typeof effort !== 'object'
      || typeof effort.id !== 'string' || !effort.id
      || typeof effort.name !== 'string' || !effort.name
      || (effort.description !== undefined && typeof effort.description !== 'string')) {
      throw new TypeError('Harness returned an invalid reasoning effort');
    }
    return {
      id: effort.id,
      name: effort.name,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    };
  });
  if (value.defaultEffort !== undefined
    && (typeof value.defaultEffort !== 'string' || !value.defaultEffort)) {
    throw new TypeError('Harness returned an invalid default reasoning effort');
  }
  return {
    efforts,
    ...(value.defaultEffort === undefined ? {} : { defaultEffort: value.defaultEffort }),
  };
}

function normalizeCatalog(value, { requireCurrent = false } = {}) {
  if (!value || typeof value !== 'object'
    || !Array.isArray(value.groups) || !Array.isArray(value.failures)) {
    throw new TypeError('Harness returned an invalid model catalog');
  }
  const groups = value.groups.map((group) => {
    if (!group || typeof group !== 'object'
      || typeof group.id !== 'string' || !group.id
      || typeof group.name !== 'string' || !group.name
      || !Array.isArray(group.models)) {
      throw new TypeError('Harness returned an invalid model provider group');
    }
    return {
      id: group.id,
      name: group.name,
      models: group.models.map((model) => {
        if (!model || typeof model !== 'object'
          || typeof model.id !== 'string' || !model.id
          || typeof model.name !== 'string' || !model.name
          || (model.description !== undefined && typeof model.description !== 'string')) {
          throw new TypeError('Harness returned an invalid model');
        }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(model.reasoning === undefined
            ? {}
            : { reasoning: normalizeReasoning(model.reasoning) }),
        };
      }),
    };
  });
  const failures = value.failures.map((failure) => {
    if (!failure || typeof failure !== 'object'
      || typeof failure.id !== 'string' || !failure.id
      || typeof failure.name !== 'string' || !failure.name) {
      throw new TypeError('Harness returned an invalid model provider failure');
    }
    return { id: failure.id, name: failure.name };
  });
  let current = null;
  if (value.current !== undefined) {
    if (!value.current || typeof value.current !== 'object'
      || typeof value.current.provider !== 'string' || !value.current.provider
      || typeof value.current.model !== 'string' || !value.current.model
      || (value.current.reasoningEffort !== undefined
        && (typeof value.current.reasoningEffort !== 'string'
          || !value.current.reasoningEffort))) {
      throw new TypeError('Harness returned an invalid current model');
    }
    current = {
      provider: value.current.provider,
      model: value.current.model,
      ...(value.current.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: value.current.reasoningEffort }),
    };
  } else if (requireCurrent) {
    throw new TypeError('Harness returned no current model');
  }
  return { groups, failures, current };
}

function modelId(provider, model) {
  return `${provider}/${model}`;
}

function sameModel(left, right) {
  return left?.provider === right?.provider && left?.model === right?.model;
}

function sameSelection(left, right) {
  return sameModel(left, right) && left?.reasoningEffort === right?.reasoningEffort;
}

function confirmsSelection(actual, requested) {
  return sameModel(actual, requested)
    && (requested.reasoningEffort === undefined
      || actual?.reasoningEffort === requested.reasoningEffort);
}

function selectionText(selection) {
  if (!selection?.provider || !selection?.model) return '';
  const id = modelId(selection.provider, selection.model);
  return selection.reasoningEffort === undefined
    ? id
    : `${id} · reasoningEffort=${safeDisplayText(selection.reasoningEffort)}`;
}

function selectionMismatch(expected, actual, source) {
  const error = new Error(`Harness ${source} did not confirm the selected model`);
  error.code = MODEL_SELECTION_MISMATCH;
  error.expected = expected;
  error.actual = actual;
  error.source = source;
  return error;
}

function sessionBindingChanged() {
  const error = new Error('Conversation binding changed during model selection');
  error.code = SESSION_BINDING_CHANGED;
  return error;
}

function assertSessionBinding(state, key, expectedSessionId) {
  const currentSessionId = typeof state?.sessionFor === 'function'
    ? state.sessionFor(key)
    : null;
  if (currentSessionId !== expectedSessionId) throw sessionBindingChanged();
}

function matchingModel(catalog, requested) {
  for (const group of catalog.groups) {
    for (const model of group.models) {
      if (modelId(group.id, model.id) === requested) {
        return { provider: group.id, model: model.id };
      }
    }
  }
  return null;
}

function modelAt(catalog, requestedIndex) {
  let index = 0;
  for (const group of catalog.groups) {
    for (const model of group.models) {
      index += 1;
      if (index === requestedIndex) {
        return { provider: group.id, model: model.id };
      }
    }
  }
  return null;
}

function positiveNumberRequest(requested) {
  if (!/^\d+$/u.test(requested)) return null;
  const index = Number(requested);
  return { index: Number.isSafeInteger(index) && index > 0 ? index : null };
}

function modelForSelection(catalog, selection) {
  if (!selection) return null;
  const group = catalog.groups.find(({ id }) => id === selection.provider);
  return group?.models.find(({ id }) => id === selection.model) ?? null;
}

function reasoningEffortAt(model, requestedIndex) {
  return model?.reasoning?.efforts?.[requestedIndex - 1] ?? null;
}

function reasoningEffortById(model, requestedId) {
  return model?.reasoning?.efforts?.find(({ id }) => id === requestedId) ?? null;
}

function effectiveReasoningEffort(current, model) {
  return current?.reasoningEffort ?? model?.reasoning?.defaultEffort;
}

function reasoningEffortText(model, effortId) {
  if (effortId === undefined) return t('Default（由模型或 Provider 决定）');
  const effort = reasoningEffortById(model, effortId);
  if (!effort) return safeDisplayText(effortId);
  const name = safeDisplayText(effort.name);
  const id = safeDisplayText(effort.id);
  return name === id ? id : `${name} (${id})`;
}

function currentReasoningEffortText(catalog) {
  const model = modelForSelection(catalog, catalog.current);
  return reasoningEffortText(
    model,
    effectiveReasoningEffort(catalog.current, model),
  );
}

function reasoningMarker(effortId, currentId, defaultId) {
  if (effortId === currentId && effortId === defaultId) return t('（当前、默认）');
  if (effortId === currentId) return t('（当前）');
  if (effortId === defaultId) return t('（默认）');
  return '';
}

function invalidModelNumberMessage(requested) {
  return [
    t('模型序号无效：{input}', { input: safeDisplayText(requested) }),
    '',
    t('请发送 /models 查看并输入有效的正整数序号。'),
  ].join('\n');
}

function invalidReasoningNumberMessage(requested) {
  return [
    t('推理等级序号无效：{input}', { input: safeDisplayText(requested) }),
    '',
    t('请发送 /reasoninglist 查看并输入有效的正整数序号。'),
  ].join('\n');
}

function unsupportedReasoningMessage(selection, requested, model) {
  const lines = [
    t('模型不支持推理等级：{effort}', { effort: safeDisplayText(requested) }),
    '',
    safeDisplayText(selectionText(selection)),
  ];
  const ids = model?.reasoning?.efforts?.map(({ id }) => safeDisplayText(id)) ?? [];
  if (ids.length > 0) {
    lines.push(t('可用推理等级：{efforts}', { efforts: ids.join(', ') }));
  } else {
    lines.push(t('该模型不提供可切换的推理等级。'));
  }
  return lines.join('\n');
}

function formatCatalog(catalog) {
  const currentId = catalog.current
    ? modelId(catalog.current.provider, catalog.current.model)
    : null;
  const lines = [t('可用模型：')];
  let index = 0;
  if (catalog.groups.length === 0) lines.push('', t('当前没有可用模型。'));
  for (const group of catalog.groups) {
    lines.push('', safeDisplayText(group.name) || safeDisplayText(group.id));
    for (const model of group.models) {
      index += 1;
      const id = modelId(group.id, model.id);
      lines.push(`${index}. ${safeDisplayText(id)}${id === currentId ? t('（当前）') : ''}`);
    }
  }
  if (catalog.failures.length > 0) {
    lines.push('', t('以下模型提供方暂时不可用：'));
    for (const failure of catalog.failures) {
      lines.push(`- ${safeDisplayText(failure.name) || safeDisplayText(failure.id)}`);
    }
  }
  if (index > 0) lines.push('', t('切换模型：/model <序号> [推理等级ID]'));
  return lines.join('\n');
}

function currentModelMessage(catalog) {
  return [
    t('当前模型：'),
    modelId(catalog.current.provider, catalog.current.model),
    t('当前推理等级：{effort}', { effort: currentReasoningEffortText(catalog) }),
    '',
    t('查看全部模型：/models'),
    t('查看可用推理等级：/reasoninglist'),
    t('切换模型：/model <序号> [推理等级ID]'),
  ].join('\n');
}

function currentReasoningMessage(catalog) {
  return [
    t('当前模型：'),
    modelId(catalog.current.provider, catalog.current.model),
    t('当前推理等级：{effort}', { effort: currentReasoningEffortText(catalog) }),
    '',
    t('查看可用推理等级：/reasoninglist'),
    t('切换推理等级：/reasoning <序号或等级ID>'),
    t('恢复默认等级：/reasoning --default'),
  ].join('\n');
}

function formatReasoningCatalog(catalog) {
  const current = catalog.current;
  const model = modelForSelection(catalog, current);
  const currentEffort = effectiveReasoningEffort(current, model);
  const lines = [
    t('当前模型：'),
    modelId(current.provider, current.model),
    t('当前推理等级：{effort}', { effort: reasoningEffortText(model, currentEffort) }),
    '',
    t('可用推理等级：'),
  ];
  if (!model?.reasoning) {
    lines.push(
      t('该模型不提供可切换的推理等级。'),
      '',
      t('恢复默认等级：/reasoning --default'),
    );
    return lines.join('\n');
  }
  for (const [index, effort] of model.reasoning.efforts.entries()) {
    const label = reasoningEffortText(model, effort.id);
    const marker = reasoningMarker(
      effort.id,
      currentEffort,
      model.reasoning.defaultEffort,
    );
    lines.push(`${index + 1}. ${label}${marker}`);
    const description = safeDisplayText(effort.description);
    if (description) lines.push(`   ${description}`);
  }
  lines.push(
    '',
    t('切换推理等级：/reasoning <序号或等级ID>'),
    t('恢复默认等级：/reasoning --default'),
  );
  return lines.join('\n');
}

function noSessionMessage() {
  return [
    t('当前聊天还没有会话。'),
    '',
    t('查看模型：/models'),
    t('选择模型：/model <序号>'),
  ].join('\n');
}

function noReasoningSessionMessage() {
  return [
    t('当前聊天还没有会话。'),
    '',
    t('请先发送一条普通消息创建会话。'),
  ].join('\n');
}

function errorCode(error) {
  return error?.code ?? error?.failure?.code;
}

function modelErrorMessage(error, action) {
  const code = errorCode(error);
  if (code === 'agent-busy') {
    return t('当前任务正在运行，请等待完成或先发送 /stop。');
  }
  if (isSessionNotFound(code)) {
    return t('当前聊天绑定的会话已不存在，请重试。');
  }
  if (code === 'model-unavailable' || code === 'session/model-unavailable') {
    if (action === 'reasoning-select') {
      return t('无法切换推理等级。当前模型或推理等级不可用。');
    }
    return t('无法切换到该模型。模型当前不可用，或不支持当前会话中的图片。');
  }
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found') {
    return t('工作区或机器人状态已发生变化，请重试。');
  }
  if (code === SESSION_BINDING_CHANGED) {
    return t('当前聊天绑定的会话已发生变化，请重试。');
  }
  if (code === MODEL_SELECTION_MISMATCH) {
    const expected = error?.expected;
    const actual = error?.actual;
    const lines = [action === 'reasoning-select'
      ? t('推理等级切换失败，请稍后重试。')
      : t('模型切换失败，请稍后重试。')];
    if (expected?.provider && expected?.model) {
      lines.push('', `requested: ${safeDisplayText(selectionText(expected))}`);
    }
    if (actual?.provider && actual?.model) {
      const label = error?.source === 'models.current'
        ? t('当前模型：')
        : 'selectModel.selected:';
      lines.push(`${label} ${safeDisplayText(selectionText(actual))}`);
    } else {
      lines.push(`${error?.source ?? 'Harness'}: unconfirmed`);
    }
    return lines.join('\n');
  }
  if (code === 'cancelled' || error?.name === 'AbortError') {
    if (action === 'list') return t('获取模型列表已取消。');
    if (action === 'reasoning-list') return t('获取推理等级列表已取消。');
    if (action === 'reasoning-select') return t('推理等级切换已取消。');
    return t('模型切换已取消。');
  }
  if (action === 'list') return t('暂时无法获取模型列表，请稍后重试。');
  if (action === 'reasoning-list') return t('暂时无法获取推理等级，请稍后重试。');
  if (action === 'reasoning-select') return t('推理等级切换失败，请稍后重试。');
  return t('模型切换失败，请稍后重试。');
}

async function boundSession(harness, state, key, options) {
  if (typeof state?.sessionFor !== 'function') return null;
  // A DS Bot binding may exist before this IM chat has received a message.
  // Resolve its current part rather than creating an unrelated IM session.
  if (typeof harness?.resolveDsBotSession === 'function') {
    await harness.resolveDsBotSession(key);
  }
  const sessionId = state.sessionFor(key);
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (typeof harness?.workspaceSession !== 'function') {
    throw new TypeError('Harness does not support workspace sessions');
  }
  const session = harness.workspaceSession(sessionId, key);
  if (!session || typeof session.sessionExists !== 'function') {
    throw new TypeError('Harness returned an invalid workspace session');
  }
  if (await session.sessionExists(options)) return { sessionId, session };
  if (typeof state.clearSession === 'function' && state.sessionFor(key) === sessionId) {
    await state.clearSession(key);
  }
  return null;
}

async function sessionIsBusy(session, control, options) {
  if (typeof session?.isRunning !== 'function'
    || typeof session?.hasActiveTurn !== 'function') {
    throw new TypeError('Harness session does not expose run state');
  }
  if (await session.isRunning(options)) return true;
  return Boolean(await session.hasActiveTurn(control, options));
}

async function listCatalog(harness, options) {
  if (typeof harness?.listModels !== 'function') {
    throw new TypeError('Harness does not support listing models');
  }
  return normalizeCatalog(await harness.listModels(options));
}

async function sessionCatalog(session, options) {
  if (typeof session?.models !== 'function') {
    throw new TypeError('Harness session does not support listing models');
  }
  return normalizeCatalog(await session.models(options), { requireCurrent: true });
}

async function selectAndVerifyModel(session, selection, options) {
  if (typeof session?.selectModel !== 'function') {
    throw new TypeError('Harness session does not support model selection');
  }
  const selected = (await session.selectModel(selection, options))?.selected;
  if (!confirmsSelection(selected, selection)) {
    throw selectionMismatch(selection, selected, 'selectModel.selected');
  }
  const current = (await sessionCatalog(session, options)).current;
  if (!sameSelection(current, selected)) {
    throw selectionMismatch(selected, current, 'models.current');
  }
  return current;
}

function isModelsCommand(command) {
  return MODELS_COMMAND.test(command);
}

function isReasoningListCommand(command) {
  return REASONING_LIST_COMMAND.test(command) || REASONINGS_COMMAND.test(command);
}

function isReasoningCommand(command) {
  return REASONING_COMMAND.test(command);
}

export function isModelCommand(text) {
  if (typeof text !== 'string') return false;
  const command = text.trim();
  return MODELS_COMMAND.test(command)
    || MODEL_COMMAND.test(command)
    || REASONING_LIST_COMMAND.test(command)
    || REASONINGS_COMMAND.test(command)
    || REASONING_COMMAND.test(command);
}

export async function runModelCommand(text, harness, state, key, options = {}) {
  if (!isModelCommand(text)) return null;
  const command = text.trim();
  if (options.hasImages) {
    return commandResult(t('模型和推理等级命令仅支持纯文字，请移除图片后重试。'));
  }
  const requestOptions = rpcOptions(options.signal);

  if (isModelsCommand(command)) {
    if (!/^\/models[ \t]*$/iu.test(command)) return commandResult(t(MODELS_USAGE));
    try {
      const bound = await boundSession(harness, state, key, requestOptions);
      const catalog = bound
        ? await sessionCatalog(bound.session, requestOptions)
        : await listCatalog(harness, requestOptions);
      return commandResult(formatCatalog(catalog));
    } catch (error) {
      return commandResult(modelErrorMessage(error, 'list'));
    }
  }

  if (isReasoningListCommand(command)) {
    if (!/^\/(?:reasoninglist|reasonings)[ \t]*$/iu.test(command)) {
      return commandResult(t(REASONING_LIST_USAGE));
    }
    try {
      const bound = await boundSession(harness, state, key, requestOptions);
      if (!bound) return commandResult(noReasoningSessionMessage());
      return commandResult(formatReasoningCatalog(
        await sessionCatalog(bound.session, requestOptions),
      ));
    } catch (error) {
      return commandResult(modelErrorMessage(error, 'reasoning-list'));
    }
  }

  if (isReasoningCommand(command)) {
    const match = /^\/reasoning(?:[ \t]+([^\s]+))?[ \t]*$/iu.exec(command);
    if (!match) return commandResult(t(REASONING_USAGE));
    const requested = match[1];
    if (!requested) {
      try {
        const bound = await boundSession(harness, state, key, requestOptions);
        if (!bound) return commandResult(noReasoningSessionMessage());
        return commandResult(currentReasoningMessage(
          await sessionCatalog(bound.session, requestOptions),
        ));
      } catch (error) {
        return commandResult(modelErrorMessage(error, 'reasoning-list'));
      }
    }
    if (options.pendingInteraction) {
      return commandResult([
        t('当前任务正在等待你的回答或审批。'),
        '',
        t('请先处理当前请求，或者发送 /stop 停止任务。'),
      ].join('\n'));
    }
    try {
      return await withSessionBindingLock(state, key, async () => {
        const bound = await boundSession(harness, state, key, requestOptions);
        if (!bound) return commandResult(noReasoningSessionMessage());
        if (await sessionIsBusy(bound.session, options.control, requestOptions)) {
          return commandResult(t('当前任务正在运行，请等待完成或先发送 /stop。'));
        }
        const catalog = await sessionCatalog(bound.session, requestOptions);
        const current = catalog.current;
        const model = modelForSelection(catalog, current);

        let effort;
        if (requested.toLowerCase() === '--default') {
          effort = undefined;
        } else {
          if (!model?.reasoning) {
            return commandResult(unsupportedReasoningMessage(current, requested, model));
          }
          effort = reasoningEffortById(model, requested);
          if (!effort) {
            const numberRequest = positiveNumberRequest(requested);
            if (numberRequest?.index === null) {
              return commandResult(invalidReasoningNumberMessage(requested));
            }
            if (!numberRequest) {
              return commandResult(unsupportedReasoningMessage(current, requested, model));
            }
            effort = reasoningEffortAt(model, numberRequest.index);
            if (!effort) return commandResult(invalidReasoningNumberMessage(requested));
          }
          effort = effort.id;
        }

        const selection = {
          provider: current.provider,
          model: current.model,
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
        };
        const applied = await selectAndVerifyModel(bound.session, selection, requestOptions);
        assertSessionBinding(state, key, bound.sessionId);
        return commandResult(t(`推理等级已切换为：
{effort}

当前模型：{model}
后续消息将使用该推理等级。`, {
          model: modelId(applied.provider, applied.model),
          effort: reasoningEffortText(
            model,
            effectiveReasoningEffort(applied, model),
          ),
        }));
      });
    } catch (error) {
      return commandResult(modelErrorMessage(error, 'reasoning-select'));
    }
  }

  const match = /^\/model(?:[ \t]+([^\s]+)(?:[ \t]+([^\s]+))?)?[ \t]*$/iu.exec(command);
  if (!match) return commandResult(t(MODEL_USAGE));
  const requested = match[1];
  const requestedEffort = match[2];
  if (!requested) {
    try {
      const bound = await boundSession(harness, state, key, requestOptions);
      if (!bound) return commandResult(noSessionMessage());
      const catalog = await sessionCatalog(bound.session, requestOptions);
      return commandResult(currentModelMessage(catalog));
    } catch (error) {
      return commandResult(modelErrorMessage(error, 'select'));
    }
  }
  const numberRequest = positiveNumberRequest(requested);
  if (numberRequest?.index === null) {
    return commandResult(invalidModelNumberMessage(requested));
  }
  if (!numberRequest
    && (!requested.includes('/') || requested.startsWith('/') || requested.endsWith('/'))) {
    return commandResult(t(MODEL_USAGE));
  }
  if (options.pendingInteraction) {
    return commandResult([
      t('当前任务正在等待你的回答或审批。'),
      '',
      t('请先处理当前请求，或者发送 /stop 停止任务。'),
    ].join('\n'));
  }

  try {
    return await withSessionBindingLock(state, key, async () => {
      const bound = await boundSession(harness, state, key, requestOptions);
      if (bound && await sessionIsBusy(bound.session, options.control, requestOptions)) {
        return commandResult(t('当前任务正在运行，请等待完成或先发送 /stop。'));
      }

      const catalog = bound
        ? await sessionCatalog(bound.session, requestOptions)
        : await listCatalog(harness, requestOptions);
      const selection = numberRequest
        ? modelAt(catalog, numberRequest.index)
        : matchingModel(catalog, requested);
      if (!selection) {
        if (numberRequest) return commandResult(invalidModelNumberMessage(requested));
        return commandResult([
          t('没有找到模型：{model}', { model: safeDisplayText(requested) }),
          '',
          t('请发送 /models 查看可用模型。'),
        ].join('\n'));
      }
      const targetModel = modelForSelection(catalog, selection);
      if (requestedEffort !== undefined) {
        const effort = reasoningEffortById(targetModel, requestedEffort);
        if (!effort) {
          return commandResult(unsupportedReasoningMessage(
            selection,
            requestedEffort,
            targetModel,
          ));
        }
        selection.reasoningEffort = effort.id;
      }

      let applied;
      if (bound) {
        applied = await selectAndVerifyModel(bound.session, selection, requestOptions);
        assertSessionBinding(state, key, bound.sessionId);
      } else {
        if (typeof harness?.createSession !== 'function'
          || typeof harness?.workspaceSession !== 'function'
          || typeof state?.sessionFor !== 'function'
          || typeof state?.setSession !== 'function') {
          throw new TypeError('Harness cannot create a conversation session');
        }
        // An explicit choice must remain usable even when the saved bot model expires.
        const sessionId = await harness.createSession({
          ...requestOptions, inheritBotModel: false, conversationKey: key,
        });
        if (typeof sessionId !== 'string' || !sessionId) {
          throw new TypeError('Harness returned an invalid session id');
        }
        const session = harness.workspaceSession(sessionId, key);
        applied = await selectAndVerifyModel(session, selection, requestOptions);
        const currentSessionId = state.sessionFor(key);
        if (typeof currentSessionId === 'string' && currentSessionId) {
          throw sessionBindingChanged();
        }
        if (await state.setSession(key, sessionId) === false) {
          const stale = new Error('Workspace changed while binding the new session');
          stale.code = WORKSPACE_SESSION_STALE;
          throw stale;
        }
      }
      return commandResult(t(`模型已切换为：
{model}
推理等级：{effort}

后续消息将使用该模型和推理等级。`, {
        model: modelId(applied.provider, applied.model),
        effort: reasoningEffortText(
          targetModel,
          effectiveReasoningEffort(applied, targetModel),
        ),
      }));
    });
  } catch (error) {
    return commandResult(modelErrorMessage(error, 'select'));
  }
}
