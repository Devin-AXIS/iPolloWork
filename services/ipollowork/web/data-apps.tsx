/** Operator view of every app data store, and the consent step of signing in to an app with an iPollo account. */
import { useState } from "react";
import { api, count, date, text, type Row } from "./api.js";
import { Status, Table, useData } from "./components.js";

const size = (value: unknown) => {
  const bytes = Number(value ?? 0);
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
};
interface Listing {
  items: (Row & { owner: { kind: string; name: string } })[];
  totals: { apps: number; records: number; bytes: number; stored: number };
}

/** Every app of the deployment: who owns it, how much it holds, and controls to suspend, resume or delete it. */
export function DataApps() {
  const [q, setQ] = useState(""),
    [sort, setSort] = useState("bytes"),
    [error, setError] = useState(""),
    list = useData<Listing>(`/api/v1/admin/data-apps?sort=${sort}&q=${encodeURIComponent(q)}`);
  const act = async (work: () => Promise<unknown>) => {
    setError("");
    try {
      await work();
      list.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    }
  };
  const totals = list.data?.totals;
  return (
    <>
      <div className="toolbar">
        <input type="search" aria-label="搜索应用" placeholder="应用名、用户或组织" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="bytes">占用最多</option>
          <option value="updated">最近更新</option>
        </select>
      </div>
      {totals && (
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--muted)" }}>
          共 {count(totals.apps)} 个应用 · {count(totals.records)} 条记录 · 数据 {size(totals.bytes)} · 数据库实际占用 {size(totals.stored)}
        </p>
      )}
      <Status error={error} />
      <section className="panel">
        <Status error={list.error} loading={!list.data} />
        {list.data && (
          <Table
            rows={list.data.items}
            columns={[
              {
                label: "应用",
                cell: (r) => (
                  <span>
                    {text(r.name)}
                    <small>{r.kind === "site" ? "对外应用" : "插件"}</small>
                  </span>
                ),
              },
              {
                label: "归属",
                cell: (r) => {
                  const owner = (r as Listing["items"][number]).owner;
                  return (
                    <span>
                      {owner.name || "已不存在"}
                      <small>{owner.kind === "enterprise" ? "组织" : "个人"}</small>
                    </span>
                  );
                },
              },
              { label: "数据表", cell: (r) => count(r.collections) },
              { label: "记录", cell: (r) => count(r.records) },
              { label: "占用", cell: (r) => size(r.bytes) },
              { label: "状态", cell: (r) => (r.suspended ? "已暂停" : "正常") },
              { label: "最近更新", cell: (r) => date(r.updatedAt) },
              {
                label: "操作",
                cell: (r) => (
                  <span className="row-actions">
                    <button type="button" className="ghost"
                      onClick={() => void act(() => api(`/api/v1/admin/data-apps/${text(r.id)}/suspend`, { suspended: !r.suspended }))}>
                      {r.suspended ? "恢复" : "暂停"}
                    </button>
                    <button type="button" className="ghost"
                      onClick={() => {
                        if (confirm(`永久删除「${text(r.name)}」和它的 ${count(r.records)} 条记录？使用它的插件和网页将无法再读写。`))
                          void act(() => api(`/api/v1/admin/data-apps/${text(r.id)}`, undefined, "DELETE"));
                      }}>
                      删除
                    </button>
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}

/** Ask the signed-in account whether an app may learn who they are, then return to the app's page with the sign-in. */
export function Connect({ name }: { name: string }) {
  const query = new URLSearchParams(location.search),
    input = { app: query.get("app") ?? "", key: query.get("key") ?? "", return: query.get("return") ?? "" },
    shown = useData<{ name: string; origin: string }>("/api/v1/data-signin?" + new URLSearchParams(input).toString()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="auth">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-panel">
        <span className="auth-mark">
          <img src="/mark.svg" alt="iPollo" width="22" />
        </span>
        <h1>登录「{shown.data?.name ?? "…"}」</h1>
        <Status error={shown.error || error} loading={!shown.data && !shown.error} />
        {shown.data && (
          <>
            <p>
              以 {name} 的身份继续。「{shown.data.name}」会知道你的昵称，并保存你在其中提交的内容；它拿不到你的密码、积分和其他应用的数据。完成后返回 {shown.data.origin}。
            </p>
            <button className="primary submit" disabled={busy}
              onClick={() => {
                setBusy(true);
                api<{ url: string }>("/api/v1/data-signin", input)
                  .then((done) => location.replace(done.url))
                  .catch((cause) => {
                    setError(cause instanceof Error ? cause.message : "登录失败");
                    setBusy(false);
                  });
              }}>
              {busy ? "处理中…" : "继续"}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => history.back()}>
              取消
            </button>
          </>
        )}
      </div>
    </main>
  );
}
