(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  const $ = selector => document.querySelector(selector);
  const state = { connection: null, drafts: { totalCount: 0, itemCount: 0, items: [] } };
  let selectedMediaId = '';
  let selectedIndex = 0;
  let dirty = false;
  let followersCursor = '';

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('本地服务返回了无法识别的结果。'); }
    if (!response.ok) throw new Error(payload.error || '操作失败，请稍后重试。');
    return payload.result;
  }
  const action = (name, args = {}) => request(`/api/actions/${name}`, { method: 'POST', body: JSON.stringify(args) });
  function node(tag, className = '', value = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined && value !== null) element.textContent = String(value);
    return element;
  }
  function notify(message, error = false) {
    const feedback = $('#feedback');
    feedback.textContent = message; feedback.classList.toggle('error', error); feedback.hidden = false;
    clearTimeout(notify.timer); notify.timer = setTimeout(() => { feedback.hidden = true; }, error ? 9000 : 4500);
  }
  async function run(task, success) {
    document.body.dataset.busy = 'true';
    try { const value = await task(); if (success && value !== false) notify(success); return value; }
    catch (error) { notify(error instanceof Error ? error.message : '操作失败，请稍后重试。', true); }
    finally { document.body.dataset.busy = 'false'; }
  }
  function view(name) {
    document.querySelectorAll('.view').forEach(item => { item.hidden = item.id !== `view-${name}`; });
    document.querySelectorAll('[data-view]').forEach(button => {
      if (button.closest('nav')) button.setAttribute('aria-current', button.dataset.view === name ? 'page' : 'false');
    });
    document.querySelector('main')?.scrollIntoView({ block: 'start' });
  }
  function date(value) {
    if (!value) return '时间未知';
    const source = typeof value === 'number' && value < 1e12 ? value * 1000 : value;
    const parsed = new Date(source);
    return Number.isNaN(parsed.getTime()) ? '时间未知' : parsed.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function mediaId(item) { return item.media_id || item.mediaId || ''; }
  function articleOf(item) {
    const content = item?.content || item;
    return content?.news_item?.[0] || content?.newsItem?.[0] || item?.news_item?.[0] || null;
  }
  function titleOf(item) { return articleOf(item)?.title || '未命名图文'; }
  function renderDrafts(target, items, limit) {
    const list = $(target); list.replaceChildren();
    for (const item of items.slice(0, limit)) {
      const button = node('button', `draft-item${mediaId(item) === selectedMediaId ? ' selected' : ''}`);
      button.type = 'button';
      button.append(node('strong', '', titleOf(item)), node('span', '', mediaId(item) || '未返回 Media ID'), node('small', '', date(item.update_time || item.updatedAt)));
      button.addEventListener('click', () => run(async () => { view('drafts'); await loadDraft(mediaId(item)); }));
      list.append(button);
    }
    if (!list.childElementCount) list.append(node('p', 'empty', '草稿箱还是空的，创建第一篇图文吧。'));
  }
  function renderState() {
    const connected = Boolean(state.connection?.connected);
    $('#connection').className = `connection ${connected ? 'connected' : 'error'}`;
    $('#connection').lastChild.textContent = connected ? '已连接' : '连接异常';
    $('#account-id').textContent = state.connection?.account?.appId || '未连接';
    $('#draft-total').textContent = String(state.drafts.totalCount ?? 0);
    $('#draft-count').textContent = String(state.drafts.itemCount ?? state.drafts.items.length);
    $('#service-state').textContent = connected ? '运行正常' : '需要检查';
    $('#plugin-version').textContent = `插件 ${state.connection?.pluginVersion || '—'}`;
    renderDrafts('#recent-drafts', state.drafts.items, 4);
    renderDrafts('#draft-list', state.drafts.items, 20);
  }
  async function refresh() {
    const value = await request('/api/state');
    Object.assign(state, value);
    renderState();
  }

  function setChecked(selector, value) { $(selector).checked = value === true || value === 1; }
  function resetEditor() {
    selectedMediaId = ''; selectedIndex = 0; dirty = false; $('#article-form').reset();
    $('#editor-mode').textContent = '新图文'; $('#save-state').textContent = '尚未保存'; $('#publish-draft').disabled = true;
    $('#content-count').textContent = '0 字符'; renderDrafts('#draft-list', state.drafts.items, 20); $('#article-title').focus();
  }
  function populateEditor(article, id) {
    selectedMediaId = id; selectedIndex = 0; dirty = false;
    $('#article-title').value = article.title || ''; $('#article-author').value = article.author || '';
    $('#article-digest').value = article.digest || ''; $('#article-source').value = article.content_source_url || article.contentSourceUrl || '';
    $('#cover-media-id').value = article.thumb_media_id || article.thumbMediaId || '';
    $('#article-content').value = article.content || '';
    setChecked('#show-cover', article.show_cover_pic ?? article.showCoverPic);
    setChecked('#open-comment', article.need_open_comment ?? article.needOpenComment);
    setChecked('#fans-comment', article.only_fans_can_comment ?? article.onlyFansCanComment);
    $('#editor-mode').textContent = '编辑草稿'; $('#save-state').textContent = '已从公众号读取'; $('#publish-draft').disabled = false;
    $('#content-count').textContent = `${$('#article-content').value.length} 字符`; renderDrafts('#draft-list', state.drafts.items, 20);
  }
  async function loadDraft(id) {
    if (!id) return;
    if (dirty && !confirm('当前有未保存修改，确定切换到其他草稿吗？')) return;
    const result = await action('get-draft', { mediaId: id });
    if (!result.newsItem?.length) throw new Error('这份草稿没有可编辑的图文内容。');
    populateEditor(result.newsItem[0], id);
  }
  function articleInput() {
    return {
      title: $('#article-title').value.trim(), author: $('#article-author').value.trim(),
      digest: $('#article-digest').value.trim(), content: $('#article-content').value,
      contentSourceUrl: $('#article-source').value.trim(), thumbMediaId: $('#cover-media-id').value.trim(),
      showCoverPic: $('#show-cover').checked, needOpenComment: $('#open-comment').checked,
      onlyFansCanComment: $('#fans-comment').checked,
    };
  }
  async function saveArticle() {
    const article = articleInput();
    if (!article.title || !article.content || !article.thumbMediaId) throw new Error('请填写标题、正文和封面 Media ID。');
    if (selectedMediaId) await action('update-draft', { mediaId: selectedMediaId, index: selectedIndex, article });
    else {
      const result = await action('create-draft', { articles: [article] });
      if (!result.mediaId) throw new Error('公众号未返回草稿 Media ID，请先到平台核对草稿箱。');
      selectedMediaId = result.mediaId;
    }
    dirty = false; $('#editor-mode').textContent = '编辑草稿'; $('#save-state').textContent = '已保存到公众号'; $('#publish-draft').disabled = false;
    await refresh();
    return selectedMediaId;
  }
  async function uploadImage(kind) {
    const pathInput = kind === 'cover' ? $('#cover-path') : $('#body-image-path');
    const sourcePath = pathInput.value.trim();
    if (!sourcePath) throw new Error('请先填写工作区内的图片相对路径。');
    const result = await action(kind === 'cover' ? 'upload-cover-image' : 'upload-article-image', { sourcePath });
    if (kind === 'cover') {
      if (!result.mediaId) throw new Error('公众号未返回封面 Media ID。');
      $('#cover-media-id').value = result.mediaId;
    } else {
      if (!result.url) throw new Error('公众号未返回正文图片 URL。');
      const editor = $('#article-content');
      const snippet = `<p><img src="${result.url}" alt="" /></p>`;
      editor.setRangeText(snippet, editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    pathInput.value = ''; dirty = true;
  }

  function publishStatusLabel(status) {
    return ({ 0: '发布成功', 1: '发布中', 2: '原创失败', 3: '常规失败', 4: '平台审核不通过', 5: '成功后被删除', 6: '成功后被作者删除' })[status] || `未知状态 ${status}`;
  }
  function renderResult(target, value) {
    const box = $(target); box.hidden = false; box.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }

  function commentId(item) { return Number(item.user_comment_id ?? item.userCommentId ?? item.id); }
  function renderComments(result) {
    const list = $('#comments-list'); list.replaceChildren();
    $('#comment-summary').textContent = `共 ${result.totalCount ?? result.commentList.length} 条评论，本页 ${result.commentList.length} 条`;
    for (const item of result.commentList) {
      const id = commentId(item); const card = node('article', 'record'); const header = node('header');
      header.append(node('strong', '', item.openid || item.openId || '微信用户'), node('span', '', date(item.create_time || item.createTime)));
      card.append(header, node('p', 'body', item.content || '（无文本内容）'));
      const actions = node('div', 'record-actions');
      const featured = Boolean(item.is_elected ?? item.featured); const feature = node('button', 'button quiet', featured ? '取消精选' : '设为精选');
      feature.type = 'button'; feature.addEventListener('click', () => run(async () => {
        if (!confirm(`确定${featured ? '取消精选' : '将这条评论设为精选'}吗？`)) return false;
        await action('set-comment-featured', { ...currentCommentTarget(), userCommentId: id, featured: !featured }); await loadComments();
      }, featured ? '已取消精选。' : '已设为精选。'));
      const remove = node('button', 'button quiet danger', '删除'); remove.type = 'button'; remove.addEventListener('click', () => run(async () => {
        if (!confirm('删除评论后无法恢复，确定继续吗？')) return false;
        await action('delete-comment', { ...currentCommentTarget(), userCommentId: id }); await loadComments();
      }, '评论已删除。'));
      actions.append(feature, remove); card.append(actions);
      if (item.reply?.content) card.append(node('p', 'result-box', `已回复：${item.reply.content}`));
      else {
        const footer = node('footer'); const label = node('label', '', '回复内容'); const input = node('textarea'); input.rows = 2; input.maxLength = 600; input.placeholder = '输入经确认的回复';
        const reply = node('button', 'button secondary', '确认回复'); reply.type = 'button'; reply.addEventListener('click', () => run(async () => {
          const content = input.value.trim(); if (!content) throw new Error('请先填写回复内容。');
          if (!confirm(`确定发送这条回复吗？\n\n${content}`)) return false;
          await action('reply-comment', { ...currentCommentTarget(), userCommentId: id, content }); await loadComments();
        }, '回复已发送。'));
        label.append(input); footer.append(label, reply); card.append(footer);
      }
      list.append(card);
    }
    if (!list.childElementCount) list.append(node('p', 'empty', '这篇文章当前没有可显示的评论。'));
  }
  function currentCommentTarget() {
    const msgDataId = Number($('#comment-msg-id').value); const index = Number($('#comment-index').value);
    if (!Number.isSafeInteger(msgDataId) || msgDataId < 1 || !Number.isInteger(index) || index < 0) throw new Error('请输入有效的文章 ID 和图文序号。');
    return { msgDataId, index };
  }
  async function loadComments() { renderComments(await action('list-comments', { ...currentCommentTarget(), limit: 50 })); }
  async function setCommentState(open) {
    if (!confirm(`确定为这篇文章${open ? '开启' : '关闭'}评论吗？`)) return false;
    await action('set-comment-state', { ...currentCommentTarget(), open });
  }

  function menuValue() {
    let menu; try { menu = JSON.parse($('#menu-json').value); } catch { throw new Error('菜单 JSON 格式不正确。'); }
    if (!menu || typeof menu !== 'object' || Array.isArray(menu) || !Array.isArray(menu.button)) throw new Error('菜单 JSON 必须包含 button 数组。');
    return menu;
  }
  function renderMenuPreview() {
    const preview = $('#menu-preview'); preview.replaceChildren();
    let menu; try { menu = menuValue(); } catch { preview.append(node('span', '', 'JSON 待修正')); return; }
    for (const item of menu.button.slice(0, 3)) preview.append(node('button', '', item.name || '未命名'));
    if (!preview.childElementCount) preview.append(node('span', '', '暂无菜单'));
  }
  async function loadMenu() {
    const result = await action('get-menu');
    const menu = result.menu && Array.isArray(result.menu.button) ? result.menu : { button: Array.isArray(result.button) ? result.button : [] };
    $('#menu-json').value = JSON.stringify(menu, null, 2); renderMenuPreview();
  }

  function renderFollowers(result, append) {
    const list = $('#followers-list'); if (!append) list.replaceChildren();
    for (const openId of result.openIds || []) {
      const row = node('div', 'follower'); row.append(node('code', '', openId));
      const choose = node('button', 'button quiet', '发消息'); choose.type = 'button'; choose.addEventListener('click', () => { $('#message-open-id').value = openId; $('#message-content').focus(); }); row.append(choose); list.append(row);
    }
    if (!list.childElementCount) list.append(node('p', 'empty', '接口没有返回粉丝 OpenID。'));
    followersCursor = result.nextOpenId || '';
    $('#followers-summary').textContent = `共 ${result.total ?? 0} 位，本页 ${result.count ?? result.openIds?.length ?? 0} 位`;
    $('#more-followers').hidden = !followersCursor;
  }
  async function loadFollowers(append = false) { renderFollowers(await action('list-followers', append ? { nextOpenId: followersCursor } : {}), append); }

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));
  $('#refresh').addEventListener('click', () => run(refresh, '数据已刷新。'));
  $('#refresh-drafts').addEventListener('click', () => run(refresh, '草稿箱已刷新。'));
  $('#new-draft').addEventListener('click', () => { if (!dirty || confirm('放弃当前未保存修改并新建图文吗？')) resetEditor(); });
  $('#article-form').addEventListener('input', () => { dirty = true; $('#save-state').textContent = '有未保存修改'; });
  $('#article-content').addEventListener('input', event => { $('#content-count').textContent = `${event.target.value.length} 字符`; });
  $('#article-form').addEventListener('submit', event => { event.preventDefault(); run(saveArticle, '草稿已保存到公众号。'); });
  $('#upload-cover').addEventListener('click', () => run(() => uploadImage('cover'), '封面已上传并填入 Media ID。'));
  $('#upload-body-image').addEventListener('click', () => run(() => uploadImage('body'), '正文图片已上传并插入。'));
  $('#publish-draft').addEventListener('click', () => run(async () => {
    if (!confirm(`确定将“${$('#article-title').value.trim() || '当前图文'}”提交到公众号发布队列吗？`)) return false;
    const id = await saveArticle(); const result = await action('submit-publish', { mediaId: id });
    if (result.publishId) $('#publish-id').value = result.publishId;
    view('overview'); renderResult('#publish-status-result', `已提交发布。Publish ID：${result.publishId || '平台未返回，请到公众号后台核对'}`);
  }, '图文已提交发布，请继续核对发布状态。'));
  $('#publish-status-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const result = await action('get-publish-status', { publishId: $('#publish-id').value.trim() });
    renderResult('#publish-status-result', { 状态: publishStatusLabel(result.publishStatus), ...result });
  }); });
  $('#comments-form').addEventListener('submit', event => { event.preventDefault(); run(loadComments); });
  $('#open-comments').addEventListener('click', () => run(() => setCommentState(true), '评论已开启。'));
  $('#close-comments').addEventListener('click', () => run(() => setCommentState(false), '评论已关闭。'));
  $('#load-menu').addEventListener('click', () => run(loadMenu, '已读取当前菜单。'));
  $('#menu-json').addEventListener('input', renderMenuPreview);
  $('#menu-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const menu = menuValue(); if (!confirm(`即将覆盖公众号当前菜单，共 ${menu.button.length} 个一级菜单。确定继续吗？`)) return false;
    await action('update-menu', { menu });
  }, '公众号菜单已更新。'); });
  $('#load-followers').addEventListener('click', () => run(() => loadFollowers(false)));
  $('#more-followers').addEventListener('click', () => run(() => loadFollowers(true)));
  $('#message-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const openId = $('#message-open-id').value.trim(); const content = $('#message-content').value.trim();
    if (!confirm(`确定向 ${openId} 发送这条客服消息吗？\n\n${content}`)) return false;
    await action('send-customer-text', { openId, content }); $('#message-content').value = '';
  }, '客服消息已发送。'); });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  renderMenuPreview();
  run(refresh);
})();
