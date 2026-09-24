(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const state = { accounts: [], drafts: [], assets: [], jobs: [], videos: [], comments: [] };
  let accountId = '', draftId = '', editingAccountId = '', connectingAccountId = '', dirty = false, busy = false, hostPromise;
  let hostAvailable = false, notificationTimer, connectionRefreshPending = false, connectedNotification = '';
  const requests = new Map(), disabled = new Map();
  let requestId = 0;
  const hash = new URLSearchParams(location.hash.slice(1));
  let token = hash.get('token') || '';
  try { if (token) sessionStorage.setItem('channels-ops-token', token); else token = sessionStorage.getItem('channels-ops-token') || ''; } catch { /* Current launch token remains usable. */ }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const labels = { prepared: '已准备 · 未执行', running: '正在执行', submitting: '正在提交', submitted: '已提交', reviewing: '审核中',
    published: '已发布', replied: '已回复', uncertain: '待核对', blocked: '已暂停', failed: '失败', cancelled: '已取消', succeeded: '已完成' };
  const types = { publish: '视频发布', 'sync-videos': '作品与数据同步', 'sync-comments': '读取评论', reply: '评论回复' };
  const currentAccount = () => state.accounts.find(item => item.id === accountId);
  const items = kind => state[kind].filter(item => item.accountId === accountId);
  const fmtDate = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '尚未同步';
  const node = (tag, className, value) => { const el = document.createElement(tag); if (className) el.className = className; if (value !== undefined) el.textContent = value; return el; };
  const set = (selector, value) => { $(selector).textContent = value; };
  function notify(message, error = false) {
    if ($('#accounts-dialog').open && !$('#prompt-dialog').open) {
      const el = $('#account-feedback'); el.hidden = false; el.classList.toggle('error', error); el.textContent = message; return;
    }
    clearTimeout(notificationTimer); const el = $('#feedback'); el.hidden = false; el.classList.toggle('error', error); el.textContent = message;
    notificationTimer = setTimeout(() => { el.hidden = true; }, error ? 14000 : 6500);
  }
  function badge(status, label) {
    const style = ['uncertain', 'blocked', 'submitting', 'reviewing', 'connecting'].includes(status) ? 'warning'
      : ['failed', 'mismatch', 'conflict'].includes(status) ? 'danger' : ['succeeded', 'published', 'replied', 'verified'].includes(status) ? 'success' : 'neutral';
    return node('span', `badge ${style}`, label || labels[status] || status);
  }
  function button(label, fn, className = '') { const el = node('button', className, label); el.type = 'button'; el.addEventListener('click', () => run(fn)); return el; }
  function empty(container, title, detail, icon = '▤') {
    const el = node('div', 'empty-state'); el.append(node('span', '', icon), node('h3', '', title), node('p', '', detail)); container.replaceChildren(el);
  }
  function selectOptions(selector, list, placeholder, selected) {
    const el = $(selector); el.replaceChildren(); if (placeholder) el.add(new Option(placeholder, ''));
    list.forEach(item => el.add(new Option(item.label, item.id))); el.value = selected || '';
  }
  async function request(path, options = {}) {
    if (!token) throw new Error('请使用本地启动时提供的完整页面地址。');
    const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(180000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '操作失败，请刷新后重试');
    return result;
  }
  const action = (name, input = {}) => request(`/api/actions/${name}`, { method: 'POST', body: JSON.stringify(input) });
  function controls() {
    $('#prepare-publish').disabled = busy || !accountId || !$('#draft-asset').value;
    $('#save-draft').disabled = busy || !accountId;
    $('#ai-draft').disabled = busy || !accountId;
    $('#ai-review').disabled = busy || !accountId;
    $('#sync-comments').disabled = busy || !$('#comment-video').value;
    document.querySelectorAll('[data-sync]').forEach(el => { el.disabled = busy || !accountId; });
  }
  async function run(fn) {
    if (busy) return;
    busy = true; document.body.setAttribute('aria-busy', 'true');
    document.querySelectorAll('button,input,select,textarea').forEach(el => { disabled.set(el, el.disabled); el.disabled = true; });
    try { await fn(); } catch (error) { notify(error.message || '连接失败，请检查本地服务', true); }
    finally { busy = false; document.body.setAttribute('aria-busy', 'false'); disabled.forEach((value, el) => { el.disabled = value; }); disabled.clear(); controls(); }
  }
  function view(name) {
    if (name === 'accounts') {
      renderAccounts();
      showConnectPanel(accountId);
      $('#account-feedback').hidden = true;
      $('#accounts-dialog').showModal(); return;
    }
    document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `view-${name}`; });
    document.querySelectorAll('.tabs [data-view]').forEach(el => { if (el.dataset.view === name) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  }
  function canDiscard() { return !dirty || window.confirm('这条草稿有未保存的修改，放弃修改并继续？'); }
  function loadDraft(id = '') {
    const draft = items('drafts').find(item => item.id === id);
    draftId = draft?.id || ''; dirty = false;
    $('#draft-title').value = draft?.title || ''; $('#draft-description').value = draft?.description || '';
    $('#draft-topics').value = draft?.topics || ''; $('#draft-asset').value = draft?.assetId || ''; $('#draft-cover').value = draft?.coverId || '';
    set('#draft-status', draft ? `本地草稿 · v${draft.revision}` : '尚未保存');
    set('#save-state', draft ? `已保存 · ${fmtDate(draft.updatedAt)}` : '草稿仅保存在本地');
    renderDrafts(); preview(); controls();
  }
  function markDirty() { dirty = true; set('#save-state', '有未保存的修改'); preview(); controls(); }
  async function refresh() {
    Object.assign(state, await request('/api/state'));
    if (!accountId) accountId = state.accounts[0]?.id || '';
    render();
    if (connectingAccountId) {
      const account = state.accounts.find(item => item.id === connectingAccountId);
      if (account?.status === 'verified' && connectedNotification !== account.id) {
        accountId = account.id; connectedNotification = account.id;
        notify(`已连接 ${account.observedName || account.name}，账号身份已自动保存。`);
      }
      renderConnectionPanel();
    }
    if (!dirty && draftId) loadDraft(draftId);
  }
  async function saveDraft() {
    if (!accountId) throw new Error('请先添加一个本地账号');
    const { draft } = await action('save-draft', { ...(draftId ? { id: draftId } : {}), accountId,
      title: $('#draft-title').value.trim(), description: $('#draft-description').value, topics: $('#draft-topics').value,
      assetId: $('#draft-asset').value, coverId: $('#draft-cover').value });
    dirty = false; await refresh(); loadDraft(draft.id); return draft;
  }
  function preview() {
    set('#preview-account', currentAccount()?.observedName || currentAccount()?.name || '你的视频号');
    set('#preview-description', $('#draft-description').value || '让一个好想法，从这里开始。');
    set('#preview-topics', $('#draft-topics').value); set('#description-count', `${$('#draft-description').value.length} / 2000`);
    const video = state.assets.find(item => item.id === $('#draft-asset').value), cover = state.assets.find(item => item.id === $('#draft-cover').value);
    const videoEl = $('#preview-video'), image = $('#preview-cover');
    if (video?.previewUrl) { if (videoEl.getAttribute('src') !== video.previewUrl) videoEl.src = video.previewUrl; }
    else if (videoEl.hasAttribute('src')) { videoEl.removeAttribute('src'); videoEl.load(); }
    if (cover?.previewUrl) { image.src = cover.previewUrl; videoEl.poster = cover.previewUrl; } else { image.removeAttribute('src'); videoEl.removeAttribute('poster'); }
    videoEl.hidden = !video; image.hidden = Boolean(video) || !cover; $('#preview-empty').hidden = Boolean(video || cover);
  }
  function renderDrafts() {
    const drafts = items('drafts'); set('#draft-count', drafts.length); set('#recent-count', `${drafts.length} 条`);
    const list = $('#draft-list'); list.replaceChildren();
    for (const draft of drafts.slice(0, 5)) {
      const el = button('', () => { if (canDiscard()) { loadDraft(draft.id); view('studio'); } }, `draft-item${draft.id === draftId ? ' selected' : ''}`);
      const caption = node('span'); caption.append(node('strong', '', draft.title), node('small', '', `本地草稿 · ${fmtDate(draft.updatedAt)}`));
      el.append(node('span', '', '▤'), caption); list.append(el);
    }
    if (!drafts.length) list.append(node('p', 'empty-small', '还没有草稿，写下第一个想法吧。'));
  }
  function editAccount(id = '') {
    const account = state.accounts.find(item => item.id === id); editingAccountId = account?.id || '';
    connectingAccountId = account?.id || '';
    for (const [field, key] of [['name','name'],['channel','channelId'],['positioning','positioning'],['audience','audience'],['tone','tone']]) $(`#account-${field}`).value = account?.[key] || '';
    $('#account-channel').readOnly = Boolean(account?.verifiedAt); set('#account-form-title', account ? '编辑账号资料' : '先填写账号资料');
    $('#account-connect-panel').hidden = true; $('#account-form').hidden = false;
  }
  function showConnectPanel(id = '') {
    connectingAccountId = id;
    $('#account-form').hidden = true; $('#account-connect-panel').hidden = false;
    renderConnectionPanel();
  }
  function renderConnectionPanel() {
    const account = state.accounts.find(item => item.id === connectingAccountId);
    const steps = [...document.querySelectorAll('.connect-steps li')];
    steps.forEach(item => item.classList.remove('active', 'done'));
    let title = '添加视频号账号', description = '为这个视频号创建独立登录会话，扫码成功后自动保存账号身份。';
    let buttonLabel = hostAvailable ? '打开微信扫码' : '主软件中可扫码';
    let support = hostAvailable ? '扫码窗口会使用新的账号专属登录会话。' : '本地预览不会模拟登录；安装到 iPolloWork 后可直接扫码。';
    if (account?.status === 'verified') {
      steps.forEach(item => item.classList.add('done'));
      title = `${account.observedName || account.name} 已连接`;
      description = `视频号 ID：${account.channelId}。账号身份来自视频号助手可见页面。`;
      buttonLabel = '重新打开视频号助手'; support = `最近核验：${fmtDate(account.verifiedAt)}`;
    } else if (account?.status === 'connecting') {
      steps[0].classList.add('done'); steps[1].classList.add('active');
      title = '等待微信扫码确认'; description = '扫码窗口已打开。请使用微信扫码并在手机上确认，完成后这里会自动更新。';
      buttonLabel = '重新打开扫码窗口'; support = '登录完成后无需点击“已登录”，请保持运营台打开。';
    } else if (['mismatch', 'conflict'].includes(account?.status)) {
      steps[0].classList.add('done'); steps[1].classList.add('done'); steps[2].classList.add('active');
      title = '账号身份没有通过核验'; description = account.connectionError || '请重新扫码并确认登录了正确的视频号。';
      buttonLabel = '重新扫码'; support = '原账号资料和已核验身份不会被错误登录覆盖。';
    } else steps[0].classList.add('active');
    set('#connect-title', title); set('#connect-description', description); set('#start-account-connect', buttonLabel); set('#connect-support', support);
  }
  function renderAccounts() {
    set('#account-total', `${state.accounts.length} 个`);
    const list = $('#accounts-list'); list.replaceChildren();
    for (const account of state.accounts) {
      const card = node('article', `record${account.id === accountId ? ' selected' : ''}`), head = node('header');
      const statusLabel = account.status === 'verified' ? '身份已核验' : account.status === 'connecting' ? '等待扫码' : ['mismatch','conflict'].includes(account.status) ? '连接需处理' : '待连接 · 未核验';
      head.append(node('strong', '', account.observedName || account.name), badge(account.status, statusLabel));
      card.append(head, node('p', '', account.channelId ? `视频号 ID：${account.channelId}` : '连接后核验实际视频号身份'),
        node('p', '', account.positioning || '补充账号定位，让后续文案更贴近你的表达。'));
      if (account.verifiedAt) card.append(node('p', '', `最近核验：${fmtDate(account.verifiedAt)}；当前登录状态需在浏览器复核`));
      const actions = node('div', 'actions');
      actions.append(button('编辑资料', () => editAccount(account.id)), button(account.verifiedAt ? '重新登录' : '扫码连接', () => connectAccount(account.id)));
      card.append(actions); list.append(card);
    }
    if (!state.accounts.length) empty(list, '添加你的第一个视频号', '点击“扫码添加账号”，登录成功后自动建立创作空间。', '◎');
  }
  function renderVideos() {
    const videos = items('videos'), list = $('#videos-list'); list.replaceChildren();
    for (const video of videos) {
      const card = node('article', 'record'), header = node('header');
      header.append(node('strong', '', video.title), badge('neutral', video.status)); card.append(header,
        node('p', '', `平台时间：${video.publishedAt || '未获取'} · 同步时间：${fmtDate(video.syncedAt)}`));
      const actions = node('div', 'actions');
      actions.append(button('查看评论', () => { $('#comment-video').value = video.id; renderComments(); view('comments'); }));
      if (video.url) { const link = node('a', '', '打开作品 ↗'); link.href = video.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link); }
      card.append(actions); list.append(card);
    }
    if (!videos.length) empty(list, '作品会从这里开始积累', '连接视频号后同步作品，查看真实的平台状态与表现。');
    const selected = $('#comment-video').value;
    selectOptions('#comment-video', videos.map(item => ({ id: item.id, label: item.title })), '选择已同步作品', selected);
    const definitions = [['plays','播放'],['likes','点赞'],['comments','评论'],['shares','分享'],['favorites','收藏']];
    $('#data-metrics').replaceChildren();
    for (const [key, label] of definitions) {
      const known = videos.filter(video => video.metrics[key] != null), card = node('div', 'metric');
      card.append(node('span', '', label), node('strong', '', known.length ? known.reduce((sum, item) => sum + item.metrics[key], 0).toLocaleString() : '—'), node('small', '', known.length ? `${known.length} / ${videos.length} 条已获取` : '尚未获取'));
      $('#data-metrics').append(card);
    }
    set('#data-updated', currentAccount()?.videosSyncedAt ? `最近同步 ${fmtDate(currentAccount().videosSyncedAt)}` : '尚未同步');
    if (!videos.length) empty($('#data-table'), '先同步，再分析', '这里将展示真实作品数据，不使用示例指标填充。', '▥');
    else {
      const table = node('table'), head = node('thead'), row = node('tr');
      ['作品', ...definitions.map(item => item[1])].forEach(label => row.append(node('th', '', label))); head.append(row); table.append(head);
      const body = node('tbody'); for (const video of videos) { const tr = node('tr'); tr.append(node('td', '', video.title)); definitions.forEach(([key]) => tr.append(node('td', '', video.metrics[key]?.toLocaleString() ?? '—'))); body.append(tr); } table.append(body); $('#data-table').replaceChildren(table);
    }
  }
  function renderComments() {
    const list = $('#comments-list'), comments = items('comments').filter(item => item.videoId === $('#comment-video').value); list.replaceChildren();
    for (const comment of comments) {
      const card = node('article', 'record'), header = node('header'); header.append(node('strong', '', comment.author), node('span', 'subtle', fmtDate(comment.syncedAt)));
      const reply = node('textarea'); reply.rows = 2; reply.maxLength = 1000; reply.placeholder = '写一条有针对性的回复…'; reply.setAttribute('aria-label', `回复 ${comment.author}`);
      const actions = node('div', 'actions'); actions.append(button('准备回复任务', async () => {
        if (!reply.value.trim()) throw new Error('请先填写回复内容');
        const { job } = await action('prepare-job', { accountId, type: 'reply', commentId: comment.id, body: reply.value, operationKey: `reply:${comment.id}` });
        await refresh(); view('jobs'); await executePrompt(job);
      })); card.append(header, node('p', '', comment.body), reply, actions); list.append(card);
    }
    if (!comments.length) empty(list, '有回应，才有更好的连接', '选择自己的作品后读取评论，再为具体评论准备回复。', '☷'); controls();
  }
  function renderJobs() {
    const jobs = items('jobs'), list = $('#jobs-list'); list.replaceChildren();
    for (const job of jobs) {
      const card = node('article', 'record'), header = node('header'); header.append(node('strong', '', job.payload.title || types[job.type]), badge(job.status));
      card.append(header, node('p', '', `${types[job.type]} · ${fmtDate(job.updatedAt)}`));
      if (job.evidence) card.append(node('p', '', job.evidence));
      const detail = node('details'), summary = node('summary', 'subtle', '查看任务内容'); detail.append(summary,
        node('p', '', `任务 ID：${job.id}`), node('p', '', job.payload.description || job.payload.body || '读取当前账号的真实页面记录'));
      card.append(detail); const actions = node('div', 'actions');
      if (job.status === 'prepared') actions.append(button(hostAvailable ? '交给 AI 执行' : '复制执行指令', () => executePrompt(job)), button('取消任务', async () => { await action('cancel-job', { jobId: job.id }); await refresh(); notify('已取消，未执行平台操作。'); }));
      if (['uncertain','blocked','submitted','reviewing'].includes(job.status)) actions.append(button('复制核对指令', () => sendPrompt(`阅读 wechat-channels-ops-worker，核对任务 ${job.id}。重新核验账号 ${job.accountId}，只读检查平台实际结果并 reconcile-job 回写证据，不重新提交。`)));
      card.append(actions); list.append(card);
    }
    if (!jobs.length) empty(list, '每次操作，都清楚可查', '准备发布或同步任务后，执行状态和结果会保存在这里。', '◷');
  }
  function render() {
    selectOptions('#account', state.accounts.map(item => ({ id: item.id, label: item.name })), state.accounts.length ? null : '尚未添加视频号', accountId);
    const account = currentAccount(); set('#account-status', account?.verifiedAt ? '已核验' : '待连接');
    set('#mode-label', hostAvailable ? '已连接会话' : '本地模式');
    $('#onboarding').hidden = Boolean(accountId);
    const selectedVideo = $('#draft-asset').value, selectedCover = $('#draft-cover').value;
    selectOptions('#draft-asset', state.assets.filter(item => item.kind === 'video').map(item => ({ id: item.id, label: item.name })), '或选择已导入的视频', selectedVideo);
    selectOptions('#draft-cover', state.assets.filter(item => item.kind === 'image').map(item => ({ id: item.id, label: item.name })), '使用视频默认封面', selectedCover);
    set('#pending-count', items('jobs').filter(job => ['prepared','running','submitting','uncertain','blocked'].includes(job.status)).length);
    set('#video-count', account?.videosSyncedAt ? items('videos').length : '—');
    set('#sync-caption', account?.videosSyncedAt ? `同步于 ${fmtDate(account.videosSyncedAt)}` : '尚未同步');
    renderDrafts(); renderAccounts(); renderVideos(); renderComments(); renderJobs(); preview(); controls();
    if (!$('#account-connect-panel').hidden) renderConnectionPanel();
  }
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.jsonrpc !== '2.0' || event.data.method) return;
    const pending = requests.get(event.data.id); if (!pending) return;
    requests.delete(event.data.id); clearTimeout(pending.timer);
    event.data.error ? pending.reject(new Error(event.data.error.message)) : pending.resolve(event.data.result);
  });
  function hostRequest(method, params) {
    if (window === parent) return Promise.reject(new Error('当前页面为本地模式'));
    return new Promise((resolve, reject) => {
      const id = ++requestId, timer = setTimeout(() => { requests.delete(id); reject(new Error('主软件会话暂未响应，任务仍保存在本地')); }, 10000);
      requests.set(id, { resolve, reject, timer }); parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  async function connectHost() {
    hostPromise ??= hostRequest('ui/initialize', { protocolVersion: '2025-11-21', appInfo: { name: '视频号运营台', version: '0.1.7' }, appCapabilities: {} }).then(result => {
      if (result?.isError) throw new Error('会话连接未就绪');
      parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*'); hostAvailable = true;
      set('#ai-draft', '✧ AI 起草文案'); set('#ai-review', 'AI 复盘作品'); set('#prepare-publish', '交给 AI 发布 →');
      set('#publish-note', '按当前内容准备任务，并交给会话执行与核对。'); render();
    }).catch(error => { hostPromise = undefined; throw error; });
    return hostPromise;
  }
  async function openTarget(target) {
    await connectHost();
    const result = await hostRequest('ui/open-link', { url: target.url, browserProfileId: target.browserProfileId });
    if (result?.isError) throw new Error('无法打开视频号助手，请更新主软件后重试');
  }
  async function connectAccount(id = '') {
    if (window !== parent && !hostAvailable) await connectHost();
    if (!hostAvailable) {
      showConnectPanel(id);
      throw new Error('扫码连接需要在安装本插件的 iPolloWork 主软件中打开');
    }
    const target = await action('connect-account', id ? { accountId: id } : {});
    accountId = target.account.id; connectingAccountId = target.account.id; connectedNotification = '';
    await refresh(); showConnectPanel(target.account.id);
    await openTarget(target);
    notify('扫码窗口已打开。用微信扫码确认后，账号会自动添加到这里。');
  }
  async function sendPrompt(prompt) {
    if (hostAvailable) { const result = await hostRequest('ui/message', { role: 'user', content: [{ type: 'text', text: prompt }] }); if (result?.isError) throw new Error('当前会话未接收指令，请稍后从记录继续'); notify('已交给当前会话，完成后刷新查看结果。'); }
    else { $('#prompt-content').value = prompt; $('#prompt-dialog').showModal(); }
  }
  async function executePrompt(job) {
    await sendPrompt(`阅读 wechat-channels-ops-worker，执行已准备任务 ${job.id}，账号 ${job.accountId}，类型 ${types[job.type]}。先 get-job 并核对实际账号身份，再领取固定载荷执行。此指令授权执行该任务；若已完成则复用结果，若待核对则只核对，不重新提交。操作编号 ${job.operationKey} 不变。`);
  }
  async function upload(file, kind) {
    if (!file) return;
    const mimeTypes = { mp4: 'video/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    const type = mimeTypes[file.name.split('.').pop().toLowerCase()];
    if (!type || (kind === 'video' ? type !== 'video/mp4' : type === 'video/mp4')) throw new Error('请选择对应格式的素材');
    if (file.size > (kind === 'video' ? 512 : 10) * 1048576) throw new Error('文件超过本地大小限制');
    set('#upload-state', `正在导入 ${file.name}…`);
    try {
      const { asset } = await request('/api/media', { method: 'POST', headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      await refresh(); $(kind === 'video' ? '#draft-asset' : '#draft-cover').value = asset.id; markDirty(); set('#upload-state', `已导入 ${asset.name} · ${(asset.size / 1048576).toFixed(1)} MiB`);
    } catch (error) { set('#upload-state', '素材导入失败，请检查文件后重试。'); throw error; }
  }
  document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => { if (!busy) view(el.dataset.view); }));
  document.querySelectorAll('#refresh,[data-refresh]').forEach(el => el.addEventListener('click', () => run(async () => { await refresh(); notify('已刷新本地记录。'); })));
  $('#new-draft').addEventListener('click', () => { if (!busy && canDiscard()) loadDraft(); });
  $('#account').addEventListener('change', () => { if (!canDiscard()) { $('#account').value = accountId; return; } accountId = $('#account').value; loadDraft(); render(); });
  $('#new-account').addEventListener('click', () => run(() => connectAccount()));
  $('#start-account-connect').addEventListener('click', () => run(() => connectAccount(connectingAccountId)));
  $('#edit-account-locally').addEventListener('click', () => { editAccount(connectingAccountId); $('#account-name').focus(); });
  $('#back-to-connect').addEventListener('click', () => showConnectPanel(editingAccountId));
  $('#close-accounts').addEventListener('click', () => { if (!busy) $('#accounts-dialog').close(); });
  $('#accounts-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('#accounts-dialog').addEventListener('click', event => {
    if (busy || event.target !== $('#accounts-dialog')) return;
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  });
  $('#account-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const { account } = await action('save-account', { ...(editingAccountId ? { id: editingAccountId } : {}), name: $('#account-name').value,
      channelId: $('#account-channel').value, positioning: $('#account-positioning').value, audience: $('#account-audience').value, tone: $('#account-tone').value });
    if (!accountId) accountId = account.id;
    await refresh(); editAccount(account.id); notify(account.verifiedAt ? '账号资料已保存。' : '账号资料已保存，扫码后会自动核验平台身份。');
  }); });
  $('#draft-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { await saveDraft(); notify('草稿已保存在本地。'); }); });
  ['#draft-title','#draft-description','#draft-topics','#draft-asset','#draft-cover'].forEach(selector => $(selector).addEventListener('input', markDirty));
  $('#video-file').addEventListener('change', () => run(() => upload($('#video-file').files[0], 'video')));
  $('#cover-file').addEventListener('change', () => run(() => upload($('#cover-file').files[0], 'image')));
  $('#import-media').addEventListener('click', () => run(async () => {
    const { asset } = await action('import-media', { sourcePath: $('#media-path').value }); await refresh();
    $(asset.kind === 'video' ? '#draft-asset' : '#draft-cover').value = asset.id; markDirty(); notify(`已导入 ${asset.name}`);
  }));
  $('#prepare-publish').addEventListener('click', () => run(async () => {
    const draft = await saveDraft(); const { job } = await action('prepare-job', { accountId, type: 'publish', draftId: draft.id, operationKey: `publish:${draft.id}:v${draft.revision}` });
    await refresh(); view('jobs');
    if (job.status !== 'prepared') notify(`该草稿已有任务：${labels[job.status]}。请查看记录，未重复执行。`);
    else if (hostAvailable) await executePrompt(job); else notify('任务已准备，尚未上传或发布。可复制执行指令，待主软件空闲后继续。');
  }));
  document.querySelectorAll('[data-sync]').forEach(el => el.addEventListener('click', () => run(async () => {
    const { job } = await action('prepare-job', { accountId, type: el.dataset.sync, operationKey: `sync:${crypto.randomUUID()}` });
    await refresh(); view('jobs'); if (hostAvailable) await executePrompt(job); else notify('同步任务已准备，需在主软件会话中执行。');
  })));
  $('#comment-video').addEventListener('change', renderComments);
  $('#sync-comments').addEventListener('click', () => run(async () => {
    const { job } = await action('prepare-job', { accountId, type: 'sync-comments', videoId: $('#comment-video').value, operationKey: `comments:${crypto.randomUUID()}` });
    await refresh(); view('jobs'); if (hostAvailable) await executePrompt(job); else notify('评论读取任务已准备，尚未执行。');
  }));
  $('#ai-draft').addEventListener('click', () => run(async () => {
    const account = currentAccount();
    await sendPrompt(`阅读 wechat-channels-ops-worker，为视频号 ${accountId} 起草内容并通过 save-draft 保存，${draftId ? `更新草稿 ${draftId}` : '新建草稿'}。账号定位：${account.positioning || '参考用户需求'}；受众：${account.audience || '待明确'}；风格：${account.tone || '自然简洁'}。选题：${$('#draft-title').value || '请先结合用户需求确定'}。当前描述：${$('#draft-description').value}。保留现有视频 assetId=${$('#draft-asset').value || '未选择'}、coverId=${$('#draft-cover').value || '未选择'}。只保存草稿，不发布。`);
  }));
  $('#ai-review').addEventListener('click', () => run(() => sendPrompt(`阅读 wechat-channels-ops-worker，使用 studio-state 读取账号 ${accountId} 已同步作品，按数据时间和可见范围进行复盘。缺失指标不当作零，不用无数据内容推断趋势。给出下一周选题建议；只分析，不发布。`)));
  $('#close-prompt').addEventListener('click', () => $('#prompt-dialog').close());
  $('#copy-prompt').addEventListener('click', () => run(async () => { await navigator.clipboard.writeText($('#prompt-content').value); notify('指令已复制。'); }));
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.setInterval(() => {
    if (busy || connectionRefreshPending || !$('#accounts-dialog').open || $('#account-connect-panel').hidden || !connectingAccountId) return;
    const account = state.accounts.find(item => item.id === connectingAccountId);
    if (!account || account.status === 'verified') return;
    connectionRefreshPending = true;
    refresh().catch(() => {}).finally(() => { connectionRefreshPending = false; });
  }, 2500);
  run(async () => { await refresh(); loadDraft(items('drafts')[0]?.id); });
  if (window !== parent) {
    const initializeHost = () => connectHost().catch(() => {
      if (!hostAvailable) window.setTimeout(initializeHost, 1500);
    });
    initializeHost();
  }
})();

