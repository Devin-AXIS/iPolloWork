(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const state = { settings: {}, accounts: [], drafts: [], assets: [], jobs: [] };
  let accountId = '', draftId = '', dirty = false, busy = false, settingsLoaded = false, hostPromise;
  let videoPage, commentPage, searchPage, commentItem = '', searchInput;
  const hostRequests = new Map();
  let hostRequestId = 0;
  const storageKey = 'douyin-ops-token';
  const hash = new URLSearchParams(location.hash.slice(1));
  let token = hash.get('token') || '';
  try { if (token) sessionStorage.setItem(storageKey, token); else token = sessionStorage.getItem(storageKey) || ''; } catch { /* The current launch token still works without storage. */ }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  let operations = {};
  try { operations = JSON.parse(sessionStorage.getItem('douyin-ops-operations') || '{}'); } catch { /* No pending operations. */ }
  const labels = { succeeded: '已完成', success: '已完成', completed: '已完成', published: '已发布', failed: '失败', uncertain: '结果待核实', pending: '等待处理', running: '处理中', submitting: '正在提交', draft: '草稿' };
  const date = value => value ? new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value).toLocaleString('zh-CN', { hour12: false }) : '未知';
  const account = () => state.accounts.find(item => item.id === accountId);
  const currentDraft = () => state.drafts.find(item => item.id === draftId);
  const text = (selector, value) => { $(selector).textContent = value; };
  function node(tag, className, value) { const result = document.createElement(tag); if (className) result.className = className; if (value !== undefined) result.textContent = value; return result; }
  function empty(selector, message) { $(selector).replaceChildren(node('p', 'empty', message)); }
  function notify(message, error = false) { const output = $('#feedback'); output.hidden = false; output.classList.toggle('error', error); output.textContent = message; }
  function requireAccount() { if (!accountId) throw new Error('请先在「账号」中完成官方授权。'); return accountId; }
  function actionButton(label, action) { const result = node('button', '', label); result.type = 'button'; result.addEventListener('click', () => run(action)); return result; }
  function badge(status) { return node('span', `badge ${status === 'failed' ? 'danger' : ['uncertain', 'pending', 'running'].includes(status) ? 'warning' : 'success'}`, labels[status] || status); }
  async function request(path, options = {}) {
    if (!token) throw new Error('缺少本地服务凭证，请从插件重新打开运营台。');
    let response;
    try { response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(120000) }); }
    catch { throw Object.assign(new Error('本地服务连接中断，请刷新运营台检查操作记录。'), { code: 'NETWORK' }); }
    let result;
    try { result = await response.json(); } catch { throw Object.assign(new Error('本地服务返回了无法读取的结果，请刷新检查。'), { code: 'NETWORK' }); }
    if (!response.ok || result.error) throw Object.assign(new Error(typeof result.error === 'string' ? result.error : '操作失败，请检查配置与授权权限。'), { code: result.code || `HTTP_${response.status}` });
    return result;
  }
  const action = (name, args = {}) => request(`/api/actions/${name}`, { method: 'POST', body: JSON.stringify(args) });
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.jsonrpc !== '2.0' || event.data.method) return;
    const pending = hostRequests.get(event.data.id);
    if (!pending) return;
    hostRequests.delete(event.data.id); clearTimeout(pending.timer);
    event.data.error ? pending.reject(new Error(event.data.error.message)) : pending.resolve(event.data.result);
  });
  function hostRequest(method, params) {
    if (window === parent) return Promise.reject(new Error('AI 起草需要从 iPolloWork 当前会话右侧打开运营台。'));
    return new Promise((resolve, reject) => {
      const id = ++hostRequestId;
      const timer = setTimeout(() => { hostRequests.delete(id); reject(new Error('当前会话未响应，请确认会话空闲后重试。')); }, 15000);
      hostRequests.set(id, { resolve, reject, timer });
      parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  function getHost() {
    hostPromise ??= hostRequest('ui/initialize', { protocolVersion: '2025-11-21', appInfo: { name: '抖音运营台', version: '0.1.4' }, appCapabilities: {} }).then(host => {
      parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*'); return host;
    }).catch(error => { hostPromise = undefined; throw error; });
    return hostPromise;
  }
  async function openTarget(target) {
    const url = new URL(target.url);
    if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)douyin\.com$/.test(url.hostname)) throw new Error('仅支持打开 HTTPS 抖音官方页面。');
    if (window !== parent) { await getHost(); const result = await hostRequest('ui/open-link', target); if (result?.isError) throw new Error('当前会话无法打开浏览器入口。'); }
    else { const link = node('a', '', '点击打开抖音页面 ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; $('#feedback').append(' ', link); }
  }
  function lock() {
    document.body.setAttribute('aria-busy', String(busy));
    document.querySelectorAll('fieldset').forEach(item => { item.disabled = busy; });
    for (const selector of ['#account', '#refresh', '#new-draft', '#draft-picker', '#media-file']) $(selector).disabled = busy;
    $('#account').disabled = busy || !state.accounts.length;
    updatePublish();
  }
  async function run(fn) { if (busy) return; busy = true; lock(); try { await fn(); } catch (error) { notify(error.message, true); } finally { busy = false; lock(); } }
  function view(name) {
    document.querySelectorAll('.view').forEach(item => { item.hidden = item.id !== `view-${name}`; });
    document.querySelectorAll('.tabs [data-view]').forEach(item => { if (item.dataset.view === name) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
  }
  function options(select, items, prompt, value) {
    select.replaceChildren(); if (prompt) select.add(new Option(prompt, ''));
    items.forEach(item => select.add(new Option(item.label, item.id))); select.value = value;
  }
  function render() {
    options($('#account'), state.accounts.map(item => ({ id: item.id, label: item.nickname || item.openId })), state.accounts.length ? null : '尚未授权账号', accountId);
    text('#connection-status', state.settings.secretConfigured ? `官方 API · ${state.accounts.length} 个已授权账号` : '本地服务已连接 · 请配置官方 API');
    text('#secret-status', state.settings.secretConfigured ? '密钥已保存' : '未配置');
    if (!settingsLoaded) {
      $('#client-key').value = state.settings.clientKey || ''; $('#redirect-uri').value = state.settings.redirectUri || '';
      $('#requested-scopes').value = (state.settings.scopes || []).join(','); settingsLoaded = true;
      $('#settings-panel').open = !state.settings.secretConfigured;
    }
    $('#accounts-list').replaceChildren();
    for (const item of state.accounts) {
      const card = node('article', 'record'), head = node('header');
      const expired = item.expiresAt && new Date(typeof item.expiresAt === 'number' && item.expiresAt < 1e12 ? item.expiresAt * 1000 : item.expiresAt).getTime() < Date.now();
      head.append(node('strong', '', item.nickname || item.openId), node('span', `badge ${expired ? 'warning' : 'success'}`, expired ? '授权已过期' : '已授权'));
      card.append(head, node('p', 'muted', `授权到期：${date(item.expiresAt)}`), node('p', 'muted', `账号 ID：${item.openId}`));
      const scopes = node('div', 'scope-list'); (item.scopes || []).forEach(scope => scopes.append(node('span', '', scope)));
      card.append(node('p', 'hint', '实际授权权限'), scopes.childElementCount ? scopes : node('p', 'hint', '授权结果未包含权限列表。'));
      $('#accounts-list').append(card);
    }
    if (!state.accounts.length) empty('#accounts-list', '尚未连接抖音账号。配置应用后，扫码完成官方授权。');
    renderDraftPicker(); renderJobs(); updatePublish();
  }
  function renderDraftPicker() {
    options($('#draft-picker'), state.drafts.filter(item => item.accountId === accountId).map(item => ({ id: item.id, label: item.title || '未命名草稿' })), '新草稿', draftId);
    options($('#draft-asset'), state.assets.map(item => ({ id: item.id, label: `${item.name} · ${(item.size / 1048576).toFixed(1)} MiB` })), '请选择已导入的视频', $('#draft-asset').value);
  }
  function loadDraft(id = '') {
    const draft = state.drafts.find(item => item.id === id && item.accountId === accountId);
    draftId = draft?.id || ''; dirty = false;
    $('#draft-title').value = draft?.title || ''; $('#draft-text').value = draft?.text || ''; $('#draft-asset').value = draft?.assetId || '';
    $('#draft-picker').value = draftId;
    text('#draft-status', draft ? labels[draft.status] || draft.status || '已保存' : '未保存');
    text('#draft-save-state', draft ? `保存于 ${date(draft.updatedAt)}` : '草稿仅保存在本地。'); updatePublish();
  }
  async function refresh() {
    Object.assign(state, await request('/api/state'));
    for (const operation of Object.values(operations)) { const job = state.jobs.find(item => item.operationKey === operation.operationKey); if (job) operation.status = job.status; } saveOperations();
    if (!accountId) accountId = state.accounts[0]?.id || '';
    if (accountId && !state.accounts.some(item => item.id === accountId)) throw new Error('当前账号已不可用。草稿编辑已保留，请重新授权账号。');
    render(); if (!dirty) loadDraft(draftId || state.drafts.find(item => item.accountId === accountId)?.id);
  }
  async function saveDraft() {
    requireAccount();
    const { draft } = await action('save-draft', { id: draftId || undefined, accountId, title: $('#draft-title').value.trim() || '未命名草稿', text: $('#draft-text').value, assetId: $('#draft-asset').value || undefined });
    state.drafts = [draft, ...state.drafts.filter(item => item.id !== draft.id)]; renderDraftPicker(); loadDraft(draft.id); return draft;
  }
  function markDirty() { dirty = true; text('#draft-save-state', '有未保存的修改'); updatePublish(); }
  const publishKey = () => draftId ? `publish:${accountId}:${draftId}` : '';
  function updatePublish() {
    const status = operations[publishKey()]?.status || currentDraft()?.status;
    const locked = Boolean(currentDraft() && currentDraft().status !== 'draft') || ['uncertain', 'pending', 'running', 'submitting', 'succeeded', 'success', 'completed'].includes(status);
    const blocked = locked || ['uncertain', 'pending', 'running', 'submitting', 'published', 'succeeded', 'success', 'completed'].includes(status);
    $('#draft-form fieldset').disabled = $('#media-form fieldset').disabled = busy || locked;
    $('#media-file').disabled = busy || locked;
    $('#publish-draft').disabled = busy || !accountId || !$('#draft-asset').value || blocked;
    text('#publish-draft', status === 'uncertain' ? '结果待核实' : blocked ? (labels[status] || '处理中') : '发布到抖音');
    text('#publish-note', locked ? '这份草稿已提交并锁定。请在操作记录中查看结果；准备其他内容请新建草稿。' : '点击发布会将当前内容保存，并提交到所选抖音账号。');
  }
  function saveOperations() { try { sessionStorage.setItem('douyin-ops-operations', JSON.stringify(operations)); } catch { /* In-memory operation keys remain stable for this page. */ } }
  async function externalWrite(name, args, key) {
    const operation = operations[key] ||= { operationKey: crypto.randomUUID(), status: 'ready' };
    if (['uncertain', 'pending', 'running', 'succeeded', 'success', 'completed', 'published'].includes(operation.status)) throw new Error('该操作已提交，请先在「记录」中核实结果。');
    operation.status = 'pending'; saveOperations();
    try {
      const { job } = await action(name, { ...args, operationKey: operation.operationKey });
      operation.status = job.status; saveOperations();
      state.jobs = [job, ...state.jobs.filter(item => item.id !== job.id)]; renderJobs();
      notify(job.message || labels[job.status] || '操作已提交', ['failed', 'uncertain'].includes(job.status)); return job;
    } catch (error) { operation.status = error.code === 'NETWORK' || error.code === 'UNCERTAIN' ? 'uncertain' : 'failed'; saveOperations(); throw error; }
  }
  function renderJobs() {
    $('#jobs-list').replaceChildren();
    for (const job of state.jobs.filter(item => !accountId || item.accountId === accountId)) {
      const card = node('article', 'record'), head = node('header');
      head.append(node('strong', '', ({ 'publish-draft': '发布视频', publish: '发布视频', 'reply-comment': '回复评论', reply: '回复评论' })[job.kind] || job.kind), badge(job.status));
      card.append(head, node('p', 'body', job.message || labels[job.status] || job.status), node('p', 'muted', date(job.createdAt)));
      if (job.result) { const details = node('details'); details.append(node('summary', '', '接口返回结果'), node('pre', '', JSON.stringify(job.result, null, 2))); card.append(details); }
      if (job.status === 'uncertain') {
        const form = node('form'), fieldset = node('fieldset'), outcomeLabel = node('label', '', '在抖音核对后的实际结果'), outcome = node('select'); outcome.required = true;
        outcome.add(new Option('请选择核对结果', '')); outcome.add(new Option('确认操作已成功', 'succeeded')); outcome.add(new Option('确认操作未成功', 'failed')); outcomeLabel.append(outcome);
        const evidenceLabel = node('label', '', '核对依据'), evidence = node('textarea'); evidence.required = true; evidence.rows = 2; evidence.placeholder = '填写作品链接、评论位置或核对时间与结果'; evidenceLabel.append(evidence);
        const button = node('button', '', '保存核对结果'); button.type = 'submit'; fieldset.append(outcomeLabel, evidenceLabel, button); form.append(fieldset);
        form.addEventListener('submit', event => { event.preventDefault(); run(async () => { await action('resolve-job', { jobId: job.id, outcome: outcome.value, evidence: evidence.value.trim() }); await refresh(); notify('核对结果已保存。确认失败的发布请新建草稿后处理。'); }); }); card.append(form);
      }
      if (job.status === 'failed') card.append(node('p', 'hint', '发布确认失败后，可新建草稿再次准备内容。'));
      $('#jobs-list').append(card);
    }
    if (!$('#jobs-list').childElementCount) empty('#jobs-list', '暂无操作记录。发布和评论回复的结果会保存在这里。');
  }
  function addVideo(item, target, allowActions) {
    const card = node('article', 'record'); const id = item.item_id || item.itemId || item.id;
    card.append(node('strong', '', item.title || item.text || '作品'), node('p', 'muted', `Item ID：${id || '接口未返回'}`));
    if (item.nickname) card.append(node('p', 'muted', item.nickname));
    if (item.create_time || item.createdAt) card.append(node('p', 'muted', date(item.create_time || item.createdAt)));
    const stats = node('dl'); const source = item.statistics || item;
    for (const [field, label] of [['play_count', '播放'], ['digg_count', '点赞'], ['comment_count', '评论'], ['share_count', '分享']]) {
      if (source[field] !== undefined && source[field] !== null) { const group = node('div'); group.append(node('dt', '', label), node('dd', '', source[field])); stats.append(group); }
    }
    if (stats.childElementCount) card.append(stats);
    if (item.link) { try { const link = new URL(item.link); if (link.protocol === 'https:' && !link.username && !link.password && /(^|\.)douyin\.com$/.test(link.hostname)) card.append(actionButton('打开作品 ↗', async () => { notify('作品入口已准备好。'); await openTarget({ url: link.href, ...(account()?.browserProfileId ? { browserProfileId: account().browserProfileId } : {}) }); })); } catch { /* Ignore malformed upstream links. */ } }
    if (allowActions && id) {
      const buttons = node('div', 'actions');
      buttons.append(actionButton('读取数据', async () => {
        const result = await action('video-data', { accountId: requireAccount(), itemIds: [id] });
        const details = node('details'); details.open = true; details.append(node('summary', '', '作品数据'), node('pre', '', JSON.stringify(result.list, null, 2))); card.querySelector('details')?.remove(); card.append(details);
      }), actionButton('查看评论', async () => { $('#comment-item').value = id; view('comments'); await loadComments(false); })); card.append(buttons);
    }
    $(target).append(card);
  }
  async function loadVideos(more = false) {
    requireAccount(); if (!more) { empty('#videos-list', '正在读取作品…'); $('#more-videos').hidden = true; }
    let result; try { result = await action('list-videos', { accountId, count: 20, ...(more ? { cursor: videoPage.cursor } : {}) }); }
    catch (error) { if (!more) empty('#videos-list', '未能读取作品，请查看上方提示。'); throw error; }
    if (!more) $('#videos-list').replaceChildren(); result.list.forEach(item => addVideo(item, '#videos-list', true)); videoPage = result;
    $('#more-videos').hidden = !result.has_more; if (!$('#videos-list').childElementCount) empty('#videos-list', '官方 API 未返回作品。');
  }
  async function loadComments(more = false) {
    const itemId = more ? commentItem : $('#comment-item').value.trim();
    requireAccount(); if (!more) { empty('#comments-list', '正在读取评论…'); $('#more-comments').hidden = true; }
    let result; try { result = await action('list-comments', { accountId, itemId, count: 20, ...(more ? { cursor: commentPage.cursor } : {}) }); }
    catch (error) { if (!more) empty('#comments-list', '未能读取评论，请查看上方提示。'); throw error; }
    commentItem = itemId; if (!more) $('#comments-list').replaceChildren();
    for (const item of result.list) {
      const id = item.comment_id || item.commentId || item.id, card = node('article', 'record');
      card.append(node('strong', '', item.user?.nickname || item.nickname || '评论'), node('p', 'body', item.content || item.text || ''));
      if (id) {
        const form = node('form'), fieldset = node('fieldset'), label = node('label', '', '回复内容'), input = node('textarea'); input.rows = 2; input.required = true; input.maxLength = 300;
        const button = node('button', '', '发送回复'); button.type = 'submit'; label.append(input); fieldset.append(label, button); form.append(fieldset);
        form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
          const content = input.value.trim(); if (!content) throw new Error('请先填写回复内容。');
          const key = JSON.stringify(['reply', accountId, itemId, id, content]);
          try { const job = await externalWrite('reply-comment', { accountId: requireAccount(), itemId, commentId: id, content }, key); if (job.status !== 'failed') { input.readOnly = true; button.disabled = true; button.textContent = labels[job.status] || job.status; } }
          catch (error) { if (operations[key]?.status === 'uncertain') { input.readOnly = true; button.disabled = true; button.textContent = '结果待核实'; } throw error; }
        }); }); card.append(form);
      }
      $('#comments-list').append(card);
    }
    commentPage = result; $('#more-comments').hidden = !result.has_more;
    if (!$('#comments-list').childElementCount) empty('#comments-list', '官方 API 未返回评论。');
  }
  async function search(more = false) {
    const input = more ? searchInput : { keyword: $('#search-keyword').value.trim(), deviceId: $('#search-device').value.trim() };
    if (!more) { empty('#search-list', '正在搜索视频…'); $('#more-search').hidden = true; }
    let result; try { result = await action('search-videos', { ...input, count: 20, ...(more ? { cursor: searchPage.cursor, searchId: searchPage.search_id || searchPage.searchId } : {}) }); }
    catch (error) { if (!more) empty('#search-list', '未能完成搜索，请查看上方提示或打开抖音搜索。'); throw error; }
    if (!more) $('#search-list').replaceChildren(); result.list.forEach(item => addVideo(item, '#search-list', false));
    searchInput = input; searchPage = result; $('#more-search').hidden = !result.has_more;
    if (!$('#search-list').childElementCount) empty('#search-list', '官方 API 未返回匹配结果。');
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));
  document.querySelectorAll('[data-refresh], #refresh').forEach(button => button.addEventListener('click', () => run(async () => { await refresh(); notify('已刷新本地状态。'); })));
  document.querySelectorAll('[data-browser]').forEach(button => button.addEventListener('click', () => run(async () => { const target = await action('browser-target', { accountId: accountId || undefined, kind: button.dataset.browser, keyword: $('#search-keyword').value.trim() }); notify('浏览器入口已准备好。'); await openTarget(target); })));
  $('#account').addEventListener('change', event => { const next = event.target.value; event.target.value = accountId; run(async () => {
    if (dirty) await saveDraft(); accountId = next; draftId = ''; render(); loadDraft(state.drafts.find(item => item.accountId === next)?.id);
    videoPage = commentPage = undefined; $('#more-videos').hidden = $('#more-comments').hidden = true;
    empty('#videos-list', '账号已切换，点击「读取作品」获取数据。'); empty('#comments-list', '账号已切换，请重新选择作品。'); $('#comment-item').value = '';
  }); });
  $('#draft-picker').addEventListener('change', event => { const next = event.target.value; event.target.value = draftId; run(async () => { if (dirty) await saveDraft(); loadDraft(next); }); });
  $('#new-draft').addEventListener('click', () => run(async () => { if (dirty) await saveDraft(); loadDraft(); $('#draft-title').focus(); }));
  $('#draft-form').addEventListener('input', markDirty); $('#draft-asset').addEventListener('change', markDirty);
  $('#draft-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { await saveDraft(); notify('草稿已保存。'); }); });
  $('#settings-form').addEventListener('submit', event => { event.preventDefault(); const settings = Object.fromEntries(new FormData(event.target)); run(async () => {
    await request('/api/settings', { method: 'POST', body: JSON.stringify(settings) });
    $('#client-secret').value = ''; await refresh(); notify('应用配置已保存。');
  }); });
  $('#start-authorization').addEventListener('click', () => run(async () => { const target = await action('start-authorization'); notify('官方授权入口已准备好。'); await openTarget(target); }));
  $('#authorization-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    await action('finish-authorization', { callbackUrl: $('#callback-url').value.trim() }); $('#callback-url').value = ''; await refresh(); notify('账号授权完成。');
  }); });
  async function attachAsset(asset) { state.assets = [asset, ...state.assets.filter(item => item.id !== asset.id)]; renderDraftPicker(); $('#draft-asset').value = asset.id; markDirty(); notify('视频已导入并关联到当前草稿，请保存。'); }
  $('#media-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { const { asset } = await action('import-media', { sourcePath: $('#media-path').value.trim() }); await attachAsset(asset); $('#media-path').value = ''; }); });
  $('#media-file').addEventListener('change', event => { const file = event.target.files[0]; if (!file) return; run(async () => {
    if (file.size > 128 * 1024 * 1024) throw new Error('视频超过 128 MiB，请压缩后再导入。');
    const { asset } = await request('/api/media', { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'X-File-Name': encodeURIComponent(file.name) }, body: file }); await attachAsset(asset); event.target.value = '';
  }); });
  $('#ai-draft').addEventListener('click', () => run(async () => {
    const draft = await saveDraft(); await getHost();
    const prompt = `请为抖音视频起草中文文案，先调用 ipollowork_extension_list_actions 查看 douyin-ops 的操作契约。当前已保存草稿：${JSON.stringify({ id: draft.id, accountId: draft.accountId, title: draft.title, text: draft.text, assetId: draft.assetId })}。请在当前会话完成文案后，调用 ipollowork_extension_call，extensionId="douyin-ops"，action="save-draft"，args 使用同一个 id 和 accountId，保留原 assetId，写入 title 与 text。仅更新这份草稿，不发布视频、不回复评论、不读取凭证。保存后简要告知用户回运营台点击刷新即可查看。`;
    const result = await hostRequest('ui/message', { role: 'user', content: [{ type: 'text', text: prompt }] }); if (result?.isError) throw new Error('当前会话未接收起草请求，请在会话空闲后重试。');
    notify('已请当前 AI 会话起草文案。完成后点击刷新查看保存结果。');
  }));
  $('#publish-draft').addEventListener('click', () => run(async () => { const draft = await saveDraft(); await externalWrite('publish-draft', { accountId: requireAccount(), draftId: draft.id }, publishKey()); await refresh(); }));
  $('#load-videos').addEventListener('click', () => run(() => loadVideos(false))); $('#more-videos').addEventListener('click', () => run(() => loadVideos(true)));
  $('#comments-form').addEventListener('submit', event => { event.preventDefault(); run(() => loadComments(false)); }); $('#more-comments').addEventListener('click', () => run(() => loadComments(true)));
  $('#search-form').addEventListener('submit', event => { event.preventDefault(); run(() => search(false)); }); $('#more-search').addEventListener('click', () => run(() => search(true)));
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  run(refresh);
})();
