const pluginId = "wechat-channels-ops",
  pluginName = "视频号运营台",
  pluginVersion = "0.1.15";
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
    videos: [],
    comments: [],
  },
  accountId: "",
  draft: {},
  dirty: false,
  view: "studio",
  accountsOpen: false,
  editing: null,
  importOpen: false,
  sourcePath: "",
  mediaKind: "video",
  commentVideoId: "",
  replies: {},
  notice: null,
};
const account = () =>
  model.data.accounts.find((item) => item.id === model.accountId);
const items = (kind) =>
  model.data[kind].filter((item) => item.accountId === model.accountId);
const jobNames = {
  publish: "发布视频",
  "sync-videos": "同步作品与数据",
  "sync-comments": "读取评论",
  reply: "回复评论",
};
let refreshing;
const dispatchedJobs = new Set();
function refresh() {
  refreshing ??= request("/api/state")
    .then((data) => {
      const priorAssets = model.data.assets;
      data.assets = data.assets.map((asset) => {
        const prior = priorAssets.find((item) => item.id === asset.id);
        return prior?.previewUrl &&
          Number(
            new URL(prior.previewUrl, location.href).searchParams.get(
              "expires",
            ),
          ) >
            Date.now() + 60000
          ? { ...asset, previewUrl: prior.previewUrl }
          : asset;
      });
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
      render();
    })
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}
function requireAccount() {
  if (!account()) throw new Error("请先添加并登录视频号账号。");
  return model.accountId;
}
function editDraft(key, value) {
  model.draft = { ...model.draft, [key]: value };
  model.dirty = true;
  render();
}
async function saveDraft() {
  const { draft } = await action("save-draft", {
    ...model.draft,
    id: model.draft.id || undefined,
    accountId: requireAccount(),
    title: model.draft.title || "未命名草稿",
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
  if (model.dirty) await saveDraft();
  model.accountId = id;
  model.draft = items("drafts")[0] || {};
  model.commentVideoId = "";
  model.replies = {};
  model.notice = null;
  render();
}
async function openTarget(target) {
  const url = new URL(target.url);
  if (
    url.protocol !== "https:" ||
    url.origin !== "https://channels.weixin.qq.com" ||
    url.username ||
    url.password
  )
    throw new Error("无法打开非视频号官方页面。");
  await getHost();
  const result = await hostRequest("ui/open-link", {
    url: url.href,
    browserProfileId: target.browserProfileId || account()?.browserProfileId,
  });
  if (result?.isError)
    throw new Error("账号浏览器未打开，请从主软件重新打开运营台。");
}
async function connect(id) {
  await getHost();
  const existing = model.data.accounts.find((item) => item.id === id);
  if (existing?.status === "verified") {
    await openTarget(await action("browser-target", { accountId: id }));
    return;
  }
  const target = await action("connect-account", id ? { accountId: id } : {});
  await selectAccount(target.account.id);
  await refresh();
  await openTarget(target);
  notify("请在账号浏览器扫码登录，完成后会自动识别。");
}
async function executeJob(job, reconcile = false) {
  await sendAI(
    reconcile
      ? "核对视频号任务的实际结果。"
      : `${jobNames[job.type] || "执行视频号任务"}。`,
    {
      action: reconcile ? "reconcile-job" : "execute-job",
      jobId: job.id,
      accountId: job.accountId,
    },
  );
  if (!reconcile) dispatchedJobs.add(job.id);
}
async function prepare(type, extra = {}) {
  if (!hostReady) await getHost();
  const result = await action("prepare-job", {
    accountId: requireAccount(),
    type,
    operationKey: `${type}:${crypto.randomUUID()}`,
    ...extra,
  });
  await refresh();
  model.view = "jobs";
  if (result.job.status === "prepared" && !dispatchedJobs.has(result.job.id))
    await executeJob(result.job);
  else notify("任务已存在，请查看当前状态。");
}
async function upload(file, kind) {
  if (!file) return;
  const mime = {
    mp4: "video/mp4",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  }[file.name.split(".").pop().toLowerCase()];
  if (
    !mime ||
    (kind === "video" ? mime !== "video/mp4" : !mime.startsWith("image/"))
  )
    throw new Error("请选择支持的视频或封面文件。");
  if (file.size > (kind === "video" ? 512 : 10) * 1024 * 1024)
    throw new Error(
      kind === "video" ? "视频不能超过 512 MiB。" : "封面不能超过 10 MiB。",
    );
  const { asset } = await request("/api/media", {
    method: "POST",
    headers: {
      "Content-Type": mime,
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  editDraft(kind === "video" ? "assetId" : "coverId", asset.id);
  await saveDraft();
  await refresh();
  notify("素材已上传并保存到草稿。");
}
function Accounts() {
  const editing = model.editing;
  return h(
    ui.Dialog,
    {
      open: model.accountsOpen,
      onOpenChange: (open) => {
        model.accountsOpen = open;
        model.editing = null;
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
          "每个账号使用独立的浏览器环境，扫码后自动识别。",
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
          id: "connect-account",
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
                h("strong", null, item.name),
                h(
                  "p",
                  { className: "caption" },
                  item.channelId || "扫码后识别视频号 ID",
                ),
              ),
              h(
                ui.Badge,
                { variant: statusVariant(item.status) },
                statusLabels[item.status] || "待登录",
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
                item.status === "verified" ? "打开账号" : "登录账号",
              ),
              h(
                ui.Button,
                {
                  variant: "ghost",
                  size: "sm",
                  onClick: () => {
                    model.editing = { ...item };
                    render();
                  },
                },
                "编辑资料",
              ),
            ),
          ),
        ),
      ),
      editing &&
        h(
          "form",
          {
            className: "stack",
            onSubmit: (event) => {
              event.preventDefault();
              void run("account-save", async () => {
                await action("save-account", editing);
                model.editing = null;
                await refresh();
                notify("账号资料已保存。");
              });
            },
          },
          h("h3", null, "账号资料"),
          ...[
            ["name", "本地名称"],
            ["positioning", "内容定位"],
            ["audience", "目标受众"],
            ["tone", "表达风格"],
          ].map(([key, label]) =>
            h(
              ui.Field,
              { key },
              h(ui.FieldLabel, { htmlFor: `account-${key}` }, label),
              h(ui.Input, {
                id: `account-${key}`,
                value: editing[key] || "",
                required: key === "name",
                maxLength: 200,
                onChange: (event) => {
                  model.editing = { ...editing, [key]: event.target.value };
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
              { type: "submit", disabled: pending.has("account-save") },
              "保存资料",
            ),
            h(
              ui.Button,
              {
                variant: "ghost",
                onClick: () => {
                  model.editing = null;
                  render();
                },
              },
              "取消",
            ),
          ),
        ),
    ),
  );
}
function Studio() {
  const draft = model.draft,
    asset = model.data.assets.find((item) => item.id === draft.assetId),
    cover = model.data.assets.find((item) => item.id === draft.coverId),
    locked =
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
            model.dirty
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
            disabled: locked,
            onClick: () =>
              run("draft", async () => {
                if (model.dirty) await saveDraft();
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
        h(ui.FieldLabel, { htmlFor: "draft-description" }, "视频文案"),
        h(ui.Textarea, {
          id: "draft-description",
          value: draft.description || "",
          rows: 6,
          maxLength: 2000,
          disabled: locked,
          placeholder: "写下这条视频要表达的内容",
          onChange: (event) => editDraft("description", event.target.value),
        }),
      ),
      h(
        ui.Field,
        null,
        h(ui.FieldLabel, { htmlFor: "draft-topics" }, "话题"),
        h(ui.Input, {
          id: "draft-topics",
          value: Array.isArray(draft.topics)
            ? draft.topics.join(" ")
            : draft.topics || "",
          disabled: locked,
          placeholder: "例如：#生活记录 #日常",
          onChange: (event) => editDraft("topics", event.target.value),
        }),
      ),
      h(
        "div",
        { className: "form-row" },
        ...[
          ["assetId", "视频", "video"],
          ["coverId", "封面", "image"],
        ].map(([key, label, kind]) =>
          h(
            ui.Field,
            { key },
            h(ui.FieldLabel, { htmlFor: `draft-${key}` }, label),
            h(
              ui.Select,
              {
                value: draft[key] || "",
                disabled: locked,
                onValueChange: (value) => editDraft(key, value),
              },
              h(
                ui.SelectTrigger,
                {
                  id: `draft-${key}`,
                  className: "full-width",
                  "aria-label": `选择${label}`,
                },
                h(
                  ui.SelectValue,
                  null,
                  model.data.assets.find((item) => item.id === draft[key])
                    ?.name || `选择${label}`,
                ),
              ),
              h(
                ui.SelectContent,
                null,
                h(ui.SelectItem, { value: "" }, `不选择${label}`),
                ...model.data.assets
                  .filter((item) =>
                    kind === "video"
                      ? item.mimeType === "video/mp4"
                      : item.mimeType?.startsWith("image/"),
                  )
                  .map((item) =>
                    h(
                      ui.SelectItem,
                      { key: item.id, value: item.id },
                      item.name,
                    ),
                  ),
              ),
            ),
            h(
              ui.Button,
              {
                variant: "outline",
                size: "sm",
                disabled: locked || !account(),
                onClick: () => document.getElementById(`file-${kind}`).click(),
              },
              h(ui.Icon, { name: "Upload" }),
              `上传${label}`,
            ),
            h("input", {
              id: `file-${kind}`,
              type: "file",
              className: "file-input",
              accept: kind === "video" ? ".mp4" : ".png,.jpg,.jpeg,.webp",
              onChange: (event) => {
                const file = event.target.files[0];
                event.target.value = "";
                void run("upload", () => upload(file, kind));
              },
            }),
            h(
              "p",
              { className: "caption" },
              kind === "video"
                ? "MP4 · 最大 512 MiB"
                : "PNG / JPG / WebP · 最大 10 MiB",
            ),
          ),
        ),
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
              placeholder: "当前工作区中的 MP4 或图片路径",
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
                  const { asset } = await action("import-media", {
                    sourcePath: model.sourcePath.trim(),
                  });
                  editDraft(
                    asset.mimeType === "video/mp4" ? "assetId" : "coverId",
                    asset.id,
                  );
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
                  await sendAI("为当前视频号草稿起草文案。", {
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
            disabled: locked || !account() || !draft.assetId,
            onClick: () =>
              run("publish", async () => {
                const saved = await saveDraft();
                await prepare("publish", {
                  draftId: saved.id,
                  operationKey: `publish:${saved.id}:v${saved.revision}`,
                });
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
          asset?.previewUrl
            ? h("video", {
                controls: true,
                src: asset.previewUrl,
                poster: cover?.previewUrl,
                preload: "metadata",
              })
            : cover?.previewUrl
              ? h("img", { src: cover.previewUrl, alt: "草稿封面" })
              : h(ui.Icon, { name: "Play", size: "l" }),
          h("strong", null, draft.title || "未命名草稿"),
          h(
            "p",
            { className: "preview-copy" },
            draft.description || "文案将在这里显示",
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
                      disabled: locked,
                      onClick: () =>
                        run("draft", async () => {
                          if (model.dirty) await saveDraft();
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
        h("h2", null, "已同步作品"),
        h("p", { className: "caption" }, "同步账号页面可见的作品与指标"),
      ),
      h(
        ui.Button,
        {
          variant: "outline",
          disabled: !account() || pending.has("sync"),
          onClick: () => run("sync", () => prepare("sync-videos")),
        },
        h(ui.Icon, { name: "RefreshCw" }),
        "同步作品",
      ),
    ),
    items("videos").length
      ? items("videos").map((item) =>
          h(
            "article",
            { key: item.id, className: "record" },
            h(
              "div",
              { className: "record-head" },
              h("strong", null, item.title),
              h(ui.Badge, { variant: "secondary" }, item.status || "已同步"),
            ),
            h(
              "p",
              { className: "caption" },
              date(item.publishedAt || item.updatedAt),
            ),
            h(
              "div",
              { className: "actions" },
              h(
                ui.Button,
                {
                  variant: "outline",
                  size: "sm",
                  onClick: () => {
                    model.commentVideoId = item.id;
                    model.view = "comments";
                    render();
                  },
                },
                "查看评论",
              ),
              item.url &&
                h(
                  ui.Button,
                  {
                    variant: "ghost",
                    size: "sm",
                    onClick: () =>
                      run(`open:${item.id}`, () =>
                        openTarget({ url: item.url }),
                      ),
                  },
                  "打开作品",
                  h(ui.Icon, { name: "ExternalLink" }),
                ),
            ),
          ),
        )
      : h(
          "div",
          { className: "empty" },
          h(ui.Icon, { name: "Play", size: "l" }),
          h("p", null, "暂无作品，点击同步后会显示实际数据。"),
        ),
  );
}
function Data() {
  const videos = items("videos"),
    metrics = [
      ["plays", "播放"],
      ["likes", "点赞"],
      ["comments", "评论"],
      ["shares", "分享"],
    ];
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
          "仅统计已同步的可见指标，缺失值显示为 —",
        ),
      ),
      h(
        "div",
        { className: "actions" },
        h(
          ui.Button,
          {
            variant: "outline",
            disabled: !account() || pending.has("sync"),
            onClick: () => run("sync", () => prepare("sync-videos")),
          },
          "同步数据",
        ),
        h(
          ui.Button,
          {
            variant: "outline",
            disabled: !videos.length || pending.has("ai"),
            onClick: () =>
              run("ai", () =>
                sendAI("分析当前视频号作品数据，给出改进建议。", {
                  action: "review",
                  accountId: requireAccount(),
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
      ...metrics.map(([key, label]) => {
        const known = videos.filter((item) =>
          Number.isFinite(item.metrics?.[key]),
        );
        return h(
          "div",
          { key, className: "metric" },
          h("span", { className: "caption" }, label),
          h(
            "strong",
            null,
            known.length
              ? known
                  .reduce((sum, item) => sum + item.metrics[key], 0)
                  .toLocaleString()
              : "—",
          ),
          h(
            "p",
            { className: "caption" },
            `${known.length} / ${videos.length} 条有数据`,
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
            ...["作品", ...metrics.map((item) => item[1])].map((label) =>
              h(ui.TableHead, { key: label }, label),
            ),
          ),
        ),
        h(
          ui.TableBody,
          null,
          ...videos.map((item) =>
            h(
              ui.TableRow,
              { key: item.id },
              h(ui.TableCell, null, item.title),
              ...metrics.map(([key]) =>
                h(
                  ui.TableCell,
                  { key },
                  Number.isFinite(item.metrics?.[key])
                    ? item.metrics[key].toLocaleString()
                    : "—",
                ),
              ),
            ),
          ),
          !videos.length &&
            h(
              ui.TableRow,
              null,
              h(ui.TableCell, { colSpan: 5 }, "同步作品后可查看数据。"),
            ),
        ),
      ),
    ),
  );
}
function Comments() {
  const videos = items("videos"),
    comments = items("comments").filter(
      (item) => item.videoId === model.commentVideoId,
    );
  return h(
    "section",
    { className: "panel" },
    h(
      "div",
      { className: "section-head" },
      h("h2", null, "作品评论"),
      h(
        "div",
        { className: "actions" },
        h(
          ui.Select,
          {
            value: model.commentVideoId,
            onValueChange: (value) => {
              model.commentVideoId = value;
              render();
            },
          },
          h(
            ui.SelectTrigger,
            { id: "comment-video", "aria-label": "选择评论作品" },
            h(
              ui.SelectValue,
              null,
              videos.find((item) => item.id === model.commentVideoId)?.title ||
                "选择作品",
            ),
          ),
          h(
            ui.SelectContent,
            null,
            ...videos.map((item) =>
              h(ui.SelectItem, { key: item.id, value: item.id }, item.title),
            ),
          ),
        ),
        h(
          ui.Button,
          {
            variant: "outline",
            disabled: !model.commentVideoId || pending.has("comments"),
            onClick: () =>
              run("comments", () =>
                prepare("sync-comments", { videoId: model.commentVideoId }),
              ),
          },
          "读取评论",
        ),
      ),
    ),
    comments.length
      ? comments.map((item) =>
          h(
            "article",
            { key: item.id, className: "record stack compact" },
            h("strong", null, item.author),
            h("p", { className: "record-body" }, item.body),
            h("p", { className: "caption" }, date(item.createdAt)),
            h(ui.Textarea, {
              "aria-label": `回复 ${item.author}`,
              value: model.replies[item.id] || "",
              maxLength: 1000,
              rows: 2,
              placeholder: "输入针对这条评论的回复",
              onChange: (event) => {
                model.replies[item.id] = event.target.value;
                render();
              },
            }),
            h(
              "div",
              { className: "actions" },
              h(
                ui.Button,
                {
                  variant: "outline",
                  size: "sm",
                  disabled:
                    !model.replies[item.id]?.trim() ||
                    pending.has(`reply:${item.id}`),
                  onClick: () =>
                    run(`reply:${item.id}`, () =>
                      prepare("reply", {
                        commentId: item.id,
                        body: model.replies[item.id].trim(),
                        operationKey: `reply:${item.id}`,
                      }),
                    ),
                },
                "发送回复",
              ),
            ),
          ),
        )
      : h(
          "div",
          { className: "empty" },
          h(
            "p",
            null,
            model.commentVideoId
              ? "点击读取评论，完成后会自动显示。"
              : "先同步作品，再选择要查看的作品。",
          ),
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
      ? items("jobs").map((job) =>
          h(
            "article",
            { key: job.id, className: "record" },
            h(
              "div",
              { className: "record-head" },
              h("strong", null, jobNames[job.type] || job.type),
              h(
                ui.Badge,
                { variant: statusVariant(job.status) },
                statusLabels[job.status] || job.status,
              ),
            ),
            h(
              "p",
              { className: "record-body" },
              job.evidence ||
                job.message ||
                job.payload?.description ||
                job.payload?.body ||
                "按已保存的任务内容执行",
            ),
            h("p", { className: "caption" }, date(job.createdAt)),
            h(
              "div",
              { className: "actions" },
              job.status === "prepared" &&
                h(
                  ui.Button,
                  {
                    size: "sm",
                    disabled: pending.has("ai"),
                    onClick: () => run("ai", () => executeJob(job)),
                  },
                  "交给 AI 执行",
                ),
              job.status === "prepared" &&
                h(
                  ui.Button,
                  {
                    size: "sm",
                    variant: "ghost",
                    disabled: pending.has(`cancel:${job.id}`),
                    onClick: () =>
                      run(`cancel:${job.id}`, async () => {
                        await action("cancel-job", { jobId: job.id });
                        await refresh();
                        notify("任务已取消。");
                      }),
                  },
                  "取消任务",
                ),
              ["uncertain", "blocked", "submitted", "reviewing"].includes(
                job.status,
              ) &&
                h(
                  ui.Button,
                  {
                    variant: "outline",
                    size: "sm",
                    disabled: pending.has("ai"),
                    onClick: () => run("ai", () => executeJob(job, true)),
                  },
                  "核对实际结果",
                ),
            ),
          ),
        )
      : h(
          "div",
          { className: "empty" },
          h("p", null, "发布、同步和回复任务会保存在这里。"),
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
            h(ui.SelectValue, null, account()?.name || "暂无账号"),
          ),
          h(
            ui.SelectContent,
            null,
            ...model.data.accounts.map((item) =>
              h(ui.SelectItem, { key: item.id, value: item.id }, item.name),
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
        h("h2", null, "连接视频号账号"),
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
            jobs: "任务",
          }[model.view],
        },
        h(
          {
            studio: Studio,
            videos: Videos,
            data: Data,
            comments: Comments,
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
