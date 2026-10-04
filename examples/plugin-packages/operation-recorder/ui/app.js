'use strict';

// The session token stays in this closure and is removed from the address bar immediately.
(() => {
  const fragment = window.location.hash.slice(1);
  const token = new URLSearchParams(fragment).get('token') || (/^[A-Za-z0-9_-]{24,}$/.test(fragment) ? fragment : '');
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  window.addEventListener('hashchange', () => window.history.replaceState(null, '', window.location.pathname + window.location.search));

  const $ = (id) => document.getElementById(id);
  const state = { capabilities: null, sessions: [], session: null, active: null, busy: false, dirty: false, editRevision: 0, connected: false, error: null, finalAssertId: null, compiled: null, stale: false, markdownDirty: false };
  const actionNames = { focus: '切换应用', click: '点击', input: '输入', key: '按键', scroll: '滚动', navigate: '打开页面', select: '选择', assert: '结果检查' };
  const statusNames = { recording: '录制中', paused: '已暂停', draft: '已保存', reviewed: '已检查' };
  let pollTimer;
  let pollPending = false;
  let saveTimer;
  let pendingSave = Promise.resolve();
  let hostMessageSupported = false;
  let bridgeId = 0;
  const bridgePending = new Map();

  function bridgeRequest(method, params, timeoutMs = 10_000) {
    const id = `recorder-${++bridgeId}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        bridgePending.delete(id);
        reject(new Error('当前会话没有响应，请使用「复制给 AI 提炼」。'));
      }, timeoutMs);
      bridgePending.set(id, { resolve, reject, timeout });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }

  function applyHostTheme(context) {
    if (context?.theme === 'light' || context?.theme === 'dark') document.documentElement.dataset.theme = context.theme;
  }

  window.addEventListener('message', (event) => {
    if (window.parent === window || event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
    const data = event.data;
    if (data.id !== undefined && !data.method) {
      const pending = bridgePending.get(data.id);
      if (!pending) return;
      bridgePending.delete(data.id);
      window.clearTimeout(pending.timeout);
      if (data.error) pending.reject(new Error(data.error.message || '当前会话未接受请求。'));
      else pending.resolve(data.result);
    } else if (data.method === 'ui/notifications/host-context-changed') applyHostTheme(data.params);
    else if (data.method === 'ui/resource-teardown' && data.id !== undefined) window.parent.postMessage({ jsonrpc: '2.0', id: data.id, result: {} }, '*');
  });

  async function initializeHostBridge() {
    if (window.parent === window) return;
    // The host attaches its bridge after the iframe load event. Retry briefly;
    // standalone operation never waits on this optional conversation channel.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const host = await bridgeRequest('ui/initialize', { protocolVersion: '2025-11-21', appInfo: { name: 'iPolloWork 操作录制', version: '0.3.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] } }, 2500);
        hostMessageSupported = Boolean(host?.hostCapabilities?.message);
        applyHostTheme(host?.hostContext);
        window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
        $('ask-ai').hidden = !hostMessageSupported;
        renderControls();
        return;
      } catch { /* Optional bridge: quietly preserve the local workbench. */ }
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function message(text, tone = 'success') {
    const node = $('message');
    node.hidden = !text;
    node.textContent = text;
    node.dataset.tone = tone;
    node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }

  function connection(ready, label) {
    state.connected = ready;
    $('connection').dataset.state = ready ? 'ready' : 'error';
    $('connection-label').textContent = label;
    renderControls();
  }

  async function request(action, args = {}) {
    if (!token) throw new Error('此页面没有有效连接凭据。请从 iPolloWork 插件中重新打开工作台。');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`/api/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(args),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : '本地服务未能完成操作，请重新打开工作台后重试。');
      return payload.result ?? payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('本地服务响应超时。录制可能仍在运行，请刷新状态后再操作。');
      if (error instanceof TypeError) throw new Error('无法连接本地服务。请从 iPolloWork 插件重新打开工作台。');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function operation(task) {
    if (state.busy) return;
    state.busy = true;
    renderControls();
    message('');
    try { await task(); }
    catch (error) { message(error.message || '操作未完成，请重试。', 'error'); }
    finally { state.busy = false; renderControls(); }
  }

  function editable() {
    return state.session && !['recording', 'paused'].includes(state.session.status);
  }

  function markDirty() {
    state.dirty = true;
    state.editRevision += 1;
    state.stale = Boolean(state.compiled);
    scheduleSave();
    renderControls();
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (!state.dirty || !editable()) return;
      if (state.busy) { scheduleSave(); return; }
      void saveReview().catch((error) => message(`修改未能保存：${error.message}`, 'error'));
    }, 600);
  }

  function renderControls() {
    const active = state.active;
    const recording = active?.status === 'recording';
    const paused = active?.status === 'paused';
    const canWrite = state.connected && !state.busy;
    $('main').setAttribute('aria-busy', String(state.busy));
    $('start').disabled = !canWrite || Boolean(active) || state.capabilities?.desktop?.supported !== true;
    $('start').hidden = Boolean(active);
    $('start').textContent = state.busy ? '请稍候…' : '开始录制';
    $('start').classList.toggle('primary', !editable() && !active);
    $('refresh').disabled = state.busy;
    $('import-file').disabled = !canWrite || Boolean(active);
    $('request-permissions').disabled = !canWrite || Boolean(active);
    $('pause').hidden = !recording;
    $('resume').hidden = !paused;
    $('stop').hidden = !active;
    for (const id of ['pause', 'resume', 'stop']) $(id).disabled = !canWrite;
    $('intro').hidden = Boolean(state.session);
    $('review-area').hidden = !state.session;
    const phase = state.compiled && !state.stale ? 'skill' : state.session && !active ? 'review' : 'capture';
    for (const name of ['capture', 'review', 'skill']) {
      const node = $(`phase-${name}`);
      if (name === phase) node.setAttribute('aria-current', 'step');
      else node.removeAttribute('aria-current');
      node.dataset.complete = String((name === 'capture' && phase !== 'capture') || (name === 'review' && phase === 'skill'));
    }
    const status = $('capture-state');
    status.dataset.state = active?.status || 'idle';
    status.textContent = active ? `${statusNames[active.status]} · ${active.stepCount ?? state.session?.steps.length ?? 0} 步` : state.connected ? state.capabilities?.desktop?.supported ? '准备就绪' : '桌面录制不可用' : '等待连接';
    $('save-state').hidden = !editable();
    $('save-state').textContent = state.dirty ? '正在保存…' : '已自动保存';
    $('compile-area').hidden = !editable() || Boolean(state.compiled && !state.stale);
    $('compile').disabled = !canWrite || !editable() || !state.session?.steps.length;
    $('compile').textContent = state.busy ? '请稍候…' : state.stale ? '更新 Skill' : '生成 Skill';
    $('compile').classList.toggle('primary', (!state.compiled || state.stale) && !active);
    $('download').disabled = !canWrite || !state.compiled || state.stale;
    $('download').textContent = state.markdownDirty ? '保存并下载插件' : '下载 Skill 插件';
    $('download').classList.toggle('primary', Boolean(state.compiled) && !state.stale && !active && !hostMessageSupported);
    $('ask-ai').classList.toggle('primary', Boolean(state.compiled) && !state.stale && !active && hostMessageSupported);
    $('copy-ai').hidden = hostMessageSupported;
    $('download-markdown').disabled = !state.compiled || state.stale || state.busy;
    $('download-json').disabled = !state.compiled || state.stale || state.busy;
    $('copy-ai').disabled = !state.compiled || state.stale || state.busy;
    $('ask-ai').disabled = !hostMessageSupported || !state.compiled || state.stale || state.busy;
    $('copy-path').disabled = !state.compiled || state.busy;
    $('skill-markdown').disabled = state.busy;
    for (const node of $('recording-list').querySelectorAll('button')) node.disabled = state.busy;
    for (const node of $('steps').querySelectorAll('input, textarea, button')) node.disabled = !editable() || state.busy;
    for (const node of $('compile-form').querySelectorAll('input, textarea')) node.disabled = !editable() || state.busy;
    if (state.compiled) {
      $('output-note').textContent = state.stale
        ? '操作步骤已修改。请重新生成 Skill 后再下载。'
        : state.markdownDirty
          ? '下载插件时将保存你的编辑，并重新打包。本草稿尚未实际重放验证。'
          : '草稿尚未经过 AI 提炼或实际重放验证。';
    }
  }

  function renderPermissions() {
    const desktop = state.capabilities?.desktop;
    const permission = $('permission');
    const granted = [desktop?.accessibility, desktop?.inputMonitoring].every((value) => value === true || value === 'granted');
    $('request-permissions').hidden = state.capabilities?.platform !== 'darwin' || granted;
    $('options-label').textContent = !desktop?.supported ? '桌面不可用 · 导入录制' : granted ? '录制选项' : '检查录制权限';
    if (!desktop?.supported) {
      permission.textContent = `${desktop?.reason || '当前桌面会话不支持实时录制。'} 可以导入 Chrome Recorder JSON，继续整理并生成 Skill。`;
      $('capture-options').open = true;
      return;
    }
    const permissionName = (value) => value === true || value === 'granted' ? '已授权' : value === false || value === 'denied' ? '待授权' : '启动时检查';
    const guidance = desktop.permissionHelp || (state.capabilities?.platform === 'darwin' ? '请在「系统设置 → 隐私与安全性」允许录制服务。' : '仅录制当前用户可访问的桌面应用。');
    const backend = desktop.backend ? `（${desktop.backend}）` : '';
    permission.textContent = granted ? `系统权限已就绪${backend}。输入原文不保存，输入步骤使用变量。` : `辅助功能${permissionName(desktop.accessibility)}，输入监控${permissionName(desktop.inputMonitoring)}。${guidance}`;
    if (!granted) $('capture-options').open = true;
  }

  function renderList() {
    const list = $('recording-list');
    list.replaceChildren();
    $('list-empty').hidden = state.sessions.length > 0;
    $('list-empty').textContent = state.connected ? '还没有录制记录' : '暂未读取录制记录';
    $('history-count').textContent = state.sessions.length ? ` ${state.sessions.length}` : '';
    for (const session of state.sessions) {
      const item = element('li');
      const button = element('button', 'recording-item');
      button.type = 'button';
      button.dataset.sessionId = session.id;
      button.setAttribute('aria-current', String(state.session?.id === session.id));
      button.disabled = state.busy;
      button.append(element('strong', '', session.title));
      const date = new Date(session.createdAt);
      const dateLabel = Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '';
      button.append(element('small', '', `${statusNames[session.status] || session.status} · ${session.stepCount ?? 0} 步${dateLabel ? ` · ${dateLabel}` : ''}`));
      item.append(button);
      list.append(item);
    }
  }

  function field(id, labelText, value, options = {}) {
    const label = element('label', options.wide ? 'wide' : '');
    label.htmlFor = id;
    label.append(document.createTextNode(labelText));
    const input = element(options.multiline ? 'textarea' : 'input');
    input.id = id;
    input.value = value || '';
    input.dataset.field = options.field;
    input.dataset.stepId = options.stepId;
    input.maxLength = 2000;
    if (options.multiline) input.rows = 2;
    else input.type = 'text';
    if (options.field === 'expected') input.placeholder = '这个步骤完成后，应看到什么结果？';
    if (options.field === 'note') input.placeholder = '补充操作目的、范围或需要注意的条件';
    input.disabled = !editable();
    label.append(input);
    return label;
  }

  function stepTarget(step) {
    const target = step.target?.name || step.url || step.window || step.app || (step.action === 'key' ? step.key : step.action === 'assert' ? step.expected : '检查当前应用中的目标');
    return target === 'AXWindow' ? '当前窗口' : target;
  }

  function renderSteps() {
    const opened = new Set(Array.from($('steps').querySelectorAll('details[open]')).map((node) => node.dataset.stepId));
    $('steps').replaceChildren();
    const steps = state.session?.steps || [];
    $('step-count').textContent = String(steps.length);
    $('steps-empty').hidden = steps.length > 0;
    $('review-description').textContent = state.session
      ? `${state.session.title} · ${editable() ? '可选编辑' : '实时捕获中'}`
      : '';
    if (!steps.length && state.session) {
      $('steps-empty').replaceChildren(element('h3', '', editable() ? '这段录制没有可用步骤' : '等待第一步操作'), element('p', '', editable() ? '重新开始录制，或导入 Chrome Recorder JSON。' : '切换到目标应用并开始操作。录制控件本身不属于工作流。'));
    }
    for (const [index, step] of steps.entries()) {
      const item = element('li', 'step');
      const details = element('details');
      details.dataset.stepId = step.id;
      details.open = opened.has(step.id);
      const summary = element('summary');
      summary.append(element('span', 'step-index', String(index + 1).padStart(2, '0')), element('span', 'step-action', actionNames[step.action] || step.action), element('span', 'step-target', stepTarget(step)));
      details.append(summary);
      const body = element('div', 'step-body');
      const context = [step.app, step.window, step.target?.role, step.url, step.key ? `按键 ${step.key}` : ''].filter(Boolean);
      if (step.target?.selectors?.length) context.push(`定位参考：${step.target.selectors.join(' / ')}`);
      if (context.length) body.append(element('p', 'step-context', context.join(' · ')));
      const fields = element('div', 'field-grid');
      fields.append(field(`note-${index}`, '补充说明（可选）', step.note, { field: 'note', stepId: step.id, multiline: true }), field(`expected-${index}`, '预期结果（可选）', step.expected, { field: 'expected', stepId: step.id, multiline: true }));
      body.append(fields);
      const controls = element('div', 'toolbar');
      if (step.action === 'input' || step.action === 'select') {
        const label = element('label', 'check');
        const secret = element('input');
        secret.type = 'checkbox';
        secret.checked = step.secret === true;
        secret.dataset.field = 'secret';
        secret.dataset.stepId = step.id;
        secret.disabled = !editable();
        label.append(secret, element('span', '', '该输入包含敏感信息，仅在执行时提供'));
        controls.append(label);
      } else controls.append(element('span'));
      const remove = element('button', 'danger', '删除这一步');
      remove.type = 'button';
      remove.dataset.removeStep = step.id;
      remove.disabled = !editable();
      controls.append(remove);
      body.append(controls);
      details.append(body);
      item.append(details);
      $('steps').append(item);
    }
    renderControls();
  }

  function loadSession(session, preserveDraft = false) {
    if (preserveDraft && state.dirty && state.session?.id === session?.id) return;
    const changed = state.session?.id !== session?.id;
    const wasActive = ['recording', 'paused'].includes(state.session?.status);
    const isActive = ['recording', 'paused'].includes(session?.status);
    if (changed || wasActive !== isActive) $('review-area').open = isActive;
    state.session = session ? structuredClone(session) : null;
    state.dirty = false;
    if (changed) {
      state.compiled = null;
      state.stale = false;
      state.markdownDirty = false;
      $('output-area').hidden = true;
      state.editRevision = 0;
      $('optional-settings').open = false;
      $('draft-editor').open = false;
    }
    const lastStep = session?.steps.at(-1);
    const finalAssertion = lastStep?.action === 'assert' ? lastStep : null;
    state.finalAssertId = finalAssertion?.id || null;
    $('success-condition').value = finalAssertion?.expected || '';
    renderSteps();
    renderList();
  }

  async function refresh({ preserveDraft = true } = {}) {
    const result = await request('status', state.session ? { sessionId: state.session.id } : {});
    state.sessions = result.sessions || [];
    state.active = state.sessions.find((session) => ['recording', 'paused'].includes(session.status)) || null;
    state.error = result.error;
    connection(true, '已连接');
    const incoming = result.session;
    const changed = JSON.stringify(incoming) !== JSON.stringify(state.session);
    if (!state.session || ((!editable() || !preserveDraft || !state.dirty) && changed)) loadSession(incoming, preserveDraft);
    renderList();
    renderControls();
    if (result.error) message(result.error, 'error');
  }

  function reviewSteps() {
    let steps = structuredClone(state.session.steps);
    const expected = $('success-condition').value.trim();
    if (expected) {
      const existing = steps.find((step) => step.id === state.finalAssertId);
      if (existing) existing.expected = expected;
      else {
        if (steps.length >= (state.capabilities?.maxSteps || 500)) throw new Error('已达到步骤上限。请删除几步噪音操作，为最终成功检查留出空间。');
        const assertion = { id: crypto.randomUUID(), at: new Date().toISOString(), action: 'assert', expected, note: '最终成功检查' };
        state.finalAssertId = assertion.id;
        steps.push(assertion);
      }
    } else if (state.finalAssertId) {
      steps = steps.filter((step) => step.id !== state.finalAssertId);
    }
    for (const step of steps) {
      if (step.action === 'assert' && !step.expected?.trim()) throw new Error('成功检查不能为空，请填写预期结果或删除该步骤。');
    }
    return steps;
  }

  async function saveReview() {
    if (!editable()) throw new Error('请先停止录制再整理步骤。');
    window.clearTimeout(saveTimer);
    const sessionId = state.session.id;
    const revision = state.editRevision;
    const steps = reviewSteps();
    const saving = pendingSave.then(() => request('review', { sessionId, steps }));
    pendingSave = saving.catch(() => {});
    const result = await saving;
    if (state.session?.id === sessionId && state.editRevision === revision) {
      const structureChanged = result.session.steps.map((step) => step.id).join() !== state.session.steps.map((step) => step.id).join();
      state.session = structuredClone(result.session);
      state.dirty = false;
      state.finalAssertId = result.session.steps.at(-1)?.action === 'assert' ? result.session.steps.at(-1).id : null;
      if (structureChanged) renderSteps();
      renderControls();
      renderList();
    }
    return result.session;
  }

  function renderOutput(result) {
    state.compiled = result;
    state.stale = false;
    state.markdownDirty = false;
    $('skill-markdown').value = result.skill;
    $('output-area').hidden = false;
    $('paths').replaceChildren();
    for (const [label, path] of [['本地 Skill 目录', result.directory], ['Skill 文件', result.skillPath], ['工作流', result.workflowPath], ['插件包', result.archivePath]]) {
      if (!path) continue;
      $('paths').append(element('dt', '', label), element('dd', '', path));
    }
    renderControls();
    $('output-title').scrollIntoView({ behavior: 'auto', block: 'nearest' });
  }

  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = element('a');
    anchor.href = url;
    anchor.download = name;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function copy(text, done) {
    if (!navigator.clipboard?.writeText) throw new Error('当前页面不支持自动复制。请在草稿或本地路径中选中文字后复制。');
    try { await navigator.clipboard.writeText(text); }
    catch { throw new Error('浏览器未允许复制。请直接选中文字后复制。'); }
    message(done);
  }

  $('capture-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void operation(async () => {
      if (state.dirty) await saveReview();
      const result = await request('start');
      loadSession(result.session);
      await refresh({ preserveDraft: false });
      message('录制已开始。切换到目标应用并完成操作，返回后停止录制。');
    });
  });

  for (const action of ['pause', 'resume', 'stop']) $(action).addEventListener('click', () => {
    void operation(async () => {
      const result = await request(action);
      loadSession(result.session);
      await refresh({ preserveDraft: false });
      message(action === 'stop' ? '已自动保存，可以直接生成 Skill。' : action === 'pause' ? '录制已暂停。' : '录制已继续。');
    });
  });

  $('refresh').addEventListener('click', () => void operation(async () => {
    state.capabilities = await request('capabilities');
    renderPermissions();
    await refresh();
    message(state.dirty ? '已刷新录制状态，你的未保存修改仍保留在页面中。' : '录制状态已刷新。');
  }));

  $('request-permissions').addEventListener('click', () => void operation(async () => {
    const result = await request('request-permissions');
    state.capabilities = { ...state.capabilities, desktop: result.desktop };
    renderPermissions();
    message('已检查系统权限。如系统显示授权提示，请完成授权后刷新状态。');
  }));

  $('recording-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-session-id]');
    if (!button || button.dataset.sessionId === state.session?.id) return;
    void operation(async () => {
      if (state.dirty) await saveReview();
      const result = await request('status', { sessionId: button.dataset.sessionId });
      loadSession(result.session);
      $('history').open = false;
    });
  });

  $('steps').addEventListener('input', (event) => {
    const input = event.target;
    if (!input.dataset.stepId || !editable()) return;
    const step = state.session.steps.find((item) => item.id === input.dataset.stepId);
    if (!step) return;
    step[input.dataset.field] = input.dataset.field === 'secret' ? input.checked : input.value;
    if (step.id === state.finalAssertId && input.dataset.field === 'expected') $('success-condition').value = input.value;
    markDirty();
  });

  $('steps').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-step]');
    if (!button || !editable()) return;
    state.session.steps = state.session.steps.filter((step) => step.id !== button.dataset.removeStep);
    if (state.finalAssertId === button.dataset.removeStep) {
      state.finalAssertId = null;
      $('success-condition').value = '';
    }
    markDirty();
    renderSteps();
  });

  $('success-condition').addEventListener('input', () => {
    if (!editable()) return;
    const existing = state.session.steps.find((step) => step.id === state.finalAssertId);
    if (existing) {
      existing.expected = $('success-condition').value;
      const input = Array.from($('steps').querySelectorAll('[data-field="expected"]')).find((node) => node.dataset.stepId === existing.id);
      if (input) input.value = existing.expected;
    }
    markDirty();
  });

  $('import-file').addEventListener('change', () => {
    const file = $('import-file').files?.[0];
    if (!file) return;
    void operation(async () => {
      if (file.size > 1_000_000) throw new Error('导入文件不能超过 1 MB，请使用 Chrome Recorder 导出的原始 JSON。');
      let flow;
      try { flow = JSON.parse(await file.text()); }
      catch { throw new Error('无法读取 JSON 文件，请确认它是 Chrome Recorder 导出的录制。'); }
      if (state.dirty) await saveReview();
      const result = await request('import-chrome', { flow });
      loadSession(result.session);
      await refresh({ preserveDraft: false });
      message('已导入，可以直接生成 Skill。');
    }).finally(() => { $('import-file').value = ''; });
  });

  $('compile-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('compile-form').reportValidity()) return;
    void operation(async () => {
      if (state.dirty) await saveReview();
      const result = await request('compile', { sessionId: state.session.id });
      if (result.session) loadSession(result.session);
      renderOutput(result);
      await refresh();
      message('Skill 已生成，名称和输入变量已自动处理。');
    });
  });

  $('skill-markdown').addEventListener('input', () => {
    state.markdownDirty = $('skill-markdown').value !== state.compiled?.skill;
    renderControls();
  });

  $('download').addEventListener('click', () => void operation(async () => {
    if (!state.compiled || state.stale) throw new Error('请先生成当前步骤的 Skill。');
    if (state.markdownDirty) {
      const result = await request('compile', { sessionId: state.session.id, skillName: state.compiled.name, description: state.compiled.manifest.description, skillContent: $('skill-markdown').value });
      renderOutput(result);
    }
    if (!state.compiled.archiveBase64) throw new Error('本地服务未返回插件包。可以下载 SKILL.md 或 JSON 文件。');
    const bytes = Uint8Array.from(atob(state.compiled.archiveBase64), (char) => char.charCodeAt(0));
    download(bytes, state.compiled.archiveName || 'recorded-skill.ipollowork-plugin', 'application/zip');
    message('插件包已下载，可从 iPolloWork 插件库导入。');
  }));

  $('download-markdown').addEventListener('click', () => download($('skill-markdown').value, 'SKILL.md', 'text/markdown;charset=utf-8'));
  $('download-json').addEventListener('click', () => {
    const result = state.compiled;
    download(JSON.stringify({ format: 'ipollowork-recorded-skill', version: 1, manifest: result.manifest, workflow: result.workflow, skill: $('skill-markdown').value, session: result.session || state.session }, null, 2) + '\n', `${result.name}.json`, 'application/json;charset=utf-8');
  });
  $('copy-path').addEventListener('click', () => void operation(() => copy(state.compiled.directory, '本地 Skill 目录已复制。')));
  $('copy-ai').addEventListener('click', () => void operation(() => copy(`请根据以下录制草稿提炼通用 Skill。自动归纳用途与说明，保留输入变量、权限边界、前置条件和已有成功检查。没有明确完成条件时不要编造，也不要把导出标记为人工审阅或实际验证通过。兼容 OpenCode、Codex、DeepSeek，使用当前引擎已授权的可用工具。\n\n${$('skill-markdown').value}`, '提炼提示和 Skill 草稿已复制。')));
  $('ask-ai').addEventListener('click', () => void operation(async () => {
    if (!hostMessageSupported || !state.session || !state.compiled || state.stale) throw new Error('请先生成当前录制的 Skill 草稿。');
    if (state.markdownDirty) {
      const saved = await request('compile', { sessionId: state.session.id, skillName: state.compiled.name, description: state.compiled.manifest.description, skillContent: $('skill-markdown').value });
      renderOutput(saved);
    }
    const prompt = `请提炼这段操作录制，生成可复用的通用 Skill。通过 operation-recorder 插件的 status 动作读取 sessionId=${state.session.id}，保留变量、敏感字段标记、授权范围和已有成功检查。自动归纳用途与说明，不要求用户起技术名称或变量名；没有明确完成条件时不要编造。兼容 OpenCode、Codex、DeepSeek，并使用当前引擎已授权的工具。不要把草稿导出当成人工审阅通过，也不要编造实际重放或验证结果。当前 skillName=${state.compiled.name}，description=${JSON.stringify(state.compiled.manifest.description)}。如要保存提炼稿，请使用该插件的 compile 动作，传入同一 sessionId、skillName、description 及 skillContent；保留与名称和描述一致的 YAML frontmatter。先读取现有草稿 ${state.compiled.skillPath}。`;
    const result = await bridgeRequest('ui/message', { role: 'user', content: [{ type: 'text', text: prompt }] });
    if (result?.isError) throw new Error('当前 AI 会话未接受请求，请使用「复制给 AI 提炼」。');
    message('请求已送到当前 AI 会话。提炼结果请在会话中查看。');
  }));

  async function poll() {
    if (document.hidden || state.busy || pollPending || !state.connected) return;
    pollPending = true;
    try { await refresh(); }
    catch (error) { connection(false, '本地连接中断'); message(error.message, 'error'); }
    finally { pollPending = false; }
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });
  window.addEventListener('pagehide', () => { window.clearInterval(pollTimer); window.clearTimeout(saveTimer); });

  async function initialize() {
    if (!token) {
      connection(false, '未连接');
      message('此页面没有有效连接凭据。请从 iPolloWork 的操作录制插件重新打开工作台。', 'error');
      $('permission').textContent = '连接恢复后才能开始录制或导入。';
      $('list-empty').textContent = '尚未连接本地服务';
      return;
    }
    pollTimer = window.setInterval(() => { void poll(); }, 2000);
    try {
      const results = await Promise.all([request('capabilities'), request('status')]);
      state.capabilities = results[0];
      state.sessions = results[1].sessions || [];
      state.active = state.sessions.find((session) => ['recording', 'paused'].includes(session.status)) || null;
      connection(true, '已连接');
      renderPermissions();
      loadSession(results[1].session);
      renderList();
      if (results[1].error) message(results[1].error, 'error');
    } catch (error) {
      connection(false, '连接失败');
      message(error.message, 'error');
      $('list-empty').textContent = '暂未读取录制记录';
    }
  }

  void initialize();
  void initializeHostBridge();
})();
