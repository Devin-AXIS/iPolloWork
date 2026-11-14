/** Service configuration and call receipts share the account console. */
import { useState } from "react";
import {
  Check,
  ChevronRight,
  KeyRound,
  Pencil,
  Plus,
  X,
  Zap,
} from "lucide-react";
import { api, text, count, type Row, type User } from "./api.js";
import { Modal, Status, Table, useData } from "./components.js";
import { ModelPricing } from "./model-pricing.js";
import { billingSchema, type BillingSpec } from "../src/pricing.js";
import type { ServiceModel } from "../src/model-catalog.js";

import {
  serviceCategories,
  categoryLabels,
  type ServiceCategory,
} from "../src/service-categories.js";

type Model = ServiceModel;
type Service = {
  category?: ServiceCategory;
  vendor?: string;
  billing?: BillingSpec;
  timeoutMs?: number;
  models?: Model[];
  id: string;
  title: string;
  provider: string;
  baseUrl?: string;
  keyId?: string;
  headerName?: string;
  headerPrefix?: string;
  capabilities: string[];
  routes: { method: string; path: string; points: number }[];
  planIds?: string[];
  enabled?: boolean;
  configured?: boolean;
  available?: boolean;
};
type Probe = {
  ok: boolean;
  status: number;
  latency: number;
  reason?: "auth" | "unreachable" | "timeout" | "upstream";
  models: string[];
};

/** OpenAI-compatible chat endpoints; the provider id is what plugins match their own connections against. */
const presets = [
  {
    provider: "deepseek",
    title: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    provider: "aliyun-bailian",
    title: "通义百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    provider: "moonshot",
    title: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
  },
  {
    provider: "zhipu",
    title: "智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    provider: "volcengine-video",
    title: "火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  },
  { provider: "openai", title: "OpenAI", baseUrl: "https://api.openai.com/v1" },
] as const;
const chatRoute = [{ method: "POST", path: "/chat/completions", points: 1 }];
/** Defaults for models added from a provider listing; edit them under advanced settings. */
const MODEL_DEFAULTS = { contextWindow: 131072, maxTokens: 8192 };
const HUES = [205, 172, 148, 38, 14, 218, 190, 28];

/** Stable initial tile for a provider. */
export function Glyph({
  id,
  label,
  size = 30,
}: {
  id: string;
  label: string;
  size?: number;
}) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (
    <span
      className="glyph"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        ["--hue" as string]: String(HUES[Math.abs(hash) % HUES.length]),
      }}
    >
      {Array.from(label.trim())[0]?.toUpperCase() ?? "·"}
    </span>
  );
}
const host = (url?: string) => {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return url ?? "";
  }
};
function probeText(result: Probe, chat?: Probe) {
  if (!result.ok)
    return {
      auth: "Key 无效或无权限",
      unreachable: "无法连接到接口地址",
      timeout: "连接超时（10 秒）",
      upstream: `接口返回 ${result.status}`,
    }[result.reason ?? "upstream"];
  const parts = [`已连通 · ${result.latency}ms`];
  if (result.models.length) parts.push(`${result.models.length} 个模型`);
  if (chat)
    parts.push(
      chat.ok
        ? `对话正常 · ${chat.latency}ms`
        : chat.reason === "auth"
          ? "对话被拒绝"
          : `对话失败（${chat.status || "无响应"}）`,
    );
  return parts.join(" · ");
}

export function Services({ user }: { user: User }) {
  const admin = user.role === "admin",
    path = admin ? "/api/v1/admin/services" : "/api/v1/services";
  const data = useData<{ items: Service[] }>(path),
    usage = useData<{ items: Row[] }>(
      admin ? "/api/v1/admin/service-calls" : "/api/v1/services/usage",
    );
  const [category, setCategory] = useState<ServiceCategory | "all">("all");
  const [editing, setEditing] = useState<Service | null>();
  const [connection, setConnection] = useState<Service[]>();
  const [syncing, setSyncing] = useState<string>();
  const [notice, setNotice] = useState("");
  const [results, setResults] = useState<
    Record<string, { result: Probe; chat?: Probe } | "busy">
  >({});
  const [error, setError] = useState("");
  const test = async (s: Service) => {
    setResults((r) => ({ ...r, [s.id]: "busy" }));
    const draft = {
      baseUrl: s.baseUrl,
      keyId: s.keyId,
      headerName: s.headerName,
      headerPrefix: s.headerPrefix,
    };
    try {
      const result = await api<Probe>("/api/v1/admin/services/probe", draft);
      const model = s.models?.[0]?.id;
      const chat =
        result.ok && model && s.category === "language"
          ? await api<Probe>("/api/v1/admin/services/probe", {
              ...draft,
              model,
            })
          : undefined;
      setResults((r) => ({
        ...r,
        [s.id]: chat ? { result, chat } : { result },
      }));
    } catch (e) {
      setResults((r) => {
        const next = { ...r };
        delete next[s.id];
        return next;
      });
      setError(e instanceof Error ? e.message : "测试失败");
    }
  };
  const toggle = async (s: Service) => {
    setError("");
    try {
      await api(
        path,
        {
          id: s.id,
          title: s.title,
          provider: s.provider,
          baseUrl: s.baseUrl,
          keyId: s.keyId,
          headerName: s.headerName,
          headerPrefix: s.headerPrefix,
          capabilities: s.capabilities,
          routes: s.routes,
          models: s.models ?? [],
          category: s.category,
          vendor: s.vendor,
          planIds: s.planIds ?? [],
          billing: s.billing,
          timeoutMs: s.timeoutMs,
          enabled: !s.enabled,
        },
        "PUT",
      );
      data.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  };
  const visibleServices=(data.data?.items??[]).filter(s=>category==="all"||(s.category??"language")===category);
  const groups = Object.values(visibleServices.reduce<Record<string, Service[]>>((result, service) => { const key = service.keyId ?? service.id; (result[key] ??= []).push(service); return result; }, {}));
  const sync = async (service: Service) => {
    setSyncing(service.keyId); setError(""); setNotice("");
    try { const result = await api<{ total: number; imported: number; unpriced: number }>(`/api/v1/admin/services/${service.id}/sync-models`, {}); setNotice(`已同步 ${result.total} 个模型，新增 ${result.imported} 个；${result.unpriced} 个需要配置价格`); data.reload(); }
    catch (error) { setError(error instanceof Error ? error.message : "同步失败"); }
    finally { setSyncing(undefined); }
  };
  return (
    <>
      <div className="toolbar">
        <span>官方服务由后台统一配置，插件按账号积分调用</span>
        {admin && (
          <button className="primary" onClick={() => setEditing(null)}>
            <Plus size={15} />
            添加服务
          </button>
        )}
      </div>
      <Status error={error} />
      {notice && <p role="status">{notice}</p>}
      <div className="presets" role="group" aria-label="服务类型">
        <button
          aria-pressed={category === "all"}
          onClick={() => setCategory("all")}
        >
          全部
        </button>
        {serviceCategories.map((value) => (
          <button
            key={value}
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            {categoryLabels[value]}
          </button>
        ))}
      </div>
      <section className="panel glass-list">
        {data.data && data.data.items.length>0 && !visibleServices.length && <div className="empty-state">暂无此类服务</div>}
        <Status error={data.error} loading={!data.data} />
        {data.data && !data.data.items.length && (
          <div className="empty-state">
            <span className="empty-art" aria-hidden="true">
              <Zap size={18} />
            </span>
            <strong>还没有官方服务</strong>
            <small>
              {admin
                ? "选一个模型厂商，粘贴 Key 就能用"
                : "管理员配置后，这里会显示可用服务"}
            </small>
            {admin && (
              <button className="primary" onClick={() => setEditing(null)}>
                <Plus size={15} />
                添加服务
              </button>
            )}
          </div>
        )}
        {groups.map(group => <div className="provider-group" key={group[0].keyId ?? group[0].id}>
          <div className="provider-heading"><div><strong>{group[0].provider === "aliyun-bailian" ? "阿里云百炼" : group[0].provider === "minimax" ? "MiniMax" : group[0].provider === "volcengine-video" ? "火山方舟" : group[0].title}</strong><small>{group.some(row => row.configured) ? "Key 已配置" : "待配置 Key"} · 同一个 Key 供全部能力使用</small></div>{admin && <div className="row-actions">
            {["aliyun-bailian","volcengine-video"].includes(group[0].provider) && <button disabled={!group.some(row => row.configured) || syncing === group[0].keyId} onClick={() => void sync(group[0])}>{syncing === group[0].keyId ? "同步中…" : "同步全部模型"}</button>}
            <button onClick={() => setConnection(group)}>配置 Key</button>
          </div>}</div>
          {group.map((s) => {
            const entry = results[s.id];
            const done = entry && entry !== "busy" ? entry : undefined;
            const passed = done
              ? done.result.ok && (done.chat?.ok ?? true)
              : false;
            const state = admin
              ? !s.enabled
                ? "off"
                : s.configured
                  ? "on"
                  : "warn"
              : s.available
                ? "on"
                : "off";
            return (
              <div key={s.id} className="service-row">
                <Glyph id={s.provider} label={s.title} />
                <div className="service-main">
                  <strong>{s.title}</strong>
                  <small>
                    <i className="dot" data-state={state} />
                    {admin
                      ? !s.enabled
                        ? "已停用"
                        : s.configured
                          ? "已启用"
                          : "待填写 Key"
                      : s.available
                        ? "可用"
                        : "当前套餐不可用"}
                    <span className="sep" />
                    {categoryLabels[s.category ?? "language"]} ·{" "}
                    {s.vendor ?? s.provider} · {host(s.baseUrl) || s.provider}
                    {s.billing && (
                      <>
                        <span className="sep" />
                        按实际用量计费
                      </>
                    )}
                    {s.models?.length ? (
                      <>
                        <span className="sep" />
                        {s.models.length} 个模型
                      </>
                    ) : null}
                  </small>
                </div>
                {done && (
                  <span className="probe" data-ok={passed}>
                    {passed ? <Check size={12} /> : <X size={12} />}
                    {probeText(done.result, done.chat)}
                  </span>
                )}
                {admin && (
                  <div className="row-actions">
                    <button
                      className="ghost"
                      disabled={entry === "busy" || !s.configured}
                      onClick={() => void test(s)}
                    >
                      <Zap size={14} />
                      {entry === "busy" ? "测试中…" : "测试"}
                    </button>
                    <button
                      className="switch"
                      role="switch"
                      aria-checked={Boolean(s.enabled)}
                      aria-label={`启用 ${s.title}`}
                      onClick={() => void toggle(s)}
                    >
                      <span />
                    </button>
                    <button
                      className="icon ghost"
                      aria-label={`编辑 ${s.title}`}
                      onClick={() => setEditing(s)}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>)}
      </section>
      <section className="panel usage">
        <div className="section-title">服务用量</div>
        <Status error={usage.error} loading={!usage.data} />
        {usage.data && (
          <Table
            rows={usage.data.items}
            columns={[
              { label: "服务", cell: (r) => text(r.service_id) },
              {
                label: "状态",
                cell: (r) => (
                  <span className="badge">
                    {(
                      {
                        succeeded: "成功",
                        failed: "失败",
                        running: "进行中",
                        unknown: "待核对",
                      } as Record<string, string>
                    )[text(r.state)] ?? text(r.state)}
                  </span>
                ),
              },
              { label: "积分", cell: (r) => count(r.points) },
              {
                label: "原价成本",
                cell: (r) =>
                  r.cost_micros == null
                    ? "待结算"
                    : "¥" + (Number(r.cost_micros) / 1000000).toFixed(4),
              },
              ...(admin
                ? [
                    {
                      label: "核对",
                      cell: (r: Row) =>
                        r.state === "unknown" ? (
                          <div className="actions">
                            <button
                              onClick={async () => {
                                await api(
                                  "/api/v1/admin/service-calls/" +
                                    r.id +
                                    "/reconcile",
                                  { outcome: "succeeded" },
                                );
                                usage.reload();
                              }}
                            >
                              确认已执行
                            </button>
                            <button
                              onClick={async () => {
                                await api(
                                  "/api/v1/admin/service-calls/" +
                                    r.id +
                                    "/reconcile",
                                  { outcome: "failed" },
                                );
                                usage.reload();
                              }}
                            >
                              确认失败并退款
                            </button>
                          </div>
                        ) : (
                          "—"
                        ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </section>
      {editing !== undefined && (
        <ServiceEditor
          service={editing}
          path={path}
          close={() => setEditing(undefined)}
          saved={() => {
            setEditing(undefined);
            data.reload();
          }}
        />
      )}
      {connection && <ProviderConnection services={connection} close={() => setConnection(undefined)} saved={() => { setConnection(undefined); data.reload(); }} />}
    </>
  );
}

function ProviderConnection({ services, close, saved }: { services: Service[]; close(): void; saved(): void }) {
  const service = services[0];
  const multipleOrigins = service.provider === "volcengine-video" || new Set(services.map(service=>new URL(service.baseUrl!).origin)).size > 1;
  const [key, setKey] = useState("");
  const [origin, setOrigin] = useState(new URL(service.baseUrl!).origin);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try { await api(`/api/v1/admin/service-connections/${service.keyId}`, { ...(key ? { key } : {}), ...(!multipleOrigins ? {origin} : {}), enabled }); saved(); }
    catch (error) { setError(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  };
  return <Modal title="配置服务连接" close={close}><div className="editor">
    <p>一个 Key 统一用于该服务商的语言、图像、视频和语音等能力</p>
    {multipleOrigins ? <p>使用已授权方舟和豆包语音的 IAM 通用 API Key；各能力保留自己的官方接口地址</p> : <label className="field"><span>{service.provider === "aliyun-bailian" ? "百炼业务空间地址" : "服务域名"}</span><input type="url" value={origin} onChange={e => setOrigin(e.target.value)} />{service.provider === "aliyun-bailian" && <small>新业务空间请填写控制台提供的域名，如 https://业务空间ID.cn-beijing.maas.aliyuncs.com；同一空间的各家模型共用一个 Key</small>}</label>}
    <label className="field"><span>API Key</span><input type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder={service.configured ? "已保存，留空保持不变" : "填写 API Key"} /></label>
    <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> 开放已定价的模型</label>
    <Status error={error} /><div className="editor-foot"><span className="grow" /><button onClick={close}>取消</button><button className="primary" disabled={busy || (!key && !service.configured)} onClick={() => void save()}>{busy ? "保存中…" : "保存连接"}</button></div>
  </div></Modal>;
}

function ServiceEditor({
  service,
  path,
  close,
  saved,
}: {
  service: Service | null;
  path: string;
  close(): void;
  saved(): void;
}) {
  const fresh = !service;
  const [preset, setPreset] = useState<string>(
    service
      ? (presets.find((p) => p.provider === service.provider)?.provider ??
          "custom")
      : "deepseek",
  );
  const initial = presets.find((p) => p.provider === preset);
  const [form, setForm] = useState({
    id: service?.id ?? "official-" + (initial?.provider ?? "custom"),
    title: service?.title ?? initial?.title ?? "",
    provider: service?.provider ?? initial?.provider ?? "",
    category: service?.category ?? ("language" as ServiceCategory),
    baseUrl: service?.baseUrl ?? initial?.baseUrl ?? "",
    keyId: service?.keyId ?? initial?.provider ?? "",
    key: "",
    headerName: service?.headerName ?? "Authorization",
    headerPrefix: service?.headerPrefix ?? "Bearer ",
    capabilities: (service?.capabilities ?? ["chat"]).join(", "),
    routes: JSON.stringify(service?.routes ?? chatRoute, null, 2),
    planIds: service?.planIds?.join(", ") ?? "",
    enabled: service?.enabled ?? true,
  });
  const [models, setModels] = useState<Model[]>(service?.models ?? []);
  const [modelsText, setModelsText] = useState<string>();
  const [billingText, setBillingText] = useState(
    service?.billing ? JSON.stringify(service.billing, null, 2) : "",
  );
  const [probe, setProbe] = useState<
    { result: Probe; chat?: Probe } | "busy"
  >();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (patch: Partial<typeof form>) =>
    setForm((f) => ({ ...f, ...patch }));
  const updateModels = (next: Model[]) => {
    setModels(next);
    setModelsText(undefined);
  };
  const choose = (id: string) => {
    setPreset(id);
    setProbe(undefined);
    const p = presets.find((x) => x.provider === id);
    if (!p) {
      set({
        title: "",
        baseUrl: "",
        ...(fresh ? { id: "", provider: "", keyId: "" } : {}),
      });
      return;
    }
    set({
      title: p.title,
      baseUrl: p.baseUrl,
      ...(fresh
        ? {
            id: "official-" + p.provider,
            provider: p.provider,
            keyId: p.provider,
          }
        : {}),
    });
  };
  const draft = () => ({
    baseUrl: form.baseUrl,
    keyId: form.keyId,
    headerName: form.headerName,
    headerPrefix: form.headerPrefix,
    ...(form.key ? { key: form.key } : {}),
  });
  const runProbe = async () => {
    setProbe("busy");
    setError("");
    try {
      const result = await api<Probe>("/api/v1/admin/services/probe", draft());
      let selected = models;
      if (result.ok && result.models.length) {
        if (!models.length) {
          selected = result.models
            .slice(0, result.models.length <= 6 ? 6 : 3)
            .map((id) => ({ id, name: id, ...MODEL_DEFAULTS }));
          updateModels(selected);
        }
      }
      const chat =
        result.ok && form.category === "language" && selected[0]
          ? await api<Probe>("/api/v1/admin/services/probe", {
              ...draft(),
              model: selected[0].id,
            })
          : undefined;
      setProbe(chat ? { result, chat } : { result });
    } catch (e) {
      setProbe(undefined);
      setError(e instanceof Error ? e.message : "测试失败");
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const routes = JSON.parse(form.routes);
      const modelList =
        modelsText === undefined ? models : JSON.parse(modelsText);
      await api(
        path,
        {
          id: form.id,
          title: form.title,
          provider: form.provider,
          baseUrl: form.baseUrl,
          keyId: form.keyId,
          ...(form.key ? { key: form.key } : {}),
          headerName: form.headerName,
          headerPrefix: form.headerPrefix,
          capabilities: form.capabilities
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          routes,
          models: modelList.map((model: Model) => ({
            ...model,
            category: model.category ?? form.category,
          })),
          category: form.category,
          vendor: form.provider,
          planIds: form.planIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          enabled: form.enabled,
          billing: billingText.trim()
            ? JSON.parse(billingText)
            : service?.billing,
          timeoutMs: service?.timeoutMs,
        },
        "PUT",
      );
      saved();
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "高级设置里的 JSON 格式不正确"
          : e instanceof Error
            ? e.message
            : "保存失败",
      );
    } finally {
      setBusy(false);
    }
  };
  let parsedBilling: BillingSpec | undefined;
  try { const parsed = billingSchema.safeParse(billingText ? JSON.parse(billingText) : undefined); if (parsed.success) parsedBilling = parsed.data; }
  catch (_error) { /* The advanced editor preserves incomplete JSON until Save validates it. */ }
  const p = probe && probe !== "busy" ? probe : undefined;
  const passed = p ? p.result.ok && (p.chat?.ok ?? true) : false;
  return (
    <Modal title={fresh ? "添加服务" : "配置服务"} close={close}>
      <div className="editor">
        <div className="presets" role="radiogroup" aria-label="服务商">
          {presets.map((x) => (
            <button
              key={x.provider}
              type="button"
              role="radio"
              aria-checked={preset === x.provider}
              onClick={() => choose(x.provider)}
            >
              <Glyph id={x.provider} label={x.title} size={24} />
              <span>{x.title}</span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={preset === "custom"}
            onClick={() => choose("custom")}
          >
            <span className="glyph custom" aria-hidden="true">
              <Plus size={12} />
            </span>
            <span>自定义</span>
          </button>
        </div>
        <label className="field">
          <span>服务类型</span>
          <select
            value={form.category}
            onChange={(e) => {
              const category = e.target.value as ServiceCategory;
              set({ category });
              updateModels(models.map((model) => ({ ...model, category })));
            }}
          >
            {serviceCategories.map((value) => (
              <option key={value} value={value}>
                {categoryLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <div className="field-stack">
          <label className="pill-field">
            <span>名称</span>
            <input
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              required
              placeholder="例如 DeepSeek"
            />
          </label>
          <label className="pill-field">
            <span>接口地址</span>
            <input
              value={form.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              type="url"
              required
              placeholder="https://…/v1"
            />
          </label>
          {fresh && <label className="pill-field">
            <span>
              <KeyRound size={13} />
              Key
            </span>
            <input
              value={form.key}
              onChange={(e) => set({ key: e.target.value })}
              type="password"
              autoComplete="new-password"
              placeholder="粘贴 API Key"
            />
            <button
              type="button"
              className="inline-test"
              disabled={
                probe === "busy" ||
                !form.baseUrl ||
                !form.keyId ||
                !form.key
              }
              onClick={() => void runProbe()}
            >
              <Zap size={13} />
              {probe === "busy" ? "测试中…" : "测试"}
            </button>
          </label>}
        </div>
        {p && (
          <p className="probe wide" data-ok={passed}>
            {passed ? <Check size={13} /> : <X size={13} />}
            {probeText(p.result, p.chat)}
          </p>
        )}
        <ModelPricing models={models} setModels={updateModels} billing={parsedBilling} setBilling={value => setBillingText(JSON.stringify(value, null, 2))} category={form.category} source={form.baseUrl} />
        <details className="advanced">
          <summary>
            <ChevronRight size={14} />
            高级设置
          </summary>
          <div className="form-grid">
            <label className="field">
              <span>服务标识</span>
              <input
                value={form.id}
                readOnly={!fresh}
                onChange={(e) => set({ id: e.target.value })}
              />
            </label>
            <label className="field">
              <span>服务商标识</span>
              <input
                value={form.provider}
                onChange={(e) => set({ provider: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Key 标识</span>
              <input
                value={form.keyId}
                onChange={(e) => set({ keyId: e.target.value })}
              />
            </label>
            <label className="field">
              <span>能力（逗号分隔）</span>
              <input
                value={form.capabilities}
                onChange={(e) => set({ capabilities: e.target.value })}
              />
            </label>
            <label className="field">
              <span>认证请求头</span>
              <input
                value={form.headerName}
                onChange={(e) => set({ headerName: e.target.value })}
              />
            </label>
            <label className="field">
              <span>认证前缀</span>
              <input
                value={form.headerPrefix}
                onChange={(e) => set({ headerPrefix: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>请求路由与每次积分</span>
            <textarea
              rows={4}
              value={form.routes}
              onChange={(e) => set({ routes: e.target.value })}
            />
          </label>
          <label className="field">
            <span>模型参数</span>
            <textarea
              rows={4}
              value={modelsText ?? JSON.stringify(models, null, 2)}
              onChange={(e) => setModelsText(e.target.value)}
            />
          </label>
          <label className="field">
            <span>用量计费规则（JSON，包含原价与有效期）</span>
            <textarea
              rows={6}
              value={billingText}
              onChange={(e) => setBillingText(e.target.value)}
            />
          </label>
          <label className="field">
            <span>可用套餐 ID（留空则所有登录用户可用）</span>
            <input
              value={form.planIds}
              onChange={(e) => set({ planIds: e.target.value })}
            />
          </label>
        </details>
        <Status error={error} />
        <div className="editor-foot">
          <label className="switch-label">
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={form.enabled}
              onClick={() => set({ enabled: !form.enabled })}
            >
              <span />
            </button>
            启用
          </label>
          <span className="grow" />
          <button type="button" onClick={close}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              busy ||
              !form.title ||
              !form.baseUrl ||
              !form.id ||
              !form.provider ||
              !form.keyId
            }
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
