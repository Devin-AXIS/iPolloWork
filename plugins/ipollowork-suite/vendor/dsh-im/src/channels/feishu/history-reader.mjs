import { readNearbyHistory } from './nearby-history.mjs';
import { normalizeExternalText } from './external-consumer.mjs';

function refuse(code) { throw Object.assign(new Error(code), { code }); }
function identifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function check(response) {
  if ([230027, 99991672, 99991679].includes(response?.code)) refuse('history-permission-denied');
  if (response?.code) refuse('history-unavailable');
}

async function checkedSdkRead(operation, signal) {
  let response;
  try { response = await operation(); }
  catch (error) {
    signal?.throwIfAborted();
    if (error?.name === 'AbortError') throw error;
    if (error?.code === 'ABORT_ERR' || error?.code === 'ERR_CANCELED') refuse('cancelled');
    // The SDK rejects HTTP 403 before returning the provider's JSON payload.
    // Never expose its raw Axios error (which can contain credential headers).
    check(error?.response?.data);
    refuse('history-unavailable');
  }
  signal?.throwIfAborted();
  check(response);
  return response;
}

// Application-defined checked read: destination is derived from an authenticated source.
// Lark has Chat/time-range listing and Thread listing, not a native around-message API.
export async function readExternalHistory(client, identity, route, query, signal) {
  if (!route || !identifier(route.messageId) || !identifier(route.conversationId)
    || !identifier(route.actorId) || ['threadId', 'rootId', 'parentId'].some(key => route[key] !== undefined && !identifier(route[key])) || !['group', 'nearby', 'thread'].includes(query?.scope)
    || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 20
    || (query.cursor !== undefined && (typeof query.cursor !== 'string' || !query.cursor || query.cursor.length > 4096)))
    refuse('bad-request');
  if (query.scope === 'nearby' && [query.beforeCount ?? 10, query.afterCount ?? 5]
    .some(value => !Number.isInteger(value) || value < 0 || value > 20)) refuse('bad-request');
  signal?.throwIfAborted();
  const reference = await checkedSdkRead(() => client.im.v1.message.get({ path: { message_id: route.messageId }, params: { with_sender_name: true } }, { signal }), signal);
  signal?.throwIfAborted();
  const source = (Array.isArray(reference?.data?.items) ? reference.data.items : []).find(item => item?.message_id === route.messageId);
  if (!source || source.deleted || source.chat_id !== route.conversationId
    || source.sender?.sender_type !== 'user' || source.sender?.id_type !== 'open_id'
    || source.sender?.id !== route.actorId || (source.thread_id || undefined) !== route.threadId
    || (source.root_id || undefined) !== route.rootId || (source.parent_id || undefined) !== route.parentId)
    refuse('stale-route');
  if (query.scope === 'thread' && !route.threadId) refuse('thread-unavailable');
  signal?.throwIfAborted();
  const seconds = Math.floor(Number(source.create_time) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) refuse('stale-route');
  const readPage = async params => {
    const response = await checkedSdkRead(() => client.im.v1.message.list({ params }, { signal }), signal);
    signal?.throwIfAborted();
    const items = response?.data?.items;
    if (!Array.isArray(items) || items.length > query.limit || typeof response.data.has_more !== 'boolean')
      refuse('history-unavailable');
    const events = [];
    let omitted = 0;
    for (const item of items) {
      if (!item || item.chat_id !== route.conversationId
        || (query.scope === 'thread' && item.thread_id !== route.threadId)) refuse('untrusted-source');
      if (item.deleted || item.msg_type !== 'text' || item.sender?.sender_type !== 'user'
        || item.sender?.id_type !== 'open_id') { ++omitted; continue; }
      if (item.mentions !== undefined && (!Array.isArray(item.mentions) || item.mentions.length > 100)) { ++omitted; continue; }
      let event;
      try { event = normalizeExternalText({ event_id: `history:${item.message_id}`,
        sender: { sender_type: 'user', sender_id: { open_id: item.sender.id }, sender_name: item.sender.sender_name },
        message: { ...item, chat_type: 'group', message_type: item.msg_type, content: item.body?.content,
          mentions: (item.mentions ?? []).map(mention => ({ ...mention, id: { open_id: mention?.id } })) },
      }, identity); } catch (error) {
        if (error?.code !== 'invalid-inbound') throw error;
        ++omitted; continue;
      }
      if (!event) { ++omitted; continue; }
      events.push(event);
    }
    const nextCursor = response.data.has_more ? response.data.page_token : undefined;
    if (response.data.has_more && (typeof nextCursor !== 'string' || !nextCursor || nextCursor.length > 4096))
      refuse('history-unavailable');
    return {events, omitted, hasMore:response.data.has_more, ...(nextCursor ? {nextCursor} : {})};
  };
  if (query.scope === 'nearby') return readNearbyHistory(readPage, route, query, Number(source.create_time));
  if (query.beforeCount !== undefined || query.afterCount !== undefined) refuse('bad-request');
  const page = await readPage({container_id_type:query.scope === 'thread' ? 'thread' : 'chat',
    container_id:query.scope === 'thread' ? route.threadId : route.conversationId,
    sort_type:'ByCreateTimeDesc', page_size:query.limit, with_sender_name:true,
    ...(query.cursor === undefined ? {} : {page_token:query.cursor})});
  return {version:1, scope:query.scope, ...page, coverage:'provider-visible-human-text'};
}
