// The client owns callback ordering and reconnects. Hooks run immediately;
// rejected hook promises also close this subscription, without adding a queue.
function invoke(callback, value, onError) {
  try {
    const result = callback?.(value);
    if (result && typeof result.then === 'function') Promise.resolve(result).catch(onError);
  } catch (error) {
    onError(error);
  }
}

async function watchInProcessMux({ apiProxy, rpcId, signal, onOpen, onEnvelope }) {
  const controller = new AbortController();
  const close = () => controller.abort(signal.reason);
  let iterator;
  let pending;
  let failure;
  const fail = (error) => {
    if (controller.signal.aborted) return;
    failure = error;
    close();
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    iterator = apiProxy.events.mux({ rpcId, payload: {} }, controller.signal)[Symbol.asyncIterator]();
    // mux registers listeners eagerly, but its generator installs abort/finally
    // cleanup only on the first next(). Start it even if mux itself aborted us.
    pending = Promise.resolve(iterator.next());
    if (!controller.signal.aborted) invoke(onOpen, close, fail);
    while (!controller.signal.aborted) {
      const { value, done } = await pending;
      if (done || controller.signal.aborted) break;
      invoke(onEnvelope, {
        type: 'server-request',
        rpcId: value?.rpcId,
        method: value?.payload?.type,
        payload: value?.payload,
      }, fail);
      if (!controller.signal.aborted) pending = Promise.resolve(iterator.next());
    }
  } catch (error) {
    fail(error);
  } finally {
    const cancelled = controller.signal.aborted;
    signal.removeEventListener('abort', close);
    // return() alone cannot wake an idle generator's pending next(). Abort
    // first, then drain that read and return (discarding any queued replay).
    close();
    await pending?.catch(() => undefined);
    try {
      await iterator?.return?.();
    } catch (error) {
      if (!cancelled) failure ??= error;
    }
  }
  if (failure) throw failure;
}

function watchWebSocketMux({ baseUrl, createWebSocket, signal, onOpen, onEnvelope, onMalformed }) {
  const url = new URL('/api/events.mux', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise((resolve, reject) => {
    const socket = createWebSocket(url.toString());
    let opened = false;
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleError);
      signal.removeEventListener('abort', handleAbort);
      try {
        if (socket.readyState === 0 || socket.readyState === 1) socket.close();
      } catch {
        // Some implementations reject closing while still connecting.
      }
      if (error && !signal.aborted) reject(error);
      else resolve();
    };
    const close = () => finish();
    const handleOpen = () => {
      if (finished || opened) return;
      opened = true;
      invoke(onOpen, close, finish);
    };
    const handleMessage = (event) => {
      if (finished) return;
      let envelope;
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame');
        envelope = JSON.parse(event.data);
      } catch (error) {
        invoke(onMalformed, error, () => undefined);
        return;
      }
      invoke(onEnvelope, envelope, finish);
    };
    const handleClose = () => finish(opened ? undefined : Object.assign(new Error(
      'Harness event mux WebSocket closed before opening',
    ), { code: 'stream-closed-before-open' }));
    const handleError = () => finish(Object.assign(new Error(opened
      ? 'Harness event mux WebSocket failed'
      : 'Harness event mux WebSocket failed before opening'), {
      code: opened ? 'stream-failed' : 'stream-failed-before-open',
    }));
    const handleAbort = () => finish();
    socket.addEventListener('open', handleOpen);
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('close', handleClose, { once: true });
    socket.addEventListener('error', handleError, { once: true });
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

/** Watch one mux subscription; an explicit URL retains the HTTP/WS transport. */
export async function watchHarnessMux(options) {
  if (options.signal.aborted) return;
  if (options.baseUrl !== undefined && options.baseUrl !== null) {
    return watchWebSocketMux(options);
  }
  return watchInProcessMux(options);
}
