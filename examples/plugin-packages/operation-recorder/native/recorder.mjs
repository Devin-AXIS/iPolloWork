import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

export function keyboardOperation(event, keys, rightAlt = false) {
  const name = Object.keys(keys).find(name => keys[name] === event.keycode);
  if (!name || /^(?:Ctrl|Alt|Shift|Meta)(?:Right)?$/.test(name)) return undefined;
  const control = /^(?:Backspace|Tab|Enter|Escape|Delete|Insert|Home|End|PageUp|PageDown|Arrow\w+|F\d+|PrintScreen|CapsLock|NumLock|ScrollLock|NumpadEnter)$/.test(name);
  const printable = !control;
  if (printable && (rightAlt || event.ctrlKey && event.altKey || !event.ctrlKey && !event.altKey && !event.metaKey)) return { action: 'input' };
  if ((name === 'V' && (event.ctrlKey !== event.metaKey) && !event.altKey) || name === 'Insert' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) return { action: 'input', paste: true };
  if (printable && !/^[A-Z0-9]$/.test(name) && name !== 'Space') return { action: 'input' };
  const modifiers = [['ctrlKey', 'CTRL'], ['altKey', 'ALT'], ['metaKey', 'META'], ['shiftKey', 'SHIFT']].filter(([field]) => event[field]).map(([, name]) => name);
  return { action: 'key', key: [...modifiers, name === 'NumpadEnter' ? 'ENTER' : name.toUpperCase()].join('+') };
}

export class Recording {
  constructor(emit, stop, now = Date.now) {
    this.emit = emit; this.stop = stop; this.now = now;
    this.pauses = []; this.paused = false; this.stopped = false;
    this.lastInput = ''; this.lastScroll = null; this.count = 0;
    this.waitingClick = null; this.clickTimer = null;
    this.focusIdentity = null;
  }
  epoch(at) {
    let epoch = 1;
    for (const interval of this.pauses) {
      if (at < interval.start) break;
      if (interval.end === null || at < interval.end) return 0;
      epoch++;
    }
    return epoch;
  }
  command(command) {
    if (this.stopped) return;
    if (command === 'pause' && !this.paused) {
      if (this.pauses.length >= 1024) { this.emit({ type: 'limit', message: '暂停次数达到上限。' }); this.stop(); return; }
      this.pauses.push({ start: this.now(), end: null }); this.paused = true;
      this.lastInput = ''; this.emit({ type: 'state', status: 'paused' });
    } else if (command === 'resume' && this.paused) {
      this.pauses.at(-1).end = this.now(); this.paused = false;
      this.lastInput = ''; this.lastScroll = null; this.emit({ type: 'state', status: 'recording' });
    } else if (command === 'stop') this.stop();
  }
  flushClick() {
    clearTimeout(this.clickTimer); this.clickTimer = null;
    const pending = this.waitingClick; this.waitingClick = null;
    if (pending) this.append(pending.step);
  }
  observe(operation) {
    if (this.stopped || !this.epoch(operation.observedAt)) return;
    const { action, observedAt, snapshot, key, direction } = operation;
    if (action === 'focus') {
      const identity = JSON.stringify([snapshot.app, snapshot.window, snapshot.page?.title || snapshot.window]);
      if (identity === this.focusIdentity) return;
      this.focusIdentity = identity;
    }
    const step = { id: randomUUID(), at: new Date(observedAt).toISOString(), action,
      ...(snapshot.app ? { app: snapshot.app } : {}), ...(snapshot.bundleId ? { bundleId: snapshot.bundleId } : {}),
      ...(snapshot.window ? { window: snapshot.window } : {}), ...(snapshot.page ? { page: snapshot.page } : {}),
      target: snapshot.target || { role: 'unknown' }, ...(key ? { key } : {}), ...(direction ? { direction } : {}),
      ...(snapshot.secret ? { secret: true } : {}) };
    if (action === 'input') {
      if (!snapshot.writable && step.target.role !== 'unknown') return;
      const identity = JSON.stringify([step.app, step.window, step.page, step.target]);
      if (!operation.paste && identity === this.lastInput) return;
      this.lastInput = identity;
      if (step.target.role === 'unknown') step.secret = true;
    } else this.lastInput = '';
    if (action === 'key' && snapshot.secret && /^[A-Z0-9]$/.test(key?.split('+').at(-1))) return;
    if (action === 'scroll') {
      const identity = JSON.stringify([step.app, step.window, step.target, direction]);
      if (this.lastScroll?.identity === identity && observedAt - this.lastScroll.at < 800) return;
      this.lastScroll = { identity, at: observedAt };
    }
    if (action === 'click' && key !== 'RIGHT_CLICK' && key !== 'MIDDLE_CLICK') {
      const identity = JSON.stringify([step.app, step.window, step.target]);
      const waiting = this.waitingClick;
      if (waiting && waiting.identity === identity && this.epoch(observedAt) === this.epoch(Date.parse(waiting.step.at)) && observedAt - Date.parse(waiting.step.at) <= 500 && operation.clicks >= 2) {
        clearTimeout(this.clickTimer); this.waitingClick = null;
        this.append({ ...waiting.step, key: 'DOUBLE_CLICK' }); return;
      }
      this.flushClick();
      this.waitingClick = { identity, step };
      this.clickTimer = setTimeout(() => this.flushClick(), 500);
    } else { this.flushClick(); this.append(step); }
  }
  append(step) {
    if (this.stopped) return;
    if (this.count >= 500) { this.emit({ type: 'limit', message: '录制达到 500 步，请整理或拆分流程。' }); this.stop(); return; }
    this.count++; this.emit({ type: 'step', step });
  }
  close() { this.flushClick(); this.stopped = true; }
}

async function accessibilityWorker() {
  const { createAccessibility } = await import('./accessibility.mjs');
  let adapter;
  try {
    adapter = createAccessibility(process.platform, workerData.requestPermissions);
    parentPort.postMessage({ type: 'capabilities', supported: true, accessibility: true, inputMonitoring: false, backend: adapter.backend, sessionType: process.platform === 'linux' ? 'x11' : 'interactive-desktop', permissionHelp: adapter.permissionHelp });
  } catch (error) {
    parentPort.postMessage({ type: 'capabilities', supported: false, accessibility: false, inputMonitoring: false, reason: error.message });
    parentPort.close(); return;
  }
  parentPort.on('message', message => {
    if (message.type === 'close') { adapter.close(); parentPort.close(); return; }
    try { parentPort.postMessage({ type: 'snapshot', id: message.id, snapshot: adapter.capture(message.event) }); }
    catch (error) { parentPort.postMessage({ type: 'failure', id: message.id, message: error.message }); }
  });
}

export async function run() {
  const worker = new Worker(new URL(import.meta.url), { workerData: { requestPermissions: process.argv.includes('--request-permissions') } });
  const checkOnly = process.argv.includes('--check') || process.argv.includes('--request-permissions');
  const capabilities = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('桌面辅助功能检查超时。')); void worker.terminate(); }, 8000);
    worker.once('message', result => { clearTimeout(timer); resolve(result); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', () => { clearTimeout(timer); reject(new Error('桌面辅助功能进程在初始化完成前退出。')); });
  });
  let hook;
  let running = false;
  try {
    if (!capabilities.supported) {
      process.stdout.write(JSON.stringify(checkOnly ? capabilities : { type: 'error', message: capabilities.reason }) + '\n');
      return;
    }
    const { uIOhook, UiohookKey } = await import('uiohook-napi');
    hook = uIOhook;
    // start() returns after EVENT_HOOK_ENABLED or throws on initialization error.
    hook.start(); running = true; capabilities.inputMonitoring = true;
    if (checkOnly) { process.stdout.write(JSON.stringify(capabilities) + '\n'); return; }
    let stopping = false;
    let sequence = 0;
    let active = null;
    let rightAlt = false;
    const queue = [];
    const emit = event => {
      if (process.stdout.writableLength > 1_048_576) { void shutdown(); return; }
      process.stdout.write(JSON.stringify(event) + '\n');
    };
    const recording = new Recording(emit, () => { void shutdown(); });
    let lastWindow;
    const pump = () => {
      if (active || !queue.length) return;
      const operation = queue.shift();
      active = { ...operation, id: ++sequence, timer: setTimeout(() => { emit({ type: 'error', message: '控件查询超时，录制已停止，请检查最后一步。' }); void shutdown(); }, 1800) };
      worker.postMessage({ id: active.id, event: { ...(operation.point ? { point: operation.point } : {}) } });
    };
    const enqueue = operation => {
      if (stopping || recording.paused) return;
      // Snapshot only semantic events; neither typed characters nor mouse moves
      // enter the worker queue. Coordinates exist transiently for hit-testing.
      if (queue.length >= 256) { emit({ type: 'error', message: '录制事件队列已满，已停止，请检查遗漏步骤。' }); void shutdown(); return; }
      queue.push({ ...operation, observedAt: Date.now() }); pump();
    };
    worker.on('message', message => {
      if (!active || message.id !== active.id) return;
      clearTimeout(active.timer);
      const operation = active; active = null;
      if (message.type === 'failure') { emit({ type: 'error', message: message.message }); void shutdown(); return; }
      const identity = JSON.stringify([message.snapshot.app, message.snapshot.window, message.snapshot.page?.title || message.snapshot.window]);
      if (identity !== lastWindow && operation.action !== 'focus' && recording.epoch(operation.observedAt)) recording.observe({ action: 'focus', observedAt: operation.observedAt, snapshot: message.snapshot });
      lastWindow = identity;
      recording.observe({ ...operation, snapshot: message.snapshot });
      pump();
      if (stopping && !active && !queue.length) recording.close();
    });
    worker.on('error', error => { emit({ type: 'error', message: error.message }); void shutdown(); });
    const onKeyDown = event => {
      if (event.keycode === UiohookKey.AltRight) rightAlt = true;
      const operation = keyboardOperation(event, UiohookKey, rightAlt);
      if (operation) enqueue(operation);
    };
    const onKeyUp = event => { if (event.keycode === UiohookKey.AltRight) rightAlt = false; };
    const onMouse = event => enqueue({ action: 'click', key: event.button === 2 ? 'RIGHT_CLICK' : event.button === 3 ? 'MIDDLE_CLICK' : undefined, clicks: event.clicks, point: { x: event.x, y: event.y } });
    const onWheel = event => enqueue({ action: 'scroll', direction: event.direction === 4 ? event.rotation < 0 ? 'left' : 'right' : event.rotation < 0 ? 'up' : 'down', point: { x: event.x, y: event.y } });
    hook.on('keydown', onKeyDown).on('keyup', onKeyUp).on('mousedown', onMouse).on('wheel', onWheel);
    const focusTimer = setInterval(() => { if (!active && !queue.length) enqueue({ action: 'focus' }); }, 1000);
    let done;
    const finished = new Promise(resolve => { done = resolve; });
    const input = createInterface({ input: process.stdin });
    input.on('line', line => { if (line.length > 4096) { emit({ type: 'error', message: '录制命令过长。' }); void shutdown(); return; } try { recording.command(JSON.parse(line).command); } catch { emit({ type: 'error', message: '录制命令格式无效。' }); void shutdown(); } });
    input.on('close', () => { void shutdown(); });
    const onSignal = () => { void shutdown(); };
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
    async function shutdown() {
      if (stopping) return;
      stopping = true;
      clearInterval(focusTimer);
      hook.removeAllListeners();
      if (running) { running = false; hook.stop(); }
      const deadline = Date.now() + 1500;
      while ((active || queue.length) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      if (active || queue.length) emit({ type: 'error', message: '停止时仍有未完成的控件查询，请检查最后一步。' });
      if (active) clearTimeout(active.timer);
      recording.close();
      input.removeAllListeners('close'); input.close();
      process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
      done();
    }
    enqueue({ action: 'focus' });
    emit({ type: 'ready' });
    await finished;
  } catch (error) {
    process.stdout.write(JSON.stringify(checkOnly ? { ...capabilities, supported: false, inputMonitoring: false, reason: error.message } : { type: 'error', message: error.message }) + '\n');
  } finally {
    if (running) hook.stop();
    worker.postMessage({ type: 'close' });
    const timer = setTimeout(() => { void worker.terminate(); }, 300);
    worker.once('exit', () => clearTimeout(timer));
  }
}

if (!isMainThread) await accessibilityWorker();
else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await run(); }
  catch (error) { process.stdout.write(JSON.stringify(process.argv.includes('--check') || process.argv.includes('--request-permissions') ? { supported: false, accessibility: false, inputMonitoring: false, reason: error.message } : { type: 'error', message: error.message }) + '\n'); process.exitCode = 1; }
}
