/** Service configuration and call receipts share the account console. */
import { useState } from "react";
import { api, text, count, type Row, type User } from "./api.js";
import {
  ActionForm,
  Field,
  Modal,
  Status,
  Table,
  useData,
  value,
} from "./components.js";
type Service = {
  models?: {
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
  }[];
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
export function Services({ user }: { user: User }) {
  const admin = user.role === "admin",
    path = admin ? "/api/v1/admin/services" : "/api/v1/services";
  const data = useData<{ items: Service[] }>(path),
    usage = useData<{ items: Row[] }>(
      admin ? "/api/v1/admin/service-calls" : "/api/v1/services/usage",
    );
  const [editing, setEditing] = useState<Service | null>();
  return (
    <>
      <div className="toolbar">
        <p>官方服务由后台统一配置，插件使用账号额度调用。</p>
        {admin && (
          <button className="primary" onClick={() => setEditing(null)}>
            添加服务
          </button>
        )}
      </div>
      <section className="panel">
        <Status error={data.error} loading={!data.data} />
        {data.data && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>服务</th>
                  <th>能力</th>
                  <th>状态</th>
                  {admin && <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {data.data.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.title}
                      <small> {s.provider}</small>
                    </td>
                    <td>{s.capabilities.join(" · ")}</td>
                    <td>
                      {admin
                        ? s.enabled
                          ? s.configured
                            ? "已启用"
                            : "待配置 Key"
                          : "已停用"
                        : s.available
                          ? "可用"
                          : "当前套餐不可用"}
                    </td>
                    {admin && (
                      <td>
                        <button onClick={() => setEditing(s)}>配置</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>服务用量</h2>
        <Status error={usage.error} loading={!usage.data} />
        {usage.data && (
          <Table
            rows={usage.data.items}
            columns={[
              { label: "服务", cell: (r) => text(r.service_id) },
              { label: "状态", cell: (r) => text(r.state) },
              { label: "积分", cell: (r) => count(r.points) },
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
        <Modal
          title={editing ? "配置服务" : "添加服务"}
          close={() => setEditing(undefined)}
        >
          <ActionForm
            submit={async (f) => {
              await api(
                path,
                {
                  id: value(f, "id"),
                  title: value(f, "title"),
                  provider: value(f, "provider"),
                  baseUrl: value(f, "baseUrl"),
                  keyId: value(f, "keyId"),
                  key: value(f, "key"),
                  headerName: value(f, "headerName"),
                  headerPrefix: value(f, "headerPrefix"),
                  capabilities: value(f, "capabilities")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  routes: JSON.parse(value(f, "routes")),
                  models: JSON.parse(value(f, "models")),
                  planIds: value(f, "planIds")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  enabled: f.has("enabled"),
                },
                "PUT",
              );
              setEditing(undefined);
              data.reload();
            }}
          >
            <Field label="服务标识">
              <input
                name="id"
                required
                readOnly={Boolean(editing)}
                defaultValue={editing?.id}
              />
            </Field>
            <Field label="名称">
              <input name="title" required defaultValue={editing?.title} />
            </Field>
            <Field label="服务商标识">
              <input
                name="provider"
                required
                defaultValue={editing?.provider}
              />
            </Field>
            <Field label="接口基础地址">
              <input
                name="baseUrl"
                type="url"
                required
                defaultValue={editing?.baseUrl}
              />
            </Field>
            <Field label="共享 Key 标识">
              <input name="keyId" required defaultValue={editing?.keyId} />
            </Field>
            <Field label="API Key（留空保留）">
              <input name="key" type="password" autoComplete="new-password" />
            </Field>
            <Field label="认证请求头">
              <input
                name="headerName"
                defaultValue={editing?.headerName ?? "Authorization"}
              />
            </Field>
            <Field label="认证前缀">
              <input
                name="headerPrefix"
                defaultValue={editing?.headerPrefix ?? "Bearer "}
              />
            </Field>
            <Field label="能力标识（逗号分隔）">
              <input
                name="capabilities"
                required
                defaultValue={editing?.capabilities.join(",")}
              />
            </Field>
            <Field label="允许的请求与每次积分">
              <textarea
                name="routes"
                rows={5}
                required
                defaultValue={JSON.stringify(
                  editing?.routes ?? [
                    { method: "POST", path: "/chat/completions", points: 1 },
                  ],
                  null,
                  2,
                )}
              />
            </Field>
            <Field label="模型目录（仅大模型服务）">
              <textarea
                name="models"
                rows={4}
                defaultValue={JSON.stringify(editing?.models ?? [], null, 2)}
              />
            </Field>
            <Field label="可用套餐 ID（留空允许所有登录用户）">
              <input
                name="planIds"
                defaultValue={editing?.planIds?.join(",")}
              />
            </Field>
            <label>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={editing?.enabled}
              />{" "}
              启用服务
            </label>
          </ActionForm>
        </Modal>
      )}
    </>
  );
}
