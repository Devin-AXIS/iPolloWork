import { useState } from "react";
import { Plus, ArrowLeft, Copy, Download, Search } from "lucide-react";
import { StorageQuota } from "./storage.js";
import { OrganizationActivity, OrganizationDepartments, OrganizationMcp, OrganizationPublications, OrganizationSettings } from "./organization-admin.js";
import { planBudget } from "../src/pricing.js";
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
function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-link">
      <input aria-label={label} readOnly value={value} />
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        <Copy size={14} />
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}
function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv"}));
  const download = document.createElement("a");
  download.href = url;
  download.download = filename;
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function CodeDays({ initial }: { initial?: number }) {
  return <Field label="有效天数"><input type="number" name="days" min={1} max={30} defaultValue={initial} placeholder="永久有效"/></Field>;
}
function codeDays(form: FormData) {
  const days = value(form, "days");
  return days === "" ? null : Number(days);
}
function MembershipNotices() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>成员通知</button>
    {open && <Modal title="成员通知" close={() => setOpen(false)}><MembershipNoticeList/></Modal>}
  </>;
}
function MembershipNoticeList() {
  const notices = useData<{items:Row[]}>("/api/v1/me/organization-notices?include=status");
  return <>
    <Status error={notices.error} loading={!notices.data}/>
    {notices.data && <Table rows={notices.data.items} columns={[
      {label:"组织",cell:row=>text(row.name)},
      {label:"变更",cell:row=>{
        if (row.kind === "status") return "成员状态已变更为 " + (row.value === "suspended" ? "已停用" : "正常");
        if (row.kind === "role") return "身份已变更为 " + (row.value === "member" ? "普通成员" : "管理员");
        if (row.kind === "department") return "部门已变更为 " + (text(row.value) || "未分配");
        return "你已被移出此组织";
      }},
      {label:"时间",cell:row=>date(row.created_at)},
    ]}/>}
  </>;
}
export function Enterprises({ user }: { user: User }) {
  const list = useData<{ items: Row[] }>("/api/v1/enterprises"),
    [create, setCreate] = useState(false),
    [join, setJoin] = useState(false),
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
        <div className="actions">
          <MembershipNotices/>
          <button onClick={() => setJoin(true)}>通过邀请码加入</button>
          <Add onClick={() => setCreate(true)}>创建组织</Add>
        </div>
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
                    {r.logo && <img className="organization-avatar" src={text(r.logo)} alt=""/>}
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
      {join && <Modal title="通过邀请码加入" close={() => setJoin(false)}>
        <ActionForm label="加入组织" submit={async form => {
          const service = new URL(value(form,"service"));
          if (service.origin !== location.origin || service.pathname !== "/" || service.username || service.password || service.search || service.hash)
            throw new Error("请输入当前 iPolloWork 账号所属的组织服务地址");
          const code = value(form,"code").trim();
          if (!/^[A-Za-z0-9_-]{40,100}$/.test(code)) throw new Error("邀请码无效");
          const joined = await api<{enterpriseId:string}>("/api/v1/invitations/" + code + "/accept", {});
          setJoin(false);
          select(joined.enterpriseId);
        }}>
          <Field label="组织服务地址"><input type="url" name="service" required defaultValue={location.origin}/></Field>
          <Field label="邀请码"><input name="code" required maxLength={100}/></Field>
        </ActionForm>
      </Modal>}
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
  const path = "/api/v1/enterprises/" + id;
  const result = useData<{
    enterprise: Row;
    canManage: boolean;
    members: Row[];
    departments: Row[];
    invitations: Row[];
  }>(path);
  const [modal, setModal] = useState(""),
    [issued, setIssued] = useState<{code:string;serviceAddress:string;expiresAt:number|null}>(),
    [expiry, setExpiry] = useState<Row>(),
    [tab, setTab] = useState("members"),
    [edit, setEdit] = useState<Row>(),
    [message, setMessage] = useState("");
  const refresh = () => {
    setModal("");
    setIssued(undefined);
    setExpiry(undefined);
    setEdit(undefined);
    result.reload();
  };
  const tabs = [
    ["members","成员"], ["departments","部门"], ["templates","模板"], ["plugins","插件"], ["skills","Skill"], ["mcp","MCP"],
    ...(result.data?.canManage ? [["activity","操作记录"]] : []), ["settings","设置"],
  ] as const;
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
        <MembershipNotices/>
      </div>
      <Status error={result.error} loading={!result.data} />
      <Message content={message} />
      {result.data && <section className="panel">
        <div className="panel-heading"><h2>{text(result.data.enterprise.name)}</h2></div>
        <nav className="actions" aria-label="组织管理">
          {tabs.map(([key,label]) => <button key={key} type="button" aria-pressed={tab === key}
            className={tab === key ? "primary" : undefined} onClick={() => setTab(key!)}>{label}</button>)}
        </nav>
      </section>}
      {result.data && tab === "departments" && <OrganizationDepartments path={path} departments={result.data.departments}
        canManage={result.data.canManage} reload={result.reload}/>}
      {result.data && (tab === "templates" || tab === "plugins" || tab === "skills") && <OrganizationPublications key={tab} path={path}
        kind={tab === "templates" ? "template" : tab === "skills" ? "skill" : "plugin"}
        members={result.data.members} departments={result.data.departments}/>}
      {result.data && tab === "mcp" && <OrganizationMcp path={path} members={result.data.members} departments={result.data.departments}/>}
      {result.data?.canManage && tab === "activity" && <OrganizationActivity path={path}/>}
      {result.data && tab === "settings" && <OrganizationSettings path={path} enterprise={result.data.enterprise} canManage={result.data.canManage} reload={result.reload}/>}
      {result.data?.canManage && tab === "settings" && <section className="panel organization-settings">
        <div className="panel-heading">
          <h2>组织服务地址</h2>
        </div>
        <CopyValue value={location.origin} label="组织服务地址"/>
      </section>}
      {result.data && tab === "members" && (
        <section className="panel">
          <div className="panel-heading organization-member-heading">
            <h2>成员</h2>
            {result.data.canManage && <div className="actions">
              <button onClick={() => setModal("batch")}>从 CSV 批量生成</button>
              <Add onClick={() => setModal("code")}>添加员工</Add>
            </div>}
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
              { label: "工号", cell: (r) => text(r.employee_number) || "—" },
              {
                label: "身份",
                cell: (r) =>
                  ({ owner: "管理员", admin: "管理员", member: "普通成员" })[
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
                label: "成员状态",
                cell: r => r.status === "suspended" ? "已停用" : "正常",
              },
              ...(result.data.canManage ? [{
                label: "操作",
                cell: (r: Row) =>
                  r.role === "owner" ? (
                    "—"
                  ) : (
                    <div className="actions">
                      <button onClick={() => setEdit(r)}>编辑</button>
                      <button onClick={() => remove(text(r.user_id))}>
                        移除
                      </button>
                    </div>
                  ),
              }] : []),
            ]}
          />
          {result.data.canManage && result.data.invitations.length > 0 && <>
            <div className="panel-heading"><h2>待使用的邀请码</h2></div>
            <Table rows={result.data.invitations} columns={[
              {label:"员工",cell:r=>[r.invitee_name,r.email].filter(Boolean).join(" · ") || "邀请码"},
              {label:"工号",cell:r=>text(r.employee_number) || "—"},
              {label:"有效期",cell:r=>r.expires_at === null ? "永久有效" : date(r.expires_at)},
              {label:"状态",cell:r=>r.expires_at !== null && Number(r.expires_at) <= Date.now() ? "已过期" : "待使用"},
              {label:"操作",cell:r=>!r.email && !r.project_id && <button onClick={()=>setExpiry(r)}>修改有效期</button>},
            ]}/>
          </>}
        </section>
      )}
      {tab === "settings" && <StorageQuota
        scope="organization"
        ownerId={id}
        editable={user.role === "admin"}
      />}
      {modal === "code" && <Modal title="添加员工" close={refresh}>
        {issued ? <>
          <Field label="组织服务地址"><CopyValue value={issued.serviceAddress} label="组织服务地址"/></Field>
          <Field label="邀请码"><CopyValue value={issued.code} label="邀请码"/></Field>
          <p>{issued.expiresAt === null ? "永久有效" : "有效期至 " + date(issued.expiresAt)}</p>
        </> : <ActionForm label="生成邀请码" submit={async form => {
          setIssued(await api(path + "/join-codes", {
            days: codeDays(form),
            displayName: value(form, "displayName").trim() || undefined,
            departmentId: value(form, "department") || undefined,
          }));
        }}>
          <Field label="员工姓名"><input name="displayName" maxLength={120}/></Field>
          <CodeDays/>
          <p>留空则永久有效。邀请码仅可使用一次。</p>
          <Field label="部门"><select name="department">
            <option value="">未分配</option>
            {result.data?.departments.map(d => <option key={text(d.id)} value={text(d.id)}>{text(d.name)}</option>)}
          </select></Field>
        </ActionForm>}
      </Modal>}
      {expiry && <Modal title="修改邀请码有效期" close={refresh}>
        <ActionForm submit={async form => {
          await api(path + "/join-codes/" + expiry.id, {days:codeDays(form)}, "PATCH");
          refresh();
        }}>
          <CodeDays initial={expiry.expires_at === null ? undefined : Math.max(1, Math.min(30, Math.ceil((Number(expiry.expires_at) - Date.now()) / 86_400_000)))}/>
          <p>留空则永久有效。</p>
        </ActionForm>
      </Modal>}
      {modal === "batch" && <Modal title="从 CSV 批量生成" close={refresh}>
        <ActionForm label="导出邀请码" submit={async form => {
          const roster = form.get("roster");
          if (!(roster instanceof File) || !roster.size) throw new Error("请选择包含成员记录的 CSV 文件");
          if (roster.size > 256 * 1024) throw new Error("请将 CSV 拆分为不超过 256 KB 的文件");
          let rosterText: string;
          try {
            rosterText = new TextDecoder("utf-8", { fatal: true }).decode(await roster.arrayBuffer());
          } catch {
            throw new Error("无法以 UTF-8 读取文件，请另存为 CSV UTF-8 后重试");
          }
          const response = await api<{items:{name?:string;employeeNumber?:string;code:string;serviceAddress:string}[]}>(path + "/join-codes/batch",
            {
              csv: rosterText, days: codeDays(form),
              ...(form.has("createMissingDepartments") ? { createMissingDepartments: true } : {}),
            },
          );
          const csv = ["名称,工号,服务地址,邀请码",...response.items.map(item=>[item.name,item.employeeNumber,item.serviceAddress,item.code]
            .map(field=>'"' + (/^[=+\-@\t\r]/.test(field ?? "") ? "'" : "") + (field ?? "").replaceAll('"','""') + '"').join(","))].join("\r\n");
          downloadCsv("organization-join-codes.csv", csv);
          setMessage(`已生成并导出 ${response.items.length} 个邀请码`);
          refresh();
        }}>
          <button type="button" onClick={()=>downloadCsv("employee-roster-template.csv","名称,工号,部门名称\r\n")}>下载 CSV 模板</button>
          <Field label="成员名单 CSV"><input type="file" name="roster" accept=".csv,text/csv" required/></Field>
          <p>请使用 UTF-8 CSV。名称和工号必填，部门名称可选。</p>
          <label className="check"><input name="createMissingDepartments" type="checkbox"/>自动创建缺少的部门</label>
          <CodeDays/>
        </ActionForm>
      </Modal>}
      {edit && (
        <Modal title="编辑成员" close={refresh}>
          <ActionForm
            submit={async (f) => {
              const body = {
                role: value(f, "role"),
                ...(value(f,"status") && value(f,"status") !== (edit.status ?? "active") ? {status:value(f,"status")} : {}),
                departmentId: value(f, "department") || null,
                employeeNumber:value(f,"employeeNumber").trim() || null,
                displayName:value(f,"displayName").trim() || null,
              };
              await api(path + "/members/" + edit.user_id, body, "PATCH");
              refresh();
            }}
          >
            <Field label="工号"><input name="employeeNumber" maxLength={64} defaultValue={text(edit.employee_number)}/></Field>
            <Field label="名称"><input name="displayName" maxLength={120} defaultValue={text(edit.name)}/></Field>
            <Field label="身份">
              <select name="role" defaultValue={text(edit?.role) || "member"}>
                <option value="member">普通成员</option>
                <option value="admin">管理员</option>
              </select>
            </Field>
            <Field label="成员状态">
              <select name="status" defaultValue={text(edit.status) || "active"} disabled={edit.user_id === user.id}>
                <option value="active">正常</option>
                <option value="suspended">已停用</option>
              </select>
            </Field>
            <p>停用后，该成员将失去此组织的访问权限，恢复正常后可重新访问。</p>
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
                enterpriseId: filter || value(f, "enterprise") || null,
              });
              setCreate(false);
              result.reload();
            }}
          >
            <Field label="项目名称">
              <input name="title" required />
            </Field>
            <Field label="所属组织">
              {filter ? <strong>{text(enterprises.data?.items.find(item=>item.id===filter)?.name)}</strong> : <select name="enterprise" defaultValue="">
                <option value="">个人项目</option>
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
  const [planDraft, setPlanDraft] = useState({ amount: 99, points: 40000, kind: "membership" });
  const openPlan = (row: Row) => { setPlanDraft({ amount: Number(row.amount ?? 9900) / 100, points: Number(row.points ?? 40000), kind: String(row.kind ?? "membership") }); setEdit(row); };
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
        {admin && <Add onClick={() => openPlan({})}>添加套餐</Add>}
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
            {r.kind === "membership" && <p>每日 {r.daily_points ? count(r.daily_points) : "不限"} · 每周 {r.weekly_points ? count(r.weekly_points) : "不限"} 积分</p>}
            <div className="actions">
              {admin ? (
                <button onClick={() => openPlan(r)}>编辑套餐</button>
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
                  dailyPoints: value(f, "dailyPoints") ? Number(value(f, "dailyPoints")) : null,
                  weeklyPoints: value(f, "weeklyPoints") ? Number(value(f, "weeklyPoints")) : null,
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
                <select name="kind" value={planDraft.kind} onChange={event => setPlanDraft({ ...planDraft, kind: event.target.value })}>
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
                  value={planDraft.amount}
                  onChange={event => setPlanDraft({ ...planDraft, amount: Number(event.target.value) })}
                />
              </Field>
              <Field label="到账积分">
                <input
                  name="points"
                  type="number"
                  min="0"
                  required
                  value={planDraft.points}
                  onChange={event => setPlanDraft({ ...planDraft, points: Number(event.target.value) })}
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
              {planDraft.kind === "membership" && <><Field label="每日积分上限（留空不限）"><input name="dailyPoints" type="number" min="1" step="1" defaultValue={text(edit.daily_points)} /></Field><Field label="每周积分上限（留空不限）"><input name="weeklyPoints" type="number" min="1" step="1" defaultValue={text(edit.weekly_points)} /></Field></>}
            </div>
            <PlanBudgetPreview {...planDraft} />
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
function PlanBudgetPreview({ amount, points, kind }: { amount: number; points: number; kind: string }) {
  const policy = useData<{ paymentFeeBps: number; minimumMarginBps: number; membershipOperatingReserveFen: number }>("/api/v1/admin/billing-policy");
  if (!policy.data) return <Status loading={!policy.error} error={policy.error} />;
  const budget = planBudget(Math.round(amount * 100), points, kind, policy.data);
  return <div className="budget-preview" data-ok={budget.allowed}>
    <div>模型成本上限 {(budget.modelCostFen / 100).toFixed(2)} 元 · 支付手续费预留 {(budget.feeFen / 100).toFixed(2)} 元</div>
    <div>运营预留 {(budget.reserveFen / 100).toFixed(2)} 元 · 剩余 {(budget.remainingFen / 100).toFixed(2)} 元</div>
    <div>当前策略最多发放 {budget.maximumPoints.toLocaleString("zh-CN")} 积分{!budget.allowed && "，请减少到账积分"}</div>
  </div>;
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
  cloud: { enabled: '启用云端执行', gatewayOrigin: '云端网关地址（HTTPS 来源）', gatewayKey: '网关密钥（至少 32 字符，留空保留）', ttlSeconds: '执行租约秒数（300–3600）', grantTtlSeconds: '授权秒数（3600–604800）', leaseGraceSeconds: '租约宽限秒数（60–600）' },
  stage: { enabled: "启用（true / false）", origin: "Stage HTTPS 服务地址", rates: "每百万 Token 积分及成本（JSON）" },
  stripe: { secretKey: "Secret key", webhookSecret: "Webhook secret" },
  alipay: { appId: "应用 App ID", sellerId: "收款商户 PID", privateKey: "应用私钥 PEM", publicKey: "支付宝公钥 PEM", sandbox: "沙箱（1 开启，0 关闭）" },
  wechat: { appId: "应用 App ID", merchantId: "商户号", merchantSerial: "商户证书序列号", privateKey: "商户私钥 PEM", apiV3Key: "API v3 密钥", platformKeyId: "微信支付公钥 ID", platformPublicKey: "微信支付公钥 PEM" },
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
                    cloud: '云端执行网关',
                    stage: "Stage 官方通道与计费",
                    stripe: "Stripe 支付",
                    alipay: "支付宝",
                    wechat: "微信支付",
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
                    {field === 'enabled' ? (
                      <select name={field} defaultValue={result.data?.[group]?.[field] || 'false'}><option value="false">关闭</option><option value="true">启用</option></select>
                    ) : /privateKey|publicKey|^rates$/i.test(field) ? (
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
