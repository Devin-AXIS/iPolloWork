import { useState } from "react";
import { Plus, ArrowLeft, Copy, Download, Search } from "lucide-react";
import { StorageQuota } from "./storage.js";
import { api, count, date, text, type Row, type User } from "./api.js";
import {
  ActionForm,
  Field,
  Modal,
  Status,
  Table,
  useData,
  value,
} from "./components.js";

function Add({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button className="primary" onClick={onClick}>
      <Plus size={15} />
      {children}
    </button>
  );
}
function Message({ content }: { content: string }) {
  return content ? (
    <div className="notice" role="status">
      {content}
    </div>
  ) : null;
}
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-link">
      <input aria-label="分享链接" readOnly value={url} />
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        <Copy size={14} />
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}
export function Enterprises({ user }: { user: User }) {
  const list = useData<{ items: Row[] }>("/api/v1/enterprises"),
    [create, setCreate] = useState(false),
    [selected, select] = useState("");
  if (selected)
    return (
      <Enterprise
        user={user}
        id={selected}
        back={() => {
          select("");
          list.reload();
        }}
      />
    );
  return (
    <>
      <div className="toolbar">
        <span>组织成员共同使用项目与资源</span>
        <Add onClick={() => setCreate(true)}>创建组织</Add>
      </div>
      <section className="panel">
        <Status error={list.error} loading={!list.data} />
        {list.data && (
          <Table
            rows={list.data.items}
            columns={[
              {
                label: "组织",
                cell: (r) => (
                  <button className="link" onClick={() => select(text(r.id))}>
                    {text(r.name)}
                  </button>
                ),
              },
              { label: "成员", cell: (r) => count(r.member_count) },
              { label: "创建时间", cell: (r) => date(r.created_at) },
              {
                label: "",
                cell: (r) => (
                  <button onClick={() => select(text(r.id))}>管理</button>
                ),
              },
            ]}
          />
        )}
      </section>
      {create && (
        <Modal title="创建组织" close={() => setCreate(false)}>
          <ActionForm
            label="创建"
            submit={async (f) => {
              const result = await api<{ id: string }>("/api/v1/enterprises", {
                name: value(f, "name"),
              });
              setCreate(false);
              select(result.id);
            }}
          >
            <Field label="组织名称">
              <input autoFocus name="name" required maxLength={120} />
            </Field>
          </ActionForm>
        </Modal>
      )}
    </>
  );
}
function Enterprise({
  id,
  back,
  user,
}: {
  id: string;
  back: () => void;
  user: User;
}) {
  const result = useData<{
    enterprise: Row;
    members: Row[];
    departments: Row[];
    invitations: Row[];
  }>("/api/v1/enterprises/" + id);
  const [modal, setModal] = useState(""),
    [link, setLink] = useState(""),
    [edit, setEdit] = useState<Row>(),
    [message, setMessage] = useState("");
  const refresh = () => {
    setModal("");
    setEdit(undefined);
    result.reload();
  };
  async function remove(userId: string) {
    try {
      await api(
        "/api/v1/enterprises/" + id + "/members/" + userId,
        undefined,
        "DELETE",
      );
      result.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败");
    }
  }
  return (
    <>
      <div className="toolbar">
        <button onClick={back}>
          <ArrowLeft size={14} />
          全部组织
        </button>
        <div className="actions">
          <button onClick={() => setModal("department")}>添加部门</button>
          <Add onClick={() => setModal("invite")}>邀请成员</Add>
        </div>
      </div>
      <Status error={result.error} loading={!result.data} />
      <Message content={message} />
      {link && <CopyLink url={link} />}
      {result.data && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{text(result.data.enterprise.name)}</h2>
            <p>
              {result.data.departments.map((d) => text(d.name)).join(" · ") ||
                "尚未添加部门"}
            </p>
          </div>
          <Table
            rows={result.data.members}
            columns={[
              {
                label: "成员",
                cell: (r) => (
                  <span>
                    {text(r.name)}
                    <small>{text(r.email)}</small>
                  </span>
                ),
              },
              {
                label: "身份",
                cell: (r) =>
                  ({ owner: "所有者", admin: "管理员", member: "成员" })[
                    text(r.role)
                  ],
              },
              {
                label: "部门",
                cell: (r) =>
                  text(
                    result.data!.departments.find(
                      (d) => d.id === r.department_id,
                    )?.name,
                  ) || "—",
              },
              {
                label: "操作",
                cell: (r) =>
                  r.role === "owner" ? (
                    "—"
                  ) : (
                    <div className="actions">
                      <button onClick={() => setEdit(r)}>调整</button>
                      <button onClick={() => remove(text(r.user_id))}>
                        移除
                      </button>
                    </div>
                  ),
              },
            ]}
          />
        </section>
      )}
      <StorageQuota
        scope="organization"
        ownerId={id}
        editable={user.role === "admin"}
      />
      {modal === "department" && (
        <Modal title="添加部门" close={() => setModal("")}>
          <ActionForm
            submit={async (f) => {
              await api("/api/v1/enterprises/" + id + "/departments", {
                name: value(f, "name"),
              });
              refresh();
            }}
          >
            <Field label="部门名称">
              <input name="name" required />
            </Field>
          </ActionForm>
        </Modal>
      )}
      {(modal === "invite" || edit) && (
        <Modal title={edit ? "调整成员" : "邀请成员"} close={refresh}>
          <ActionForm
            submit={async (f) => {
              const body = {
                email: value(f, "email"),
                role: value(f, "role"),
                departmentId: value(f, "department") || null,
              };
              if (edit)
                await api(
                  "/api/v1/enterprises/" + id + "/members/" + edit.user_id,
                  body,
                  "PATCH",
                );
              else {
                const response = await api<{ url: string }>(
                  "/api/v1/enterprises/" + id + "/invitations",
                  body,
                );
                setLink(response.url);
              }
              refresh();
            }}
          >
            {!edit && (
              <Field label="对方邮箱">
                <input type="email" name="email" required />
              </Field>
            )}
            <Field label="身份">
              <select name="role" defaultValue={text(edit?.role) || "member"}>
                <option value="member">成员</option>
                <option value="admin">管理员</option>
              </select>
            </Field>
            <Field label="部门">
              <select
                name="department"
                defaultValue={text(edit?.department_id)}
              >
                <option value="">未分配</option>
                {result.data?.departments.map((d) => (
                  <option key={text(d.id)} value={text(d.id)}>
                    {text(d.name)}
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </Modal>
      )}
    </>
  );
}
export function Projects() {
  const enterprises = useData<{ items: Row[] }>("/api/v1/enterprises"),
    [filter, setFilter] = useState("");
  const result = useData<{ items: Row[] }>(
    "/api/v1/projects" + (filter ? "?enterpriseId=" + filter : ""),
  );
  const [create, setCreate] = useState(false);
  return (
    <>
      <div className="toolbar">
        <select
          aria-label="筛选组织"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">全部组织与个人</option>
          {enterprises.data?.items.map((r) => (
            <option key={text(r.id)} value={text(r.id)}>
              {text(r.name)}
            </option>
          ))}
        </select>
        <Add onClick={() => setCreate(true)}>添加项目</Add>
      </div>
      <section className="panel">
        <Status error={result.error} loading={!result.data} />
        {result.data && (
          <Table
            rows={result.data.items}
            columns={[
              { label: "项目", cell: (r) => text(r.title) },
              {
                label: "所属组织",
                cell: (r) =>
                  text(
                    r.enterprise_name ??
                      enterprises.data?.items.find(
                        (e) => e.id === r.enterprise_id,
                      )?.name,
                  ) || "个人",
              },
              { label: "创建时间", cell: (r) => date(r.created_at) },
            ]}
          />
        )}
      </section>
      {create && (
        <Modal title="添加项目" close={() => setCreate(false)}>
          <ActionForm
            submit={async (f) => {
              await api("/api/v1/projects", {
                title: value(f, "title"),
                enterpriseId: filter || value(f, "enterprise"),
              });
              setCreate(false);
              result.reload();
            }}
          >
            <Field label="项目名称">
              <input name="title" required />
            </Field>
            <Field label="所属组织">
              {filter ? <strong>{text(enterprises.data?.items.find(item=>item.id===filter)?.name)}</strong> : <select name="enterprise" required defaultValue="">
                <option value="" disabled>选择组织</option>
                {enterprises.data?.items.map((r) => (
                  <option key={text(r.id)} value={text(r.id)}>
                    {text(r.name)}
                  </option>
                ))}
              </select>}
            </Field>
          </ActionForm>
        </Modal>
      )}
    </>
  );
}
export function Resources({ user }: { user: User }) {
  const [kind, setKind] = useState("skill"),
    [q, setQ] = useState(""),
    [create, setCreate] = useState(false),
    [message, setMessage] = useState("");
  const result = useData<{ items: Row[] }>(
    "/api/v1/resources?kind=" + kind + "&q=" + encodeURIComponent(q),
  );
  const enterprises = useData<{ items: Row[] }>("/api/v1/enterprises");
  return (
    <>
      <div className="toolbar">
        <div className="actions">
          <select
            aria-label="资源类型"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="skill">Skills</option>
            <option value="plugin">插件</option>
            <option value="attachment">文件</option>
          </select>
          <input
            aria-label="搜索资源"
            type="search"
            placeholder="搜索资源"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Add onClick={() => setCreate(true)}>添加资源</Add>
      </div>
      <Message content={message} />
      <section className="panel">
        <Status error={result.error} loading={!result.data} />
        {result.data && (
          <Table
            rows={result.data.items}
            columns={[
              {
                label: "资源",
                cell: (r) => (
                  <span>
                    {text(r.title)}
                    <small>{text(r.description)}</small>
                  </span>
                ),
              },
              { label: "版本", cell: (r) => text(r.version) },
              {
                label: "范围",
                cell: (r) =>
                  ({ public: "公开", private: "个人", enterprise: "组织" })[
                    text(r.visibility)
                  ],
              },
              {
                label: "大小",
                cell: (r) => (Number(r.bytes) / 1024).toFixed(1) + " KB",
              },
              {
                label: "",
                cell: (r) => (
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch(
                          "/api/v1/resources/" + r.id + "/download",
                        );
                        if (!response.ok) throw new Error("下载失败");
                        if (
                          response.headers
                            .get("content-type")
                            ?.includes("application/json")
                        ) {
                          const data = await response.json();
                          location.href = data.url;
                        } else {
                          const url = URL.createObjectURL(
                              await response.blob(),
                            ),
                            a = document.createElement("a");
                          a.href = url;
                          a.download = text(r.title);
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        }
                      } catch (e) {
                        setMessage(e instanceof Error ? e.message : "下载失败");
                      }
                    }}
                  >
                    <Download size={14} />
                    下载
                  </button>
                ),
              },
            ]}
          />
        )}
      </section>
      {create && (
        <Modal title="添加资源" close={() => setCreate(false)}>
          <ActionForm
            label="上传"
            submit={async (f) => {
              const file = f.get("file");
              if (!(file instanceof File) || !file.size)
                throw new Error("请选择文件");
              const enterpriseId = value(f, "enterprise") || null,
                data = new FormData();
              data.set("file", file);
              data.set(
                "metadata",
                JSON.stringify({
                  title: value(f, "title"),
                  description: value(f, "description"),
                  kind,
                  version: value(f, "version"),
                  enterpriseId,
                  visibility: value(f, "visibility"),
                  mime: file.type || "application/octet-stream",
                }),
              );
              await api("/api/v1/resources", data);
              setCreate(false);
              result.reload();
            }}
          >
            <Field label="名称">
              <input name="title" required />
            </Field>
            <Field label="说明">
              <input name="description" />
            </Field>
            <Field label="版本">
              <input name="version" defaultValue="1.0.0" required />
            </Field>
            <Field label="所属组织">
              <select name="enterprise">
                <option value="">个人</option>
                {enterprises.data?.items.map((r) => (
                  <option key={text(r.id)} value={text(r.id)}>
                    {text(r.name)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="可见范围">
              <select name="visibility">
                <option value="private">仅自己</option>
                <option value="enterprise">组织成员</option>
                {user.role === "admin" && <option value="public">公开</option>}
              </select>
            </Field>
            <Field label="文件（最大 24 MB）">
              <input type="file" name="file" required />
            </Field>
          </ActionForm>
        </Modal>
      )}
    </>
  );
}
export function Plans({ user }: { user: User }) {
  const admin = user.role === "admin",
    result = useData<{ items: Row[] }>(
      admin ? "/api/v1/admin/plans" : "/api/v1/plans",
    );
  const [edit, setEdit] = useState<Row>(),
    [message, setMessage] = useState("");
  const purchase = async (plan: Row, provider: string) => {
    try {
      const response = await api<{ url?: string; paid?: boolean }>(
        "/api/v1/orders",
        { planId: plan.id, provider, requestId: crypto.randomUUID() },
      );
      if (response.url) location.assign(response.url);
      else setMessage(response.paid ? "兑换成功" : "订单已创建");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "购买失败");
    }
  };
  return (
    <>
      <div className="toolbar">
        <span>充值积分或开通会员权益</span>
        {admin && <Add onClick={() => setEdit({})}>添加套餐</Add>}
      </div>
      <Message content={message} />
      <Status error={result.error} loading={!result.data} />
      <div className="plan-grid">
        {result.data?.items.map((r) => (
          <section className="panel plan" key={text(r.id)}>
            <span className="badge">
              {r.kind === "membership" ? "会员" : "积分"}
            </span>
            <h2>{text(r.name)}</h2>
            <p>{text(r.description)}</p>
            <div className="price">
              {(Number(r.amount) / 100).toFixed(2)}{" "}
              <small>{text(r.currency)}</small>
            </div>
            <p>
              {count(r.points)} 积分
              {Number(r.days) > 0 && " · " + r.days + " 天"}
            </p>
            <div className="actions">
              {admin ? (
                <button onClick={() => setEdit(r)}>编辑套餐</button>
              ) : (
                <>
                  <button
                    className="primary"
                    onClick={() => purchase(r, "stripe")}
                  >
                    购买
                  </button>
                  {r.points_cost && (
                    <button onClick={() => purchase(r, "points")}>
                      {count(r.points_cost)} 积分兑换
                    </button>
                  )}
                </>
              )}
            </div>
            {admin && !r.enabled && <small>已下架</small>}
          </section>
        ))}
      </div>
      {edit && (
        <Modal
          title={edit.id ? "编辑套餐" : "添加套餐"}
          close={() => setEdit(undefined)}
        >
          <ActionForm
            submit={async (f) => {
              await api(
                "/api/v1/admin/plans" + (edit.id ? "/" + edit.id : ""),
                {
                  name: value(f, "name"),
                  description: value(f, "description"),
                  kind: value(f, "kind"),
                  amount: Math.round(Number(value(f, "amount")) * 100),
                  currency: value(f, "currency"),
                  points: Number(value(f, "points")),
                  days: Number(value(f, "days")),
                  pointsCost: value(f, "pointsCost")
                    ? Number(value(f, "pointsCost"))
                    : null,
                  enabled: f.get("enabled") === "on",
                  appleProductId: value(f, "apple") || null,
                },
                edit.id ? "PUT" : "POST",
              );
              setEdit(undefined);
              result.reload();
            }}
          >
            <Field label="名称">
              <input name="name" required defaultValue={text(edit.name)} />
            </Field>
            <Field label="说明">
              <input name="description" defaultValue={text(edit.description)} />
            </Field>
            <div className="form-grid">
              <Field label="类型">
                <select name="kind" defaultValue={text(edit.kind) || "points"}>
                  <option value="points">积分充值</option>
                  <option value="membership">会员</option>
                </select>
              </Field>
              <Field label="币种">
                <input
                  name="currency"
                  required
                  defaultValue={text(edit.currency) || "CNY"}
                  pattern="[A-Z]{3}"
                />
              </Field>
              <Field label="金额">
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={Number(edit.amount ?? 0) / 100}
                />
              </Field>
              <Field label="到账积分">
                <input
                  name="points"
                  type="number"
                  min="0"
                  required
                  defaultValue={Number(edit.points ?? 0)}
                />
              </Field>
              <Field label="会员天数">
                <input
                  name="days"
                  type="number"
                  min="0"
                  required
                  defaultValue={Number(edit.days ?? 0)}
                />
              </Field>
              <Field label="兑换所需积分（可选）">
                <input
                  name="pointsCost"
                  type="number"
                  min="1"
                  defaultValue={text(edit.points_cost)}
                />
              </Field>
            </div>
            <Field label="App Store 商品 ID（可选）">
              <input name="apple" defaultValue={text(edit.apple_product_id)} />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={edit.enabled !== 0}
              />
              上架
            </label>
          </ActionForm>
        </Modal>
      )}
    </>
  );
}
export function UsersPage() {
  const [q, setQ] = useState(""),
    list = useData<{ items: Row[] }>(
      "/api/v1/admin/users?q=" + encodeURIComponent(q),
    ),
    [user, select] = useState<Row>(),
    [message, setMessage] = useState("");
  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          aria-label="搜索用户"
          placeholder="姓名或邮箱"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Message content={message} />
      <section className="panel">
        <Status error={list.error} loading={!list.data} />
        {list.data && (
          <Table
            rows={list.data.items}
            columns={[
              {
                label: "用户",
                cell: (r) => (
                  <span>
                    {text(r.name)}
                    <small>{text(r.email)}</small>
                  </span>
                ),
              },
              {
                label: "身份",
                cell: (r) => (r.role === "admin" ? "管理员" : "用户"),
              },
              { label: "状态", cell: (r) => (r.banned ? "已停用" : "正常") },
              { label: "注册时间", cell: (r) => date(r.createdAt) },
              {
                label: "",
                cell: (r) => <button onClick={() => select(r)}>管理</button>,
              },
            ]}
          />
        )}
      </section>
      {user && (
        <Modal title={text(user.name)} close={() => select(undefined)}>
          <ActionForm
            label="调整积分"
            submit={async (f) => {
              await api("/api/v1/admin/points/" + user.id, {
                amount: Number(value(f, "amount")),
                reason: value(f, "reason"),
                requestId: crypto.randomUUID(),
              });
              setMessage("积分已调整");
              select(undefined);
              list.reload();
            }}
          >
            <p>{text(user.email)}</p>
            <Field label="调整数量（扣减填负数）">
              <input name="amount" type="number" required />
            </Field>
            <Field label="原因">
              <input name="reason" required />
            </Field>
          </ActionForm>
          <hr />
          <ActionForm
            label="保存账号状态"
            submit={async (f) => {
              await api(
                "/api/v1/admin/users/" + user.id,
                { role: value(f, "role"), banned: f.get("banned") === "on" },
                "PATCH",
              );
              select(undefined);
              list.reload();
            }}
          >
            <Field label="权限">
              <select name="role" defaultValue={text(user.role)}>
                <option value="user">用户</option>
                <option value="admin">管理员</option>
              </select>
            </Field>
            <label className="check">
              <input
                type="checkbox"
                name="banned"
                defaultChecked={Boolean(user.banned)}
              />
              停用此账号
            </label>
          </ActionForm>
          <StorageQuota scope="personal" ownerId={text(user.id)} editable />
        </Modal>
      )}
    </>
  );
}
const settingsLabels: Record<string, Record<string, string>> = {
  stripe: { secretKey: "Secret key", webhookSecret: "Webhook secret" },
  oss: {
    region: "地域（如 oss-cn-hangzhou）",
    bucket: "Bucket",
    accessKeyId: "Access key ID",
    accessKeySecret: "Access key secret",
  },
  app_store: {
    bundleId: "Bundle ID",
    issuerId: "Issuer ID",
    keyId: "Key ID",
    privateKey: "私钥 PEM",
    rootPaths: "Apple 根证书路径（逗号分隔）",
    environment: "环境（sandbox / production）",
    appAppleId: "App Apple ID",
  },
};
export function SettingsPage() {
  const result = useData<Record<string, Record<string, string>>>(
      "/api/v1/admin/settings",
    ),
    [message, setMessage] = useState("");
  return (
    <>
      <Message content={message} />
      <Status error={result.error} loading={!result.data} />
      <div className="settings-grid">
        {result.data &&
          Object.entries(settingsLabels).map(([group, fields]) => (
            <section className="panel settings" key={group}>
              <h2>
                {
                  {
                    stripe: "Stripe 支付",
                    oss: "阿里云 OSS",
                    app_store: "App Store 支付",
                  }[group]
                }
              </h2>
              <ActionForm
                submit={async (f) => {
                  await api(
                    "/api/v1/admin/settings/" + group,
                    Object.fromEntries(f.entries()),
                    "PUT",
                  );
                  setMessage("配置已保存");
                  result.reload();
                }}
              >
                {Object.entries(fields).map(([field, label]) => (
                  <Field key={field} label={label}>
                    {field === "privateKey" ? (
                      <textarea
                        name={field}
                        rows={3}
                        defaultValue={result.data![group][field]}
                      />
                    ) : (
                      <input
                        name={field}
                        autoComplete="off"
                        type={
                          /secret|key/i.test(field) && field !== "keyId"
                            ? "password"
                            : "text"
                        }
                        defaultValue={result.data![group][field]}
                      />
                    )}
                  </Field>
                ))}
              </ActionForm>
            </section>
          ))}
      </div>
    </>
  );
}
export function SharePage({ id }: { id: string }) {
  const result = useData<{
    title: string;
    transcript: { role: string; content: string }[];
  }>("/api/v1/shares/" + id);
  return (
    <>
      <Status error={result.error} loading={!result.data} />
      {result.data && (
        <section className="panel shared">
          <h2>{result.data.title}</h2>
          <p>这是历史分享。新的会话分享请使用 iPolloWork 中的 DSH 原生共享。</p>
          {result.data.transcript.map((m, i) => (
            <article key={i}>
              <small>{m.role === "user" ? "用户" : "助手"}</small>
              <p>{m.content}</p>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
