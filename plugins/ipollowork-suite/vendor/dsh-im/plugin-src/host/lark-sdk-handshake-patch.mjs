import { readFile } from 'node:fs/promises';

const PATCHES = [
  {
    label: 'WSClient pending-socket state',
    before: `        this.wsConfig = new WSConfig();
        this.reconnectGeneration = 0;
        this.isConnecting = false;`,
    after: `        this.wsConfig = new WSConfig();
        this.reconnectGeneration = 0;
        this.pendingWsInstance = null;
        this.isConnecting = false;`,
  },
  {
    label: 'WSClient pending-socket registration',
    before: `        if (!wsInstance) {
            return Promise.resolve(false);
        }
        return new Promise((resolve) => {`,
    after: `        if (!wsInstance) {
            return Promise.resolve(false);
        }
        this.pendingWsInstance = wsInstance;
        return new Promise((resolve) => {`,
  },
  {
    label: 'WSClient pending-socket settlement',
    before: `                if (timer)
                    clearTimeout(timer);
                resolve(ok);`,
    after: `                if (timer)
                    clearTimeout(timer);
                if (this.pendingWsInstance === wsInstance)
                    this.pendingWsInstance = null;
                resolve(ok);`,
  },
  {
    label: 'WSClient handshake-timeout listener cleanup',
    before: `                    this.logger.error('[ws]', \`handshake timeout after \${this.handshakeTimeoutMs}ms\`);
                    wsInstance.removeAllListeners();`,
    after: `                    this.logger.error('[ws]', \`handshake timeout after \${this.handshakeTimeoutMs}ms\`);
                    wsInstance.removeAllListeners('open');`,
  },
  {
    label: 'WSClient reconnect generation fences',
    before: `            const tryConnect = () => __awaiter(this, void 0, void 0, function* () {
                this.reconnectInfo.lastConnectTime = Date.now();
                const pullResult = yield this.pullConnectConfig();
                if (!pullResult.ok)
                    return pullResult;
                const connected = yield this.connect();
                if (!connected)
                    return { ok: false, retryable: true };
                this.communicate();
                return { ok: true };
            });`,
    after: `            const tryConnect = () => __awaiter(this, void 0, void 0, function* () {
                if (currentGeneration !== this.reconnectGeneration)
                    return { ok: false, retryable: false, cancelled: true };
                this.reconnectInfo.lastConnectTime = Date.now();
                const pullResult = yield this.pullConnectConfig();
                if (currentGeneration !== this.reconnectGeneration)
                    return { ok: false, retryable: false, cancelled: true };
                if (!pullResult.ok)
                    return pullResult;
                const connected = yield this.connect();
                if (currentGeneration !== this.reconnectGeneration)
                    return { ok: false, retryable: false, cancelled: true };
                if (!connected)
                    return { ok: false, retryable: true };
                this.communicate();
                return { ok: true };
            });`,
  },
  {
    label: 'WSClient initial-connect cancellation fence',
    before: `                try {
                    result = yield tryConnect();
                }
                finally {
                    this.isConnecting = false;
                }
                if (result.ok) {`,
    after: `                try {
                    result = yield tryConnect();
                }
                finally {
                    if (currentGeneration === this.reconnectGeneration) {
                        this.isConnecting = false;
                    }
                }
                if (currentGeneration !== this.reconnectGeneration || result.cancelled) {
                    return;
                }
                if (result.ok) {`,
  },
  {
    label: 'WSClient pending-socket close',
    before: `        const wsInstance = this.wsConfig.getWSInstance();
        if (wsInstance) {`,
    after: `        const pendingWsInstance = this.pendingWsInstance;
        if (pendingWsInstance) {
            this.pendingWsInstance = null;
            pendingWsInstance.removeAllListeners('open');
            try {
                if (force) {
                    pendingWsInstance.terminate();
                }
                else {
                    pendingWsInstance.close();
                }
            }
            catch ( /* best effort */_a) { /* best effort */ }
        }
        const wsInstance = this.wsConfig.getWSInstance();
        if (wsInstance) {`,
  },
  {
    label: 'WSClient idempotent start guard',
    before: `            const { eventDispatcher } = params;
            if (!eventDispatcher) {
                this.logger.warn('[ws]', 'client need to start with a eventDispatcher');
                return;
            }
            // Clear any terminal-error state left over from a previous session so`,
    after: `            const { eventDispatcher } = params;
            if (!eventDispatcher) {
                this.logger.warn('[ws]', 'client need to start with a eventDispatcher');
                return;
            }
            const liveWsInstance = this.wsConfig.getWSInstance();
            if (this.terminalError) {
                this.isConnecting = false;
            }
            if (this.isConnecting ||
                (liveWsInstance && liveWsInstance.readyState !== WebSocket.CLOSED)) {
                this.logger.debug('[ws]', 'start ignored because client is already connecting or connected');
                return;
            }
            // Clear any terminal-error state left over from a previous session so`,
  },
];

function replaceExactlyOnce(source, patch, sourcePath) {
  const matches = source.split(patch.before).length - 1;
  if (matches !== 1) {
    throw new Error(
      `${sourcePath}: expected exactly one reviewed ${patch.label} marker, found ${matches}`,
    );
  }
  return source.replace(patch.before, patch.after);
}

/**
 * Patch @larksuiteoapi/node-sdk 1.73.0's WSClient lifecycle.
 *
 * The vendor client cannot normally close a socket until its WebSocket
 * handshake has opened. Its timeout also removes the socket's `error`
 * listener before terminating it, and the initial connection path can resume
 * after close() and start a zombie reconnect loop. Track and safely terminate
 * the pending socket, retain its error listener, and fence every async initial
 * connection stage with the reconnect generation already maintained by the
 * SDK. Every reviewed source fragment must match exactly once so an SDK source
 * change fails the build instead of silently losing the compatibility fix.
 */
export function patchLarkSdkHandshakeSource(source, sourcePath = 'Lark SDK') {
  return PATCHES.reduce(
    (patched, patch) => replaceExactlyOnce(patched, patch, sourcePath),
    source,
  );
}

export const larkSdkHandshakePatch = {
  name: 'dsh-lark-sdk-websocket-lifecycle-fix',
  setup(build) {
    build.onLoad({ filter: /@larksuiteoapi[\\/]node-sdk[\\/](es|lib)[\\/]index\.js$/ }, async ({ path }) => ({
      contents: patchLarkSdkHandshakeSource(await readFile(path, 'utf8'), path),
      loader: 'js',
    }));
  },
};
