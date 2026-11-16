import { chmod, mkdir, readdir } from 'node:fs/promises';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import { t } from '../shared/i18n.mjs';

const SILENT_LOGGER = Object.freeze({
  level: 'silent',
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() { return this; },
});
const APPEND_RECENT_GRACE_MS = 60_000;

function abortError() {
  return Object.assign(new Error('WhatsApp connection was cancelled'), { name: 'AbortError' });
}

function disconnectStatus(error) {
  return error?.output?.statusCode ?? error?.data?.statusCode ?? error?.statusCode ?? null;
}

function messageTimestampMs(value) {
  let seconds = value;
  if (typeof seconds === 'string') {
    if (!/^\d+$/.test(seconds)) return null;
    seconds = Number(seconds);
  } else if (typeof seconds === 'bigint') {
    seconds = Number(seconds);
  } else if (seconds && typeof seconds === 'object') {
    seconds = Number(seconds.valueOf());
  }
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

async function hardenAuthDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter((entry) => entry.isFile())
    .map((entry) => chmod(`${path}/${entry.name}`, 0o600).catch(() => undefined)));
}

function normalizeIdentity(socket, authState) {
  const source = socket.user ?? authState.creds.me;
  const accountJid = jidNormalizedUser(source?.id);
  if (!/^\d{5,32}@(s\.whatsapp\.net|lid)$/.test(accountJid ?? '')) {
    throw new Error('WhatsApp did not return a valid linked account');
  }
  return {
    accountJid,
    name: typeof source?.name === 'string' && source.name.trim()
      ? source.name.trim().slice(0, 100) : t('WhatsApp机器人'),
  };
}

export async function createWhatsappWebSession({
  authDir,
  onQr,
  onMessage,
  onDisconnect,
  signal,
  logger = console,
  makeSocket = makeWASocket,
  loadAuthState = useMultiFileAuthState,
} = {}) {
  if (!authDir || typeof onQr !== 'function') {
    throw new TypeError('WhatsApp Web session requires an auth directory and QR callback');
  }
  await hardenAuthDirectory(authDir);
  const sessionStartedAt = Date.now();
  const { state, saveCreds } = await loadAuthState(authDir);
  const originalKeySet = state.keys.set.bind(state.keys);
  state.keys.set = async (data) => {
    await originalKeySet(data);
    await hardenAuthDirectory(authDir);
  };

  let closed = false;
  let readySettled = false;
  let resolveReady;
  let rejectReady;
  let saveQueue = Promise.resolve();
  let socket = null;
  let socketGeneration = 0;
  let restartTask = null;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const settleFailure = (error) => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(error);
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    socketGeneration += 1;
    settleFailure(abortError());
    await restartTask?.catch(() => undefined);
    await saveQueue.catch(() => undefined);
    await socket?.end(undefined).catch(() => undefined);
  };
  const logout = async () => {
    if (closed) return;
    closed = true;
    socketGeneration += 1;
    settleFailure(abortError());
    await restartTask?.catch(() => undefined);
    await saveQueue.catch(() => undefined);
    await socket?.logout('Removed from DeepSeek Harness').catch(() => undefined);
  };

  const startSocket = () => {
    const generation = ++socketGeneration;
    let connectionOpen = false;
    const nextSocket = makeSocket({
      auth: state,
      browser: Browsers.macOS('DeepSeek Harness'),
      logger: SILENT_LOGGER,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      getMessage: async () => undefined,
      generateHighQualityLinkPreview: false,
    });
    socket = nextSocket;

    const resolveWhenLinked = () => {
      if (!connectionOpen || !state.creds.me || readySettled) return;
      void saveQueue.then(() => {
        if (closed || readySettled || generation !== socketGeneration
          || !connectionOpen || !state.creds.me) return;
        readySettled = true;
        resolveReady(normalizeIdentity(nextSocket, state));
      }).catch((error) => settleFailure(error));
    };

    nextSocket.ev.on('creds.update', () => {
      if (closed || generation !== socketGeneration) return;
      saveQueue = saveQueue.then(async () => {
        await saveCreds();
        await hardenAuthDirectory(authDir);
      });
      saveQueue.catch(() => logger.error?.('[dsh-im:whatsapp] failed to persist linked-device state'));
      resolveWhenLinked();
    });
    nextSocket.ev.on('connection.update', (update) => {
      if (closed || generation !== socketGeneration) return;
      if (typeof update.qr === 'string' && update.qr) onQr(update.qr);
      if (update.connection === 'open') {
        connectionOpen = true;
        resolveWhenLinked();
      }
      if (update.connection === 'close') {
        const status = disconnectStatus(update.lastDisconnect?.error);
        if (status === DisconnectReason.restartRequired) {
          restartTask ??= saveQueue.then(async () => {
            if (closed || generation !== socketGeneration) return;
            await nextSocket.end(undefined).catch(() => undefined);
            if (closed || generation !== socketGeneration) return;
            startSocket();
          }).catch((error) => settleFailure(error)).finally(() => {
            restartTask = null;
          });
          return;
        }
        const loggedOut = status === DisconnectReason.loggedOut;
        const error = Object.assign(new Error(loggedOut
          ? 'WhatsApp linked device was removed from the phone'
          : 'WhatsApp Web connection closed'), { code: loggedOut ? 'logged-out' : 'connection-closed' });
        if (!readySettled) settleFailure(error);
        else onDisconnect?.({ error, loggedOut });
      }
    });
    nextSocket.ev.on('messages.upsert', ({ messages, type }) => {
      if (closed || generation !== socketGeneration
        || (type !== 'notify' && type !== 'append') || typeof onMessage !== 'function') return;
      for (const message of Array.isArray(messages) ? messages : []) {
        if (type === 'append') {
          const timestamp = messageTimestampMs(message?.messageTimestamp);
          if (timestamp === null || timestamp < sessionStartedAt - APPEND_RECENT_GRACE_MS) continue;
        }
        Promise.resolve(onMessage(message, { socket: nextSocket })).catch(() => {
          logger.error?.('[dsh-im:whatsapp] failed to process an inbound WhatsApp message');
        });
      }
    });
  };

  startSocket();

  if (signal) {
    if (signal.aborted) await close();
    else signal.addEventListener('abort', () => void close(), { once: true });
  }
  return Object.freeze({
    get socket() { return socket; },
    ready,
    close,
    logout,
  });
}
