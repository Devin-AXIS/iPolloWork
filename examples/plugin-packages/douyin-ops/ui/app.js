const pluginId = "douyin-ops",
  pluginName = "抖音运营台",
  pluginVersion = "0.2.21";
const storageKey = `${pluginId}-token`;
let token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
try {
  if (token) sessionStorage.setItem(storageKey, token);
  else
    token =
      sessionStorage.getItem(storageKey) ||
      sessionStorage.getItem("channels-ops-token") ||
      "";
} catch {
  /* Launch token is sufficient. */
}
if (location.hash)
  history.replaceState(null, "", location.pathname + location.search);
let hostPromise,
  hostReady = false,
  requestId = 0,
  ui,
  h,
  root;
const requests = new Map(),
  pending = new Set();
function applyTheme(context) {
  if (!context?.theme) return;
  document.documentElement.dataset.theme = context.theme;
  document.documentElement.classList.toggle("dark", context.theme === "dark");
}
window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.jsonrpc !== "2.0") return;
  if (event.data.method === "ui/notifications/host-context-changed") {
    applyTheme(event.data.params);
    return;
  }
  const item = requests.get(event.data.id);
  if (!item || event.data.method) return;
  requests.delete(event.data.id);
  clearTimeout(item.timer);
  event.data.error
    ? item.reject(new Error(event.data.error.message))
    : item.resolve(event.data.result);
});
function hostRequest(method, params) {
  if (window === parent)
    return Promise.reject(
      new Error("请从 iPolloWork 当前会话打开运营台以使用 AI 和账号浏览器。"),
    );
  return new Promise((resolve, reject) => {
    const id = ++requestId,
      timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error("当前会话未响应，请重新打开运营台。"));
      }, 15000);
    requests.set(id, { resolve, reject, timer });
    parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });
}
function getHost() {
  hostPromise ??= hostRequest("ui/initialize", {
    protocolVersion: "2025-11-21",
    appInfo: { name: pluginName, version: pluginVersion },
    appCapabilities: {},
  })
    .then((host) => {
      hostReady = true;
      applyTheme(host.hostContext);
      parent.postMessage(
        { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} },
        "*",
      );
      return host;
    })
    .catch((error) => {
      hostPromise = undefined;
      throw error;
    });
  return hostPromise;
}
async function bootstrap() {
  // The local service owns no React bundle. Only its parent host supplies code;
  // standalone development explicitly installs the bundled runtime before this module.
  if (!window.ipolloworkUi) {
    const host = await getHost(),
      source = host.hostContext?.["ai.ipollo/ui-runtime"];
    if (typeof source !== "string" || source.length > 8_000_000)
      throw new Error("请更新 iPolloWork 客户端后重新打开运营台。");
    const url = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.nonce = document.querySelector(
          'meta[name="ipollowork-ui-nonce"]',
        ).content;
        script.onload = resolve;
        script.onerror = () =>
          reject(new Error("主软件组件加载失败，请重新打开运营台。"));
        document.head.append(script);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (typeof window.ipolloworkUi?.requireRuntime !== "function")
    throw new Error("客户端缺少组件契约，请更新客户端。");
  const { requireRuntime } = window.ipolloworkUi;
  ui = requireRuntime(
    1,
    [
      "Button",
      "Input",
      "Textarea",
      "Select",
      "SelectTrigger",
      "SelectValue",
      "SelectContent",
      "SelectItem",
      "Dialog",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogDescription",
      "Tabs",
      "TabsList",
      "TabsTrigger",
      "TabsContent",
      "Badge",
      "Alert",
      "AlertDescription",
      "Field",
      "FieldLabel",
      "Icon",
      "Table",
      "TableHeader",
      "TableBody",
      "TableRow",
      "TableHead",
      "TableCell",
      "Collapsible",
      "CollapsibleTrigger",
      "CollapsibleContent",
    ],
    5,
  );
  h = ui.React.createElement;
  root = ui.createRoot(document.getElementById("app"));
  await refresh();
  render();
  const timer = setInterval(() => {
    if (!document.hidden && !pending.size) void refresh().catch(() => {});
  }, 5000);
  window.addEventListener(
    "pagehide",
    () => {
      clearInterval(timer);
      for (const item of requests.values()) clearTimeout(item.timer);
    },
    { once: true },
  );
}
async function request(path, options = {}) {
  if (!token) throw new Error("缺少本地凭证，请从插件入口重新打开。");
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    throw Object.assign(new Error("本地服务连接中断，请先刷新任务状态。"), {
      code: "NETWORK",
    });
  }
  const result = await response.json();
  if (!response.ok || result.error)
    throw Object.assign(new Error(result.error || "操作失败"), {
      code: result.code,
    });
  return result;
}
const action = (name, args = {}) =>
  request(`/api/actions/${name}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
function notify(message, error = false) {
  model.notice = { message, error };
  render();
}
async function run(key, task) {
  if (pending.has(key)) return;
  pending.add(key);
  render();
  try {
    await task();
  } catch (error) {
    notify(error.message, true);
  } finally {
    pending.delete(key);
    render();
  }
}
let aiQueue = Promise.resolve();
function sendAI(text, context) {
  const delivery = aiQueue.then(async () => {
    await getHost();
    const updated = await hostRequest("ui/update-model-context", {
      content: [],
      structuredContent: { extensionId: pluginId, ...context },
    });
    if (updated?.isError)
      throw new Error("页面上下文未送达，请重新打开运营台。");
    const sent = await hostRequest("ui/message", {
      role: "user",
      content: [{ type: "text", text }],
    });
    if (sent?.isError) throw new Error("当前 AI 会话未接收命令，任务已保留。");
    notify("已发送到 AI 对话，结果会自动同步。");
  });
  aiQueue = delivery.catch(() => {});
  return delivery;
}
const date = (value) =>
  value
    ? new Date(
        typeof value === "number" && value < 1e12 ? value * 1000 : value,
      ).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "尚未同步";
const statusLabels = {
  prepared: "待执行",
  pending: "待执行",
  running: "执行中",
  submitting: "提交中",
  submitted: "已提交",
  reviewing: "审核中",
  published: "已发布",
  replied: "已回复",
  uncertain: "待核对",
  blocked: "已暂停",
  failed: "失败",
  cancelled: "已取消",
  succeeded: "已完成",
  connected: "已连接",
  verified: "已连接",
  connecting: "等待登录",
  unverified: "待登录",
  expired: "登录已失效",
  mismatch: "账号不匹配",
  conflict: "账号已绑定",
};
const statusVariant = (value) =>
  ["failed", "mismatch", "conflict"].includes(value)
    ? "destructive"
    : ["uncertain", "blocked", "expired", "unverified"].includes(value)
      ? "warning"
      : ["succeeded", "published", "replied", "verified", "connected"].includes(
            value,
          )
        ? "success"
        : "secondary";
function render() {
  if (root) root.render(h(App));
}

const model = {
  data: {
    accounts: [],
    drafts: [],
    assets: [],
    jobs: [],
    settings: {},
    capabilities: {},
  },
  accountId: "",
  draft: {},
  dirty: false,
  view: "studio",
  accountsOpen: false,
  settingsOpen: false,
  settings: {},
  callbackUrl: "",
  sourcePath: "",
  keyword: "",
  deviceId: "",
  commentItem: "",
  commentUrl: "",
  ownVideo: true,
  replies: {},
  videoComments: {},
  videos: [],
  comments: [],
  search: [],
  pages: {},
  appliedJobs: new Set(),
  queries: {},
  readJobs: {},
  resolving: {},
  notice: null,
};
const account = () =>
  model.data.accounts.find((item) => item.id === model.accountId);
const items = (kind) =>
  model.data[kind].filter((item) => item.accountId === model.accountId);
const jobNames = {
  "publish-draft": "发布视频",
  publish: "发布视频",
  "list-videos": "读取作品",
  "video-data": "读取作品数据",
  "list-comments": "读取评论",
  "reply-comment": "回复评论",
  reply: "回复评论",
  "search-videos": "搜索视频",
  "comment-video": "发表评论",
};
const lockedStatuses = [
  "pending",
  "running",
  "submitting",
  "uncertain",
  "succeeded",
  "published",
  "completed",
];
let operations = {},
  refreshing;
try {
  operations = JSON.parse(
    sessionStorage.getItem("douyin-ops-operations") || "{}",
  );
} catch {
  /* No local pending operation. */
}
const rememberOperations = () => {
  try {
    sessionStorage.setItem("douyin-ops-operations", JSON.stringify(operations));
  } catch {
    /* Server still deduplicates saved jobs. */
  }
};
function refresh() {
  refreshing ??= request("/api/state")
    .then((data) => {
      model.data = data;
      if (!data.accounts.some((item) => item.id === model.accountId))
        model.accountId = data.accounts[0]?.id || "";
      if (!model.dirty && !pending.has("draft") && !pending.has("publish"))
        model.draft =
          data.drafts.find(
            (item) =>
              item.id === model.draft.id && item.accountId === model.accountId,
          ) ||
          data.drafts.find((item) => item.accountId === model.accountId) ||
          {};
      for (const entry of Object.values(operations)) {
        const job = data.jobs.find(
          (item) => item.operationKey === entry.operationKey,
        );
        if (job) entry.status = job.status;
      }
      rememberOperations();
      for (const job of items("jobs").slice().reverse()) {
        if (
          job.status !== "succeeded" ||
          !job.result?.list ||
          model.appliedJobs.has(job.id)
        )
          continue;
        const field = {
          "list-videos": "videos",
          "list-comments": "comments",
          "search-videos": "search",
        }[job.browserAction || job.kind];
        if (field && model.readJobs[field] !== job.id) continue;
        model.appliedJobs.add(job.id);
        if (field) model[field] = job.result.list;
        if ((job.browserAction || job.kind) === "video-data") {
          for (const detail of job.result.list) {
            const id = videoId(detail),
              index = model.videos.findIndex(
                (item) =>
                  videoId(item) === id ||
                  item.link === detail.link ||
                  (job.payload.itemIds.length === 1 &&
                    job.payload.itemIds[0] === videoId(item)),
              );
            if (index >= 0)
              model.videos[index] = {
                ...model.videos[index],
                statistics: detail.statistics || detail,
              };
          }
        }
      }
      render();
    })
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}
function requireAccount() {
  if (!account()) throw new Error("请先添加并登录抖音账号。");
  return model.accountId;
}
function capability(name) {
  return (
    account()?.capabilities?.[name] ??
    model.data.capabilities[name] ?? {
      available: false,
      reason: "请先添加并登录账号。",
    }
  );
}
function editDraft(key, value) {
  model.draft = { ...model.draft, [key]: value };
  model.dirty = true;
  render();
}
const draftLocked = () =>
  Boolean(
    model.draft.id &&
    (model.draft.status !== "draft" ||
      lockedStatuses.includes(
        operations[`publish:${model.accountId}:${model.draft.id}`]?.status,
      )),
  );
async function saveDraft() {
  const { draft } = await action("save-draft", {
    id: model.draft.id || undefined,
    accountId: requireAccount(),
    title: model.draft.title || "未命名草稿",
    text: model.draft.text || "",
    assetId: model.draft.assetId || undefined,
  });
  model.draft = draft;
  model.dirty = false;
  model.data.drafts = [
    draft,
    ...model.data.drafts.filter((item) => item.id !== draft.id),
  ];
  render();
  return draft;
}
async function selectAccount(id) {
  if (model.dirty && !draftLocked()) await saveDraft();
  model.accountId = id;
  model.draft = items("drafts")[0] || {};
  model.videos = [];
  model.comments = [];
  model.search = [];
  model.pages = {};
  model.readJobs = {};
  model.replies = {};
  model.videoComments = {};
  model.appliedJobs = new Set();
  model.commentItem = "";
  model.commentUrl = "";
  model.notice = null;
  render();
}
async function openTarget(target) {
  const url = new URL(target.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !/(^|\.)douyin\.com$/.test(url.hostname)
  )
    throw new Error("无法打开非抖音官方页面。");
  await getHost();
  if (url.origin === "https://www.douyin.com") {
    const result = await hostRequest("ui/open-link", {
      url: url.href,
      browserProfileId: target.browserProfileId || account()?.browserProfileId,
    });
    if (result?.isError)
      throw new Error("账号浏览器未打开，请重新打开运营台。");
  } else
    await sendAI("打开抖音官方授权页面。", {
      action: "open-authorization",
      url: url.href,
    });
}
async function connect(id) {
  await getHost();
  const target = await action("connect-browser", id ? { accountId: id } : {});
  await selectAccount(target.account.id);
  await refresh();
  await openTarget(target);
  notify("请在账号浏览器完成登录并进入“我”的主页，账号会自动识别。");
}
async function executeJob(job) {
  await sendAI(
    `${jobNames[job.browserAction || job.kind] || "执行抖音任务"}。`,
    { action: "execute-job", accountId: job.accountId, jobId: job.id },
  );
}
async function perform(name, args) {
  if (
    !capability(
      {
        "list-videos": "listVideos",
        "video-data": "videoData",
        "list-comments": "comments",
        "search-videos": "searchVideos",
        "publish-draft": "publish",
      }[name] || "comments",
    ).available
  )
    throw new Error("当前账号无法使用该功能，请在账号管理中登录或检查授权。");
  const result = await action(name, args);
  await refresh();
  if (result.browserTask && result.job.status === "pending") {
    try {
      await executeJob(result.job);
    } catch (error) {
      notify(`${error.message} 可从任务记录继续。`, true);
    }
  }
  return result;
}
async function externalWrite(name, args, key) {
  const entry = (operations[key] ||= {
    operationKey: crypto.randomUUID(),
    status: "ready",
  });
  if (lockedStatuses.includes(entry.status))
    throw new Error("这项操作已提交或待核对，请查看任务记录。");
  entry.status = "pending";
  rememberOperations();
  try {
    const result = await perform(name, {
      ...args,
      operationKey: entry.operationKey,
    });
    entry.status = result.job?.status || "succeeded";
    rememberOperations();
    return result;
  } catch (error) {
    entry.status =
      error.code === "NETWORK" || error.code === "UNCERTAIN"
        ? "uncertain"
        : "failed";
    rememberOperations();
    throw error;
  }
}
async function load(field, more = false) {
  const page = model.pages[field],
    args = {
      accountId: requireAccount(),
      count: 20,
      ...(more ? { cursor: page?.cursor } : {}),
    };
  let name;
  if (field === "videos") name = "list-videos";
  if (field === "search") {
    name = "search-videos";
    Object.assign(args, {
      keyword: model.keyword.trim(),
      deviceId: model.deviceId.trim() || undefined,
      ...(more ? { searchId: page?.search_id || page?.searchId } : {}),
    });
  }
  if (field === "comments") {
    name = "list-comments";
    Object.assign(args, {
      itemId: model.commentItem.trim(),
      targetUrl: model.commentUrl.trim() || undefined,
      ownVideo: model.ownVideo,
    });
  }
  if (more) {
    const cursor = args.cursor;
    Object.assign(args, model.queries[field], { cursor });
  } else model.queries[field] = { ...args, cursor: undefined };
  if (field === "search" && !args.keyword)
    throw new Error("请输入搜索关键词。");
  if (field === "comments" && !args.itemId)
    throw new Error("请输入作品 ID 或作品链接。");
  delete model.readJobs[field];
  if (!more) {
    model[field] = [];
    delete model.pages[field];
  }
  const result = await perform(name, args);
  if (result.browserTask) {
    model.readJobs[field] = result.job.id;
    await refresh();
  } else {
    model[field] = more
      ? [...model[field], ...(result.list || [])]
      : result.list || [];
    model.pages[field] = result;
    notify(result.list?.length ? "读取完成。" : "没有读取到结果。");
  }
}
async function upload(file) {
  if (!file) return;
  if (
    !file.name.toLowerCase().endsWith(".mp4") ||
    file.size > 128 * 1024 * 1024
  )
    throw new Error("请选择不超过 128 MiB 的 MP4 视频。");
  const { asset } = await request("/api/media", {
    method: "POST",
    headers: {
      "Content-Type": "video/mp4",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  editDraft("assetId", asset.id);
  await saveDraft();
  await refresh();
  notify("视频已上传并保存到草稿。");
}
function Accounts() {
  return h(
    ui.Dialog,
    {
      open: model.accountsOpen,
      onOpenChange: (open) => {
        model.accountsOpen = open;
        render();
      },
    },
    h(
      ui.DialogContent,
      { className: "dialog-content", closeLabel: "关闭账号管理" },
      h(
        ui.DialogHeader,
        null,
        h(ui.DialogTitle, null, "账号管理"),
        h(
          ui.DialogDescription,
          null,
          "每个账号使用独立的浏览器环境，登录后自动识别。",
        ),
      ),
      model.notice &&
        h(
          ui.Alert,
          { variant: model.notice.error ? "destructive" : "default" },
          h(ui.AlertDescription, null, model.notice.message),
        ),
      h(
        ui.Button,
        {
          id: "connect-browser",
          disabled: pending.has("connect"),
          onClick: () => run("connect", () => connect()),
        },
        h(ui.Icon, { name: "Plus" }),
        pending.has("connect") ? "正在打开…" : "扫码添加账号",
      ),
      h(
        "div",
        { className: "stack compact" },
        ...model.data.accounts.map((item) =>
          h(
            "article",
            { key: item.id, className: "record" },
            h(
              "div",
              { className: "record-head" },
              h(
                "div",
                null,
                h("strong", null, item.nickname || "等待登录"),
                h(
                  "p",
                  { className: "caption" },
                  item.webIdentity || item.openId || "登录后识别抖音号",
                ),
              ),
              h(
                ui.Badge,
                {
                  variant:
                    item.webIdentity || item.connection !== "browser"
                      ? "success"
                      : "warning",
                },
                item.webIdentity || item.connection !== "browser"
                  ? "已连接"
                  : "待登录",
              ),
            ),
            h(
              "div",
              { className: "actions" },
              h(
                ui.Button,
                {
                  variant: "outline",
                  size: "sm",
                  disabled: pending.has("connect"),
                  onClick: () => run("connect", () => connect(item.id)),
                },
                "打开账号",
              ),
              item.connection === "browser" &&
                h(
                  ui.Button,
                  {
                    variant: "ghost",
                    size: "sm",
                    disabled: pending.has("ai"),
                    onClick: () =>
                      run("ai", () =>
                        sendAI("识别当前登录的抖音账号。", {
                          action: "account-check",
                          accountId: item.id,
                        }),
                      ),
                  },
                  "已登录，识别账号",
                ),
            ),
          ),
        ),
      ),
      h(
        ui.Collapsible,
        {
          open: model.settingsOpen,
          onOpenChange: (open) => {
            model.settingsOpen = open;
            render();
          },
        },
        h(
          ui.CollapsibleTrigger,
          { render: h(ui.Button, { variant: "ghost", size: "sm" }) },
          "开放平台 API 设置",
        ),
        h(
          ui.CollapsibleContent,
          { className: "stack" },
          h(
            "p",
            { className: "caption" },
            "已有获批应用可使用 API；普通网页登录无需配置。",
          ),
          h(
            "form",
            {
              className: "stack",
              onSubmit: (event) => {
                event.preventDefault();
                void run("settings", async () => {
                  await request("/api/settings", {
                    method: "POST",
                    body: JSON.stringify({
                      ...model.data.settings,
                      scopes: model.data.settings.scopes?.join(","),
                      ...model.settings,
                    }),
                  });
                  model.settings.clientSecret = "";
                  await refresh();
                  notify("API 配置已保存。");
                });
              },
            },
            ...[
              ["clientKey", "Client Key", "text"],
              ["clientSecret", "Client Secret", "password"],
              ["redirectUri", "HTTPS 回调地址", "url"],
              ["scopes", "已获批权限 scopes", "text"],
            ].map(([key, label, type]) =>
              h(
                ui.Field,
                { key },
                h(ui.FieldLabel, { htmlFor: key }, label),
                h(ui.Input, {
                  id: key,
                  type,
                  value:
                    model.settings[key] ??
                    (key === "scopes"
                      ? model.data.settings.scopes?.join(",")
                      : model.data.settings[key]) ??
                    "",
                  required:
                    key !== "clientSecret" ||
                    !model.data.settings.secretConfigured,
                  autoComplete: "off",
                  onChange: (event) => {
                    model.settings[key] = event.target.value;
                    render();
                  },
                }),
              ),
            ),
            h(
              ui.Button,
              {
                type: "submit",
                variant: "outline",
                disabled: pending.has("settings"),
              },
              "保存配置",
            ),
          ),
          h(
            ui.Button,
            {
              variant: "outline",
              disabled:
                !model.data.settings.secretConfigured ||
                pending.has("authorize"),
              onClick: () =>
                run("authorize", async () =>
                  openTarget(await action("start-authorization")),
                ),
            },
            "发起官方授权",
          ),
          h(
            "form",
            {
              className: "stack compact",
              onSubmit: (event) => {
                event.preventDefault();
                void run("authorize", async () => {
                  const result = await action("finish-authorization", {
                    callbackUrl: model.callbackUrl,
                  });
                  model.callbackUrl = "";
                  await selectAccount(result.account.id);
                  await refresh();
                  notify("官方授权已完成。");
                });
              },
            },
            h(
              ui.Field,
              null,
              h(ui.FieldLabel, { htmlFor: "callback-url" }, "授权回调完整地址"),
              h(ui.Input, {
                id: "callback-url",
                type: "url",
                required: true,
                value: model.callbackUrl,
                onChange: (event) => {
                  model.callbackUrl = event.target.value;
                  render();
                },
              }),
            ),
            h(
              ui.Button,
              {
                type: "submit",
                variant: "outline",
                disabled: !model.callbackUrl || pending.has("authorize"),
              },
              "完成授权",
            ),
          ),
        ),
      ),
    ),
  );
}
function Studio() {
  const draft = model.draft,
    asset = model.data.assets.find((item) => item.id === draft.assetId),
    immutable = draftLocked(),
    locked =
      immutable ||
      pending.has("draft") ||
      pending.has("publish") ||
      pending.has("upload") ||
      pending.has("ai");
  return h(
    "div",
    { className: "workspace" },
    h(
      "form",
      {
        className: "panel stack",
        id: "draft-form",
        onSubmit: (event) => {
          event.preventDefault();
          void run("draft", async () => {
            await saveDraft();
            notify("草稿已保存。");
          });
        },
      },
      h(
        "div",
        { className: "section-head" },
        h(
          "div",
          null,
          h("h2", null, "视频草稿"),
          h(
            "p",
            { className: "caption" },
            immutable
              ? "此草稿已提交，请查看任务结果或新建草稿"
              : model.dirty
                ? "有未保存的修改"
                : draft.id
                  ? "已保存到本地"
                  : "准备内容，确认后交给 AI 发布",
          ),
        ),
        h(
          ui.Button,
          {
            variant: "ghost",
            size: "sm",
            disabled: pending.has("draft") || pending.has("publish"),
            onClick: () =>
              run("draft", async () => {
                if (model.dirty && !immutable) await saveDraft();
                model.draft = {};
                model.dirty = true;
                render();
              }),
          },
          h(ui.Icon, { name: "Plus" }),
          "新草稿",
        ),
      ),
      h(
        ui.Field,
        null,
        h(ui.FieldLabel, { htmlFor: "draft-title" }, "草稿标题"),
        h(ui.Input, {
          id: "draft-title",
          value: draft.title || "",
          maxLength: 100,
          disabled: locked,
          placeholder: "用于区分本地草稿",
          onChange: (event) => editDraft("title", event.target.value),
        }),
      ),
      h(
        ui.Field,
        null,
        h(ui.FieldLabel, { htmlFor: "draft-text" }, "视频文案"),
        h(ui.Textarea, {
          id: "draft-text",
          value: draft.text || "",
          rows: 6,
          maxLength: 1000,
          disabled: locked,
          placeholder: "写下这条视频要表达的内容",
          onChange: (event) => editDraft("text", event.target.value),
        }),
      ),
      h(
        ui.Field,
        null,
        h(ui.FieldLabel, { htmlFor: "draft-asset" }, "视频"),
        h(
          ui.Select,
          {
            value: draft.assetId || "",
            disabled: locked,
            onValueChange: (value) => editDraft("assetId", value),
          },
          h(
            ui.SelectTrigger,
            {
              id: "draft-asset",
              className: "full-width",
              "aria-label": "选择视频",
            },
            h(ui.SelectValue, null, asset?.name || "选择视频"),
          ),
          h(
            ui.SelectContent,
            null,
            h(ui.SelectItem, { value: "" }, "不选择视频"),
            ...model.data.assets.map((item) =>
              h(ui.SelectItem, { key: item.id, value: item.id }, item.name),
            ),
          ),
        ),
        h(
          "div",
          { className: "actions" },
          h(
            ui.Button,
            {
              variant: "outline",
              size: "sm",
              disabled: locked || !account(),
              onClick: () => document.getElementById("file-video").click(),
            },
            h(ui.Icon, { name: "Upload" }),
            "上传视频",
          ),
          h("span", { className: "caption" }, "MP4 · 最大 128 MiB"),
        ),
        h("input", {
          id: "file-video",
          type: "file",
          className: "file-input",
          accept: ".mp4",
          onChange: (event) => {
            const file = event.target.files[0];
            event.target.value = "";
            void run("upload", () => upload(file));
          },
        }),
      ),
      h(
        ui.Collapsible,
        null,
        h(
          ui.CollapsibleTrigger,
          { render: h(ui.Button, { variant: "ghost", size: "sm" }) },
          "从工作区导入素材",
        ),
        h(
          ui.CollapsibleContent,
          { className: "stack compact" },
          h(
            ui.Field,
            null,
            h(ui.FieldLabel, { htmlFor: "source-path" }, "素材路径"),
            h(ui.Input, {
              id: "source-path",
              value: model.sourcePath,
              placeholder: "当前工作区中的 MP4 路径",
              onChange: (event) => {
                model.sourcePath = event.target.value;
                render();
              },
            }),
          ),
          h(
            ui.Button,
            {
              variant: "outline",
              disabled: !model.sourcePath.trim() || locked || !account(),
              onClick: () =>
                run("upload", async () => {
                  const { asset: imported } = await action("import-media", {
                    sourcePath: model.sourcePath.trim(),
                  });
                  editDraft("assetId", imported.id);
                  await saveDraft();
                  model.sourcePath = "";
                  await refresh();
                  notify("素材已导入。");
                }),
            },
            "导入素材",
          ),
        ),
      ),
      h(
        "div",
        { className: "actions spread" },
        h(
          "div",
          { className: "actions" },
          h(
            ui.Button,
            {
              type: "submit",
              variant: "outline",
              disabled: locked || !account(),
            },
            h(ui.Icon, { name: "Save" }),
            "保存草稿",
          ),
          h(
            ui.Button,
            {
              variant: "outline",
              disabled: locked || pending.has("ai") || !account(),
              onClick: () =>
                run("ai", async () => {
                  const saved = await saveDraft();
                  await sendAI("为当前抖音草稿起草文案。", {
                    action: "draft-copy",
                    accountId: saved.accountId,
                    draftId: saved.id,
                  });
                }),
            },
            "AI 起草",
          ),
        ),
        h(
          ui.Button,
          {
            disabled:
              locked ||
              !account() ||
              !draft.assetId ||
              !capability("publish").available,
            onClick: () =>
              run("publish", async () => {
                await getHost();
                const saved = await saveDraft();
                await externalWrite(
                  "publish-draft",
                  { accountId: saved.accountId, draftId: saved.id },
                  `publish:${saved.accountId}:${saved.id}`,
                );
                model.view = "jobs";
                await refresh();
              }),
          },
          h(ui.Icon, { name: "Send" }),
          pending.has("publish") ? "正在准备…" : "发布视频",
        ),
      ),
    ),
    h(
      "aside",
      { className: "stack" },
      h(
        "section",
        { className: "panel stack" },
        h("h2", null, "内容预览"),
        h(
          "div",
          { className: "preview" },
          h(ui.Icon, { name: "Play", size: "l" }),
          h("strong", null, draft.title || "未命名草稿"),
          h(
            "p",
            { className: "preview-copy" },
            draft.text || "文案将在这里显示",
          ),
          h("p", { className: "caption" }, asset?.name || "尚未选择视频"),
        ),
      ),
      h(
        "section",
        { className: "panel stack compact" },
        h("h2", null, "最近草稿"),
        items("drafts").length
          ? items("drafts")
              .slice(0, 5)
              .map((item) =>
                h(
                  "div",
                  { key: item.id, className: "record" },
                  h(
                    ui.Button,
                    {
                      variant: "ghost",
                      className: "long-copy",
                      disabled: pending.has("draft") || pending.has("publish"),
                      onClick: () =>
                        run("draft", async () => {
                          if (model.dirty && !immutable) await saveDraft();
                          model.draft = item;
                          model.dirty = false;
                          render();
                        }),
                    },
                    item.title || "未命名草稿",
                  ),
                  h("p", { className: "caption" }, date(item.updatedAt)),
                ),
              )
          : h("p", { className: "caption" }, "保存后可在这里继续编辑"),
      ),
    ),
  );
}
const videoId = (item) => item.item_id || item.itemId || item.id || item.link;
const metricFields = [
  ["play_count", "播放"],
  ["digg_count", "点赞"],
  ["comment_count", "评论"],
  ["share_count", "分享"],
];
const metricNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const digits = value.trim().replaceAll(",", "");
  return /^\d+(\.\d+)?$/.test(digits) && Number.isFinite(Number(digits))
    ? Number(digits)
    : null;
};
function VideoRecords({ list, own }) {
  return list.length
    ? list.map((item) => {
        const id = videoId(item),
          key = `${own ? "own" : "search"}:${id}`,
          reply = model.videoComments[key] || "";
        return h(
          "article",
          { key, className: "record stack compact" },
          h("strong", null, item.title || item.text || "作品"),
          item.nickname && h("p", { className: "caption" }, item.nickname),
          h(
            "p",
            { className: "caption" },
            date(item.create_time || item.createdAt),
          ),
          h(
            "p",
            { className: "caption" },
            metricFields
              .filter(([field]) => (item.statistics || item)[field] != null)
              .map(
                ([field, label]) =>
                  `${label} ${(item.statistics || item)[field]}`,
              )
              .join(" · ") || "暂无可见指标",
          ),
          h(
            "div",
            { className: "actions" },
            item.link &&
              h(
                ui.Button,
                {
                  variant: "ghost",
                  size: "sm",
                  onClick: () =>
                    run(`open:${id}`, () => openTarget({ url: item.link })),
                },
                "打开作品",
                h(ui.Icon, { name: "ExternalLink" }),
              ),
            h(
              ui.Button,
              {
                variant: "outline",
                size: "sm",
                disabled: !id || pending.has("comments"),
                onClick: () =>
                  run("comments", async () => {
                    model.commentItem = id;
                    model.commentUrl = item.link || "";
                    model.ownVideo = own;
                    model.comments = [];
                    model.view = "comments";
                    render();
                    await load("comments");
                  }),
              },
              "查看评论",
            ),
            own &&
              capability("videoData").available &&
              h(
                ui.Button,
                {
                  variant: "outline",
                  size: "sm",
                  disabled: pending.has(`data:${id}`),
                  onClick: () =>
                    run(`data:${id}`, async () => {
                      const result = await perform("video-data", {
                        accountId: requireAccount(),
                        itemIds: [id],
                      });
                      if (!result.browserTask) {
                        const detail = result.list?.[0];
                        if (detail) {
                          const index = model.videos.findIndex(
                            (value) => videoId(value) === id,
                          );
                          model.videos[index] = {
                            ...item,
                            statistics: detail.statistics || detail,
                          };
                        }
                      }
                      model.view = "data";
                      render();
                    }),
                },
                "读取数据",
              ),
          ),
          item.link &&
            h(
              ui.Collapsible,
              null,
              h(
                ui.CollapsibleTrigger,
                { render: h(ui.Button, { variant: "ghost", size: "sm" }) },
                "发表评论",
              ),
              h(
                ui.CollapsibleContent,
                { className: "stack compact" },
                h(ui.Textarea, {
                  "aria-label": `评论 ${item.title || "作品"}`,
                  rows: 2,
                  maxLength: 300,
                  value: reply,
                  placeholder: "输入针对这条作品的评论",
                  onChange: (event) => {
                    model.videoComments[key] = event.target.value;
                    render();
                  },
                }),
                h(
                  ui.Button,
                  {
                    variant: "outline",
                    size: "sm",
                    disabled: !reply.trim() || pending.has(`comment:${id}`),
                    onClick: () =>
                      run(`comment:${id}`, async () => {
                        await getHost();
                        await externalWrite(
                          "comment-video",
                          {
                            accountId: requireAccount(),
                            targetUrl: item.link,
                            content: reply.trim(),
                          },
                          JSON.stringify([
                            "comment-video",
                            model.accountId,
                            item.link,
                            reply.trim(),
                          ]),
                        );
                        model.view = "jobs";
                      }),
                  },
                  "发送评论",
                ),
              ),
            ),
        );
      })
    : h(
        "div",
        { className: "empty" },
        h(ui.Icon, { name: "Play", size: "l" }),
        h("p", null, "暂无结果，读取完成后会自动显示。"),
      );
}
function Videos() {
  return h(
    "section",
    { className: "panel" },
    h(
      "div",
      { className: "section-head" },
      h(
        "div",
        null,
        h("h2", null, "账号作品"),
        h("p", { className: "caption" }, "读取当前账号可见的作品与指标"),
      ),
      h(
        ui.Button,
        {
          variant: "outline",
          disabled:
            !account() ||
            !capability("listVideos").available ||
            pending.has("videos"),
          onClick: () => run("videos", () => load("videos")),
        },
        h(ui.Icon, { name: "RefreshCw" }),
        "读取作品",
      ),
    ),
    h(VideoRecords, { list: model.videos, own: true }),
    model.pages.videos?.has_more &&
      h(
        ui.Button,
        {
          variant: "outline",
          disabled: pending.has("videos"),
          onClick: () => run("videos", () => load("videos", true)),
        },
        "加载更多",
      ),
  );
}
function Data() {
  return h(
    "div",
    null,
    h(
      "div",
      { className: "section-head" },
      h(
        "div",
        null,
        h("h2", null, "作品数据"),
        h(
          "p",
          { className: "caption" },
          "仅统计已读取的可见指标，缺失值显示为 —",
        ),
      ),
      h(
        "div",
        { className: "actions" },
        h(
          ui.Button,
          {
            variant: "outline",
            disabled: !account() || pending.has("videos"),
            onClick: () => run("videos", () => load("videos")),
          },
          "读取作品",
        ),
        h(
          ui.Button,
          {
            variant: "outline",
            disabled: !model.videos.length || pending.has("ai"),
            onClick: () =>
              run("ai", () =>
                sendAI("分析当前抖音作品数据，给出改进建议。", {
                  action: "review",
                  accountId: requireAccount(),
                  observations: model.videos
                    .slice(0, 100)
                    .map((item) => ({
                      title: item.title || item.text || "作品",
                      statistics:
                        item.statistics ||
                        Object.fromEntries(
                          metricFields.map(([key]) => [key, item[key] ?? null]),
                        ),
                    })),
                }),
              ),
          },
          "AI 复盘",
        ),
      ),
    ),
    h(
      "div",
      { className: "metrics" },
      ...metricFields.map(([key, label]) => {
        const known = model.videos
          .map((item) => metricNumber((item.statistics || item)[key]))
          .filter(Number.isFinite);
        return h(
          "div",
          { key, className: "metric" },
          h("span", { className: "caption" }, label),
          h(
            "strong",
            null,
            known.length
              ? known.reduce((a, b) => a + b, 0).toLocaleString()
              : "—",
          ),
          h(
            "p",
            { className: "caption" },
            `${known.length} / ${model.videos.length} 条有数据`,
          ),
        );
      }),
    ),
    h(
      "div",
      { className: "panel table-scroll" },
      h(
        ui.Table,
        null,
        h(
          ui.TableHeader,
          null,
          h(
            ui.TableRow,
            null,
            ...["作品", ...metricFields.map((item) => item[1])].map((label) =>
              h(ui.TableHead, { key: label }, label),
            ),
          ),
        ),
        h(
          ui.TableBody,
          null,
          ...model.videos.map((item) =>
            h(
              ui.TableRow,
              { key: videoId(item) },
              h(ui.TableCell, null, item.title || item.text || "作品"),
              ...metricFields.map(([key]) =>
                h(
                  ui.TableCell,
                  { key },
                  metricNumber((item.statistics || item)[key]) !== null
                    ? metricNumber((item.statistics || item)[key]).toLocaleString()
                    : "—",
                ),
              ),
            ),
          ),
          !model.videos.length &&
            h(
              ui.TableRow,
              null,
              h(ui.TableCell, { colSpan: 5 }, "读取作品后可查看数据。"),
            ),
        ),
      ),
    ),
  );
}
function Comments() {
  return h(
    "section",
    { className: "panel stack" },
    h("h2", null, "作品评论"),
    h(
      "form",
      {
        className: "stack",
        onSubmit: (event) => {
          event.preventDefault();
          void run("comments", () => load("comments"));
        },
      },
      h(
        "div",
        { className: "form-row" },
        h(
          ui.Field,
          null,
          h(ui.FieldLabel, { htmlFor: "comment-item" }, "作品 ID 或链接"),
          h(ui.Input, {
            id: "comment-item",
            required: true,
            disabled: pending.has("comments"),
            value: model.commentItem,
            onChange: (event) => {
              model.commentItem = event.target.value;
              model.commentUrl = event.target.value.startsWith("https://")
                ? event.target.value
                : "";
              model.comments = [];
              delete model.pages.comments;
              delete model.readJobs.comments;
              render();
            },
          }),
        ),
        h(
          ui.Field,
          null,
          h(ui.FieldLabel, null, "作品来源"),
          h(
            ui.Select,
            {
              value: model.ownVideo ? "own" : "public",
              disabled: pending.has("comments"),
              onValueChange: (value) => {
                model.ownVideo = value === "own";
                model.comments = [];
                delete model.pages.comments;
                delete model.readJobs.comments;
                render();
              },
            },
            h(
              ui.SelectTrigger,
              { "aria-label": "作品来源" },
              h(
                ui.SelectValue,
                null,
                model.ownVideo ? "自己的作品" : "公开作品",
              ),
            ),
            h(
              ui.SelectContent,
              null,
              h(ui.SelectItem, { value: "own" }, "自己的作品"),
              h(ui.SelectItem, { value: "public" }, "公开作品"),
            ),
          ),
        ),
      ),
      h(
        "div",
        { className: "actions" },
        h(
          ui.Button,
          {
            type: "submit",
            variant: "outline",
            disabled:
              !model.commentItem.trim() ||
              !account() ||
              pending.has("comments"),
          },
          "读取评论",
        ),
      ),
    ),
    model.comments.length
      ? model.comments.map((item) => {
          const target = model.queries.comments,
            id = item.comment_id || item.commentId || item.id,
            body = item.content || item.text || "",
            author = item.nickname || item.user?.nickname || "用户",
            reply = model.replies[id] || "";
          return h(
            "article",
            { key: id || body, className: "record stack compact" },
            h("strong", null, author),
            h("p", { className: "record-body" }, body),
            id &&
              h(ui.Textarea, {
                "aria-label": `回复 ${author}`,
                rows: 2,
                maxLength: 300,
                value: reply,
                placeholder: "输入针对这条评论的回复",
                onChange: (event) => {
                  model.replies[id] = event.target.value;
                  render();
                },
              }),
            id &&
              h(
                "div",
                { className: "actions" },
                h(
                  ui.Button,
                  {
                    variant: "outline",
                    size: "sm",
                    disabled: !reply.trim() || pending.has(`reply:${id}`),
                    onClick: () =>
                      run(`reply:${id}`, async () => {
                        await getHost();
                        await externalWrite(
                          "reply-comment",
                          {
                            accountId: requireAccount(),
                            itemId: target.itemId,
                            commentId: id,
                            content: reply.trim(),
                            targetUrl: target.targetUrl,
                            ownVideo: target.ownVideo,
                            targetComment: body,
                            targetAuthor: author,
                          },
                          JSON.stringify([
                            "reply",
                            model.accountId,
                            target.itemId,
                            id,
                            reply.trim(),
                          ]),
                        );
                        model.view = "jobs";
                      }),
                  },
                  "发送回复",
                ),
              ),
          );
        })
      : h(
          "div",
          { className: "empty" },
          h("p", null, "选择作品或粘贴链接后读取评论。"),
        ),
    model.pages.comments?.has_more &&
      h(
        ui.Button,
        {
          variant: "outline",
          disabled: pending.has("comments"),
          onClick: () => run("comments", () => load("comments", true)),
        },
        "加载更多",
      ),
  );
}
function Search() {
  return h(
    "section",
    { className: "panel stack" },
    h("h2", null, "搜索作品"),
    h(
      "form",
      {
        className: "stack",
        onSubmit: (event) => {
          event.preventDefault();
          void run("search", () => load("search"));
        },
      },
      h(
        ui.Field,
        null,
        h(ui.FieldLabel, { htmlFor: "search-keyword" }, "关键词"),
        h(ui.Input, {
          id: "search-keyword",
          required: true,
          maxLength: 100,
          value: model.keyword,
          placeholder: "搜索感兴趣的话题或作品",
          onChange: (event) => {
            model.keyword = event.target.value;
            render();
          },
        }),
      ),
      model.data.settings.secretConfigured &&
        h(
          ui.Collapsible,
          null,
          h(
            ui.CollapsibleTrigger,
            { render: h(ui.Button, { variant: "ghost", size: "sm" }) },
            "API 搜索参数",
          ),
          h(
            ui.CollapsibleContent,
            null,
            h(ui.Input, {
              "aria-label": "设备标识",
              value: model.deviceId,
              placeholder: "设备标识（选填，留空使用网页登录）",
              onChange: (event) => {
                model.deviceId = event.target.value;
                render();
              },
            }),
          ),
        ),
      h(
        "div",
        { className: "actions" },
        h(
          ui.Button,
          {
            type: "submit",
            disabled:
              !model.keyword.trim() || !account() || pending.has("search"),
          },
          h(ui.Icon, { name: "Search" }),
          pending.has("search") ? "正在搜索…" : "搜索作品",
        ),
      ),
    ),
    h(VideoRecords, { list: model.search, own: false }),
    model.pages.search?.has_more &&
      h(
        ui.Button,
        {
          variant: "outline",
          disabled: pending.has("search"),
          onClick: () => run("search", () => load("search", true)),
        },
        "加载更多",
      ),
  );
}
function Jobs() {
  return h(
    "section",
    { className: "panel" },
    h(
      "div",
      { className: "section-head" },
      h("h2", null, "任务记录"),
      h("span", { className: "caption" }, "状态自动同步"),
    ),
    items("jobs").length
      ? items("jobs").map((job) => {
          const resolve = model.resolving[job.id] || {};
          return h(
            "article",
            { key: job.id, className: "record stack compact" },
            h(
              "div",
              { className: "record-head" },
              h(
                "strong",
                null,
                jobNames[job.browserAction || job.kind] || job.kind,
              ),
              h(
                ui.Badge,
                { variant: statusVariant(job.status) },
                statusLabels[job.status] || job.status,
              ),
            ),
            h(
              "p",
              { className: "record-body" },
              job.message || job.result?.evidence || "按已保存的任务内容执行",
            ),
            h("p", { className: "caption" }, date(job.createdAt)),
            h(
              "div",
              { className: "actions" },
              job.transport === "browser" &&
                job.status === "pending" &&
                h(
                  ui.Button,
                  {
                    size: "sm",
                    disabled: pending.has("ai"),
                    onClick: () => run("ai", () => executeJob(job)),
                  },
                  "交给 AI 执行",
                ),
              job.canCancelRead &&
                h(
                  ui.Button,
                  {
                    variant: "ghost",
                    size: "sm",
                    disabled: pending.has(`cancel:${job.id}`),
                    onClick: () =>
                      run(`cancel:${job.id}`, async () => {
                        await action("cancel-read-job", {
                          jobId: job.id,
                          accountId: job.accountId,
                          evidence: "用户在运营台结束已中断的读取任务。",
                        });
                        await refresh();
                        notify("读取任务已结束。");
                      }),
                  },
                  "结束读取任务",
                ),
              /^https:\/\/www\.douyin\.com\/video\/\d+$/.test(
                job.result?.url || "",
              ) &&
                h(
                  ui.Button,
                  {
                    variant: "outline",
                    size: "sm",
                    onClick: () =>
                      run(`open:${job.id}`, () =>
                        openTarget({ url: job.result.url }),
                      ),
                  },
                  "查看作品",
                ),
            ),
            job.status === "uncertain" &&
              h(
                "form",
                {
                  className: "stack compact",
                  onSubmit: (event) => {
                    event.preventDefault();
                    void run(`resolve:${job.id}`, async () => {
                      await action("resolve-job", {
                        jobId: job.id,
                        outcome: resolve.outcome,
                        evidence: resolve.evidence,
                        resultUrl: resolve.resultUrl || undefined,
                      });
                      await refresh();
                      notify("实际核对结果已保存。");
                    });
                  },
                },
                h(
                  "p",
                  { className: "caption" },
                  "请先核对平台实际结果，再保存依据。",
                ),
                h(
                  ui.Select,
                  {
                    value: resolve.outcome || "",
                    onValueChange: (value) => {
                      model.resolving[job.id] = { ...resolve, outcome: value };
                      render();
                    },
                  },
                  h(
                    ui.SelectTrigger,
                    { "aria-label": "实际核对结果" },
                    h(
                      ui.SelectValue,
                      null,
                      resolve.outcome === "succeeded"
                        ? "确认已成功"
                        : resolve.outcome === "failed"
                          ? "确认未成功"
                          : "选择核对结果",
                    ),
                  ),
                  h(
                    ui.SelectContent,
                    null,
                    h(ui.SelectItem, { value: "succeeded" }, "确认已成功"),
                    h(ui.SelectItem, { value: "failed" }, "确认未成功"),
                  ),
                ),
                h(ui.Textarea, {
                  "aria-label": "核对依据",
                  required: true,
                  rows: 2,
                  value: resolve.evidence || "",
                  placeholder: "实际核对位置、时间和结果",
                  onChange: (event) => {
                    model.resolving[job.id] = {
                      ...resolve,
                      evidence: event.target.value,
                    };
                    render();
                  },
                }),
                resolve.outcome === "succeeded" &&
                  h(ui.Input, {
                    type: "url",
                    "aria-label": "实际作品链接",
                    required:
                      job.transport === "browser" &&
                      [
                        "publish-draft",
                        "reply-comment",
                        "comment-video",
                      ].includes(job.browserAction),
                    value: resolve.resultUrl || "",
                    placeholder: "https://www.douyin.com/video/...",
                    onChange: (event) => {
                      model.resolving[job.id] = {
                        ...resolve,
                        resultUrl: event.target.value,
                      };
                      render();
                    },
                  }),
                h(
                  ui.Button,
                  {
                    type: "submit",
                    variant: "outline",
                    disabled:
                      !resolve.outcome ||
                      !resolve.evidence?.trim() ||
                      pending.has(`resolve:${job.id}`),
                  },
                  "保存核对结果",
                ),
              ),
          );
        })
      : h(
          "div",
          { className: "empty" },
          h("p", null, "发布、读取和评论任务会保存在这里。"),
        ),
  );
}
function App() {
  return h(
    "main",
    { className: "app-shell" },
    h(
      "header",
      { className: "topbar" },
      h(
        "div",
        null,
        h("h1", null, pluginName),
        h("p", { className: "caption" }, "内容、账号和运营任务，一个地方管理"),
      ),
      h(
        "div",
        { className: "account-tools" },
        h(
          ui.Select,
          {
            value: model.accountId,
            disabled: pending.size > 0,
            onValueChange: (id) =>
              run("account-switch", () => selectAccount(id)),
          },
          h(
            ui.SelectTrigger,
            { id: "account", "aria-label": "当前账号" },
            h(ui.SelectValue, null, account()?.nickname || "暂无账号"),
          ),
          h(
            ui.SelectContent,
            null,
            ...model.data.accounts.map((item) =>
              h(
                ui.SelectItem,
                { key: item.id, value: item.id },
                item.nickname || "等待登录",
              ),
            ),
          ),
        ),
        h(
          ui.Button,
          {
            id: "manage-account",
            variant: "outline",
            onClick: () => {
              model.accountsOpen = true;
              model.notice = null;
              render();
            },
          },
          h(ui.Icon, { name: "Settings" }),
          "账号管理",
        ),
        h(
          ui.Button,
          {
            id: "refresh",
            variant: "ghost",
            size: "icon",
            "aria-label": "刷新状态",
            disabled: pending.has("refresh"),
            onClick: () =>
              run("refresh", async () => {
                await refresh();
                notify("状态已刷新。");
              }),
          },
          h(ui.Icon, {
            name: "RefreshCw",
            className: pending.has("refresh") ? "loading-icon" : "",
          }),
        ),
      ),
    ),
    model.notice &&
      !model.accountsOpen &&
      h(
        ui.Alert,
        {
          className: "notice",
          variant: model.notice.error ? "destructive" : "default",
          role: model.notice.error ? "alert" : "status",
        },
        h(ui.AlertDescription, null, model.notice.message),
      ),
    !account() &&
      h(
        "section",
        { className: "panel empty notice" },
        h(ui.Icon, { name: "Plus", size: "l" }),
        h("h2", null, "连接抖音账号"),
        h("p", null, "扫码登录后即可管理内容和运营任务。"),
        h(
          ui.Button,
          {
            id: "add-account",
            onClick: () => {
              model.accountsOpen = true;
              render();
            },
          },
          "添加账号",
        ),
      ),
    h(
      ui.Tabs,
      {
        value: model.view,
        onValueChange: (value) => {
          model.view = value;
          render();
        },
      },
      h(
        ui.TabsList,
        { className: "navigation", "aria-label": "运营功能" },
        ...[
          ["studio", "发布"],
          ["videos", "作品"],
          ["data", "数据"],
          ["comments", "评论"],
          ["search", "搜索"],
          ["jobs", "任务"],
        ].map(([value, label]) =>
          h(ui.TabsTrigger, { key: value, value, "data-view": value }, label),
        ),
      ),
      h(
        ui.TabsContent,
        {
          value: model.view,
          "aria-label": {
            studio: "发布",
            videos: "作品",
            data: "数据",
            comments: "评论",
            search: "搜索",
            jobs: "任务",
          }[model.view],
        },
        h(
          {
            studio: Studio,
            videos: Videos,
            data: Data,
            comments: Comments,
            search: Search,
            jobs: Jobs,
          }[model.view],
        ),
      ),
    ),
    h(Accounts),
  );
}
bootstrap().catch((error) => {
  document.getElementById("app").textContent = error.message;
});
