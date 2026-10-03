const STORAGE_KEY = "ipollowork:host-video-deliveries:v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export function pendingVideoDeliveries(raw, now = Date.now()) {
  let entries;
  try {
    entries = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry && typeof entry === "object"
    && typeof entry.workspaceId === "string" && /^ws_[\w-]+$/.test(entry.workspaceId)
    && typeof entry.sessionId === "string" && /^[\w-]+$/.test(entry.sessionId)
    && ["export", "publish-douyin", "publish-wechat-channels"].includes(entry.intent)
    && typeof entry.storedAt === "number" && entry.storedAt <= now
    && now - entry.storedAt <= MAX_AGE_MS);
}

export function deliveryRoute(entry) {
  return `#/workspace/${entry.workspaceId}/session/${entry.sessionId}`;
}

export function createBackgroundVideoDeliverySupervisor({
  getMainWindow,
  createWorkerWindow,
  isReady = async (_entry, _main) => true,
  intervalMs = 4_000,
  log = console,
}) {
  let timer = null;
  let checking = false;
  let worker = null;
  let disposed = false;

  const closeWorker = () => {
    const previous = worker;
    worker = null;
    if (previous?.window && !previous.window.isDestroyed()) previous.window.close();
  };

  const onMainNavigation = (url) => {
    if (worker && url.includes(deliveryRoute(worker.entry))) closeWorker();
  };

  const tick = async () => {
    if (disposed || checking) return;
    const main = getMainWindow();
    if (!main || main.isDestroyed() || main.webContents.isLoading()) return;
    checking = true;
    try {
      const state = await main.webContents.executeJavaScript(`({
        href: location.href,
        deliveries: localStorage.getItem(${JSON.stringify(STORAGE_KEY)})
      })`, true);
      if (disposed || !state || typeof state.href !== "string") return;
      const entries = pendingVideoDeliveries(state.deliveries);
      if (worker) {
        if (worker.window.isDestroyed()
          || !entries.some((entry) => deliveryRoute(entry) === deliveryRoute(worker.entry))
          || state.href.includes(deliveryRoute(worker.entry))) closeWorker();
        else return;
      }
      let next = null;
      for (const entry of entries) {
        if (state.href.includes(deliveryRoute(entry))) continue;
        if (await isReady(entry, main)) {
          next = entry;
          break;
        }
      }
      if (!next) return;
      const window = createWorkerWindow();
      worker = { entry: next, window };
      const baseUrl = state.href.split("#", 1)[0];
      const workerUrl = new URL(baseUrl);
      workerUrl.searchParams.set("ipolloworkBackgroundDelivery", "1");
      workerUrl.hash = deliveryRoute(next);
      await window.loadURL(workerUrl.toString());
      // The shell can normalize an early deep link to a blank session while
      // its workspace list is still loading. Reapply the route once ready.
      if (window.webContents?.executeJavaScript) {
        const ready = await window.webContents.executeJavaScript(`(async () => {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const action = window.__ipolloworkControl?.listActions?.()
              .find((item) => item.id === "session.create_task");
            if (action && !action.disabled) {
              if (location.hash !== ${JSON.stringify(deliveryRoute(next))}) {
                location.hash = ${JSON.stringify(deliveryRoute(next))};
              }
              if ([...document.querySelectorAll('[data-session-surface-id]')]
                .some((surface) => surface.getAttribute('data-session-surface-id') === ${JSON.stringify(next.sessionId)})) {
                return true;
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          return false;
        })()`, true);
        if (!ready) throw new Error(`Workspace did not load for ${next.sessionId}`);
      }
    } catch (error) {
      log.warn("[video-delivery] Background worker could not start", error);
      closeWorker();
    } finally {
      checking = false;
    }
  };

  return {
    start() {
      if (timer || disposed) return;
      timer = setInterval(() => { void tick(); }, intervalMs);
      void tick();
    },
    onMainNavigation,
    async checkNow() { await tick(); },
    stop() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
      closeWorker();
    },
  };
}
