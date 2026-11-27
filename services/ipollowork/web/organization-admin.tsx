import { useEffect, useState } from "react";
import { audienceDraft, audienceInput, audienceReady, audienceScopes, type Audience, type AudienceScope } from "../src/audience-scope.js";
import { projectAudience, projectScopeAccess, type ProjectAccess } from "../src/project-audience.js";
import { api, date, deletePermanently, operation, text, type Row } from "./api.js";
import { ActionForm, Field, Modal, Status, Table, useData, value } from "./components.js";

export function OrganizationSettings({ path, enterprise, canManage, reload }: {
  path: string; enterprise: Row; canManage: boolean; reload(): void;
}) {
  const [logo, setLogo] = useState<string | null>();
  const [logoError, setLogoError] = useState("");
  const [notice, setNotice] = useState("");
  const shownLogo = logo === undefined ? text(enterprise.logo) : logo;
  return <section className="panel organization-settings">
    <div className="panel-heading"><h2>组织设置</h2></div>
    {!canManage ? <>
      {shownLogo && <img src={shownLogo} className="organization-logo" alt="组织标志"/>}
      <p>{text(enterprise.description) || text(enterprise.name)}</p>
    </> : <ActionForm submit={async form => {
      if (logoError) throw new Error(logoError);
      await api(path, { name:value(form,"name"), description:value(form,"description"), ...(logo === undefined ? {} : {logo}) }, "PATCH");
      setNotice("组织设置已保存");
      reload();
    }}>
      <div className="organization-profile-fields">
        <div>
          <Field label="组织名称"><input required name="name" maxLength={120} defaultValue={text(enterprise.name)}/></Field>
          <Field label="组织简介"><textarea name="description" maxLength={1000} rows={3} defaultValue={text(enterprise.description)}/></Field>
        </div>
        <div>
          <Field label="组织标志"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
            const input = event.currentTarget, file = input.files?.[0];
            if (!file) return;
            if (file.size > 35_000 || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
              setLogoError("请选择 35 KB 以内的 PNG、JPEG 或 WebP 图片");
              input.value = "";
              return;
            }
            setLogoError("");
            const reader = new FileReader();
            reader.onload = () => {
              if (input.files?.[0] === file && typeof reader.result === "string") setLogo(reader.result);
            };
            reader.readAsDataURL(file);
          }}/></Field>
          {logoError && <p className="error" role="alert">{logoError}</p>}
          {shownLogo && <div className="actions">
            <img src={shownLogo} className="organization-logo" alt="组织标志"/>
            <button type="button" onClick={()=>{setLogo(null);setLogoError("");}}>移除标志</button>
          </div>}
        </div>
      </div>
    </ActionForm>}
    {notice && <div className="notice" role="status">{notice}</div>}
  </section>;
}

export function OrganizationDepartments({ path, departments, canManage, reload }: {
  path:string; departments:Row[]; canManage:boolean; reload():void;
}) {
  const [editing,setEditing] = useState<Row | "new">();
  const [removing,setRemoving] = useState<Row>();
  const row = editing === "new" ? undefined : editing;
  return <section className="panel">
    <div className="toolbar"><h2>部门</h2>{canManage && <button className="primary" onClick={() => setEditing("new")}>添加部门</button>}</div>
    <Table rows={departments} columns={[
      {label:"部门",cell:item=>text(item.name)},
      {label:"上级部门",cell:item=>text(departments.find(parent=>parent.id===item.parent_id)?.name) || "—"},
      ...(canManage ? [{label:"操作",cell:(item:Row)=><div className="actions">
        <button onClick={() => setEditing(item)}>编辑</button><button onClick={() => setRemoving(item)}>移除</button>
      </div>}] : []),
    ]}/>
    {editing && <Modal title={row ? "编辑部门" : "添加部门"} close={() => setEditing(undefined)}>
      <ActionForm submit={async form => {
        await api(path + "/departments" + (row ? "/" + row.id : ""),{
          name:value(form,"name"),parentId:value(form,"parentId") || null,
        },row ? "PATCH" : "POST");
        setEditing(undefined);
        reload();
      }}>
        <Field label="部门名称"><input name="name" maxLength={120} required defaultValue={text(row?.name)}/></Field>
        <Field label="上级部门"><select name="parentId" defaultValue={text(row?.parent_id)}>
          <option value="">设为顶级部门</option>
          {departments.filter(parent=>parent.id!==row?.id).map(parent=>
            <option key={text(parent.id)} value={text(parent.id)}>{text(parent.name)}</option>)}
        </select></Field>
      </ActionForm>
    </Modal>}
    {removing && <Modal title="移除部门" close={() => setRemoving(undefined)}>
      <p>移除「{text(removing.name)}」后，该部门的成员将变为未分配，下属部门将成为顶级部门。</p>
      <ActionForm label="移除部门" submit={async () => {
        await api(path + "/departments/" + removing.id,undefined,"DELETE");
        setRemoving(undefined);
        reload();
      }}/>
    </Modal>}
  </section>;
}

type Kind = "plugin" | "template" | "skill";
const scopeLabels: Record<AudienceScope, string> = {
  admins: "仅管理员", everyone: "全体员工", departments: "选定部门", employees: "选定员工", mixed: "部门和员工",
};

function readAudience(form: FormData): Audience {
  const scope = form.get("sharingScope") as AudienceScope;
  const selected = (name: string) => form.getAll(name).filter((item): item is string => typeof item === "string");
  const draft = { scope, audience: {
    all: scope === "everyone", departments: selected("department"), members: selected("member"),
    includeSubdepartments: form.has("includeSubdepartments"),
  }};
  if (!audienceReady(draft)) throw new Error("请先选择共享对象");
  return audienceInput(draft);
}

function OrganizationAudienceFields({ path, departments, initial, legacy = false, project = false }: {
  path: string; departments: Row[]; initial?: Audience | undefined; legacy?: boolean; project?: boolean;
}) {
  const draft = audienceDraft(initial);
  const [scope, setScope] = useState<AudienceScope | "legacy">(legacy ? "legacy" : draft.scope);
  const [selectedDepartments, setSelectedDepartments] = useState(() => draft.audience.departments);
  return <div className="organization-audience">
    <Field label="共享范围"><select name="sharingScope" value={scope} onChange={event => setScope(event.target.value as typeof scope)}>
      {legacy && <option value="legacy">原有范围</option>}
      {audienceScopes.map(option => <option key={option} value={option}>{scopeLabels[option]}</option>)}
      {draft.scope === "mixed" && <option value="mixed">{scopeLabels.mixed}</option>}
    </select></Field>
    {(scope === "departments" || scope === "mixed") && <fieldset>
      <legend>选定部门</legend>
      {departments.length === 0 && <p>暂无可选部门</p>}
      {departments.length > 0 && <details className="department-picker">
        <summary>{selectedDepartments.length ? `已选 ${selectedDepartments.length} 个部门` : "请选择部门"}</summary>
        <div className="department-picker-options" role="group" aria-label="选定部门">
          {departments.map(row => {
            const id = text(row.id);
            const checked = selectedDepartments.includes(id);
            return <label className="check" key={id}>
              <input type="checkbox" name="department" value={id} checked={checked}
                disabled={!checked && selectedDepartments.length >= 200} onChange={event => {
                  const include = event.target.checked;
                  setSelectedDepartments(current => include ? [...current, id] : current.filter(selected => selected !== id));
                }}/>
              {text(row.name)}
            </label>;
          })}
        </div>
      </details>}
      {!project && departments.length > 0 && <label className="check">
        <input type="checkbox" name="includeSubdepartments" defaultChecked={draft.audience.includeSubdepartments}/>包含下级部门
      </label>}
    </fieldset>}
    {(scope === "employees" || scope === "mixed") &&
      <OrganizationMemberOptions path={path} initial={draft.audience.members} name="member"/>}
    {project && (scope === "departments" || scope === "employees" || scope === "mixed") &&
      <Field label="权限"><select name="projectRole">
        <option value="">保留已有权限（新增对象可查看）</option>
        <option value="view">查看</option>
        <option value="participate">参与</option>
        <option value="maintain">维护</option>
      </select></Field>}
  </div>;
}

export function ProjectAudienceFields({ organizationId, access }: { organizationId: string; access?: ProjectAccess }) {
  const path = "/api/v1/enterprises/" + encodeURIComponent(organizationId);
  const detail = useData<{departments: Row[]}>(path);
  return <>
    <Status error={detail.error} loading={!detail.data}/>
    {detail.error && <button type="button" onClick={detail.reload}>重试</button>}
    {detail.data && <OrganizationAudienceFields path={path} departments={detail.data.departments}
      initial={access ? projectAudience(access).audience : undefined} project/>}
  </>;
}

export function readProjectAudience(form: FormData, previous?: ProjectAccess): ProjectAccess {
  if (!form.has("sharingScope")) throw new Error("请等待共享范围加载完成");
  const draft = audienceDraft(readAudience(form));
  const role = (["view", "participate", "maintain"] as const).find(option => option === value(form, "projectRole")) ?? "";
  if (previous && !role) {
    const prior = audienceInput(projectAudience(previous));
    const sameSubjects = (left: string[], right: string[]) => left.length === right.length && left.every(id => right.includes(id));
    if (prior.all === draft.audience.all && sameSubjects(prior.departments, draft.audience.departments) &&
      sameSubjects(prior.members, draft.audience.members)) return previous;
  }
  return projectScopeAccess(draft, role, previous?.grants);
}
type ResourceAccess = { id: string; title: string; audience: Audience };
export function OrganizationResourceGrants({ path, departments, kind }: {
  path: string; departments: Row[]; kind: "service" | "skill";
}) {
  const status = useData<{items?: ResourceAccess[]; skills?: ResourceAccess[]}>(
    path + (kind === "service" ? "/services" : "/assets"),
  );
  const [editing, setEditing] = useState<ResourceAccess>();
  const rows = kind === "service" ? status.data?.items : status.data?.skills;
  if (kind === "skill" && rows?.length === 0) return null;
  return <section className="panel">
    <h2>{kind === "service" ? "模型与工具" : "直接创建的 Skill"}</h2>
    <Status error={status.error} loading={!rows}/>
    {status.error && <button onClick={status.reload}>重试</button>}
    {rows?.length === 0 && <p className="empty">暂无模型与工具</p>}
    {rows?.map(row => <div className="toolbar" key={row.id}>
      <span>{row.title}</span>
      <button type="button" onClick={() => setEditing(row)}>{scopeLabels[audienceDraft(row.audience).scope]}</button>
    </div>)}
    {editing && <Modal title={editing.title + " · 共享范围"} close={() => setEditing(undefined)}>
      <ActionForm submit={async form => {
        await api(path + "/grants", { kind, assetId: editing.id, audience: readAudience(form) }, "PUT");
        setEditing(undefined);
        status.reload();
      }}><OrganizationAudienceFields path={path} departments={departments} initial={editing.audience}/></ActionForm>
    </Modal>}
  </section>;
}

type OrganizationWebsite = {
  id: string; label: string; url: string; departmentId: string | null; role: string | null;
  memberIds?: string[]; audience?: Audience; cookieNames?: string[];
};
export function OrganizationWebsites({ path, departments }: {path: string; departments: Row[]}) {
  const endpoint = path + "/websites/manage";
  const status = useData<{revision: number; items: OrganizationWebsite[]}>(endpoint);
  const [editing, setEditing] = useState<OrganizationWebsite | "new">();
  const item = editing === "new" ? undefined : editing;
  const legacy = Boolean(item && !item.audience && (item.departmentId || item.role || item.memberIds));
  const initial = item?.audience ?? (item && !legacy ? {all:true, departments:[], members:[]} : undefined);
  return <section className="panel">
    <div className="toolbar"><h2>组织网页入口</h2>
      {status.data && status.data.items.length < 50 && <button onClick={() => setEditing("new")}>添加网页入口</button>}
    </div>
    <Status error={status.error} loading={!status.data}/>
    {status.error && <button onClick={status.reload}>重试</button>}
    {status.data?.items.length === 0 && <p className="empty">暂无网页入口</p>}
    {status.data?.items.map(row => <div className="toolbar" key={row.id}>
      <span>{row.label}</span><button onClick={() => setEditing(row)}>编辑</button>
    </div>)}
    {editing && status.data && <Modal title={item ? "编辑网页入口" : "添加网页入口"} close={() => setEditing(undefined)}>
      <ActionForm submit={async form => {
        const identity = {id:item?.id ?? crypto.randomUUID(), label:value(form,"label"), url:value(form,"url"),
          ...(item?.cookieNames ? {cookieNames:item.cookieNames} : {})};
        const updated = item && legacy && form.get("sharingScope") === "legacy" ? {...item, ...identity}
          : {...identity, departmentId:null, role:null, audience:readAudience(form)};
        const { revision, items } = status.data!;
        await api(endpoint, { revision, items: item ? items.map(row => row.id === item.id ? updated : row) : [...items, updated] }, "PUT");
        setEditing(undefined);
        status.reload();
      }}>
        <Field label="名称"><input name="label" required maxLength={80} defaultValue={item?.label}/></Field>
        <Field label="网页地址"><input name="url" type="url" required maxLength={2048} defaultValue={item?.url}/></Field>
        <OrganizationAudienceFields path={path} departments={departments} initial={initial} legacy={legacy}/>
      </ActionForm>
    </Modal>}
  </section>;
}

type Publication = { id:string; title:string; description:string; packageName?:string; publishedVersion:string|null; canSubmit:boolean; audience?:Audience };
type Version = { version:string; status:"pending"|"approved"|"rejected"; note:string; created_at:number; title?:string; description?:string };

export function OrganizationPublications({ path, kind, departments }: {
  path:string; kind:Kind; departments:Row[];
}) {
  const root = path + "/publications/" + kind;
  const list = useData<{ canManage:boolean; items:Publication[] }>(root);
  const [selected,select] = useState("");
  const [editing,setEditing] = useState<Publication | "new">();
  return <section className="panel">
    <div className="toolbar"><h2>{kind === "plugin" ? "插件" : kind === "skill" ? "Skill" : "模板"}</h2>
      {list.data && <button className="primary" onClick={() => setEditing("new")}>提交资源</button>}
    </div>
    <Status error={list.error} loading={!list.data}/>
    {list.data?.items.length === 0 && <p className="empty">暂无共享资源</p>}
    {list.data?.items.map(item => <div key={item.id}>
      <div className="toolbar">
        <button className="link" aria-expanded={selected === item.id} onClick={() => select(selected === item.id ? "" : item.id)}>{item.title}</button>
        <span>{[item.packageName, item.publishedVersion].filter(Boolean).join(" · ")}</span>
      </div>
      {selected === item.id && <PublicationDetails root={root + "/" + item.id} item={item} kind={kind}
        canManage={list.data!.canManage} enterprisePath={path} departments={departments}
        refresh={list.reload} edit={() => setEditing(item)}/>}
    </div>)}
    {editing && <Modal title={editing === "new" ? "提交资源" : "提交新版本"} close={() => setEditing(undefined)}>
      <ActionForm label="提交审核" submit={async form => {
        const file = form.get("html");
        if (kind === "template" && (!(file instanceof File) || !file.size || file.size > 512*1024))
          throw new Error("请选择不超过 512 KB 的 HTML 文件");
        const saved = await api<{id:string}>(root,{
          ...(editing === "new" ? {} : {id:editing.id}),
          title:value(form,"title"), description:value(form,"description"), version:value(form,"version"),
          ...(kind === "plugin" ? {packageName:value(form,"packageName")} : kind === "skill"
            ? {markdown:value(form,"markdown")} : {html:await (file as File).text()}),
        });
        setEditing(undefined);
        select(saved.id);
        list.reload();
      }}>
        <Field label="资源名称"><input name="title" required maxLength={120} defaultValue={editing === "new" ? "" : editing.title}/></Field>
        <Field label="说明"><textarea name="description" maxLength={kind === "skill" ? 1000 : 2000} required={kind === "skill"} rows={2}
          defaultValue={editing === "new" ? "" : editing.description}/></Field>
        {kind === "plugin" ? <Field label="插件包名"><input name="packageName" placeholder="@team/plugin" required
          defaultValue={editing === "new" ? "" : editing.packageName} readOnly={editing !== "new"}/></Field>
          : kind === "skill" ? <Field label="SKILL.md"><textarea name="markdown" required rows={7} maxLength={32000}/></Field>
          : <Field label="HTML 文件"><input required type="file" name="html" accept=".html,.htm,text/html"/></Field>}
        <Field label="版本"><input name="version" placeholder="1.0.0" required maxLength={64}/></Field>
      </ActionForm>
    </Modal>}
  </section>;
}

function PublicationDetails({ root,item,kind,canManage,enterprisePath,departments,refresh,edit }: {
  root:string; item:Publication; kind:Kind; canManage:boolean; enterprisePath:string;
  departments:Row[]; refresh():void; edit():void;
}) {
  const versions = useData<{items:Version[]}>(root + "/versions");
  const [error,setError] = useState("");
  const [pending,setPending] = useState(false);
  const [preview,setPreview] = useState<string>();
  const [modal,setModal] = useState<"access"|"archive"|{ version: string }>();
  const [review,setReview] = useState<{ version: string; decision: "approve"|"reject" }>();
  const release = (version:string) => root + "/versions/" + encodeURIComponent(version);
  const run = async (action:()=>Promise<void>) => {
    setPending(true);
    setError("");
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "操作失败"); }
    finally { setPending(false); }
  };
  return <>
    {item.description && <p>{item.description}</p>}
    <div className="actions">
      {item.canSubmit && <button onClick={edit}>提交新版本</button>}
      {canManage && item.audience && <button onClick={() => setModal("access")}>访问权限</button>}
      {canManage && item.publishedVersion && <button onClick={() => setModal("archive")}>下架资源</button>}
    </div>
    <Status error={versions.error || error} loading={!versions.data}/>
    {versions.data && <div className="table-scroll"><table>
      <thead><tr><th>版本</th><th>状态</th><th>审核说明</th><th>提交时间</th><th>操作</th></tr></thead>
      <tbody>{versions.data.items.map(row => {
        const published = item.publishedVersion === row.version;
        return <tr key={row.version}><td>{row.version}</td>
          <td>{published ? "已发布" : {pending:"待审核",approved:"已通过",rejected:"已驳回"}[row.status]}</td>
          <td>{[row.title, row.description, row.note].filter(Boolean).join(" · ") || "—"}</td><td>{date(row.created_at)}</td>
          <td><div className="actions">
            {kind !== "plugin" && <button disabled={pending} onClick={() => void run(async () => {
              const data = await api<{html?:string;markdown?:string}>(release(row.version));
              setPreview(data.html ?? data.markdown ?? "");
            })}>预览</button>}
            {kind === "plugin" && published && <span>在 iPolloWork 桌面端安装</span>}
            {canManage && !published && row.status === "pending" && <>
              <button onClick={() => setReview({version:row.version,decision:"approve"})}>通过</button>
              <button onClick={() => setReview({version:row.version,decision:"reject"})}>驳回</button>
            </>}
            {canManage && item.audience && !published && row.status === "approved" &&
              <button disabled={pending} onClick={() => setModal({ version: row.version })}>下发资源</button>}
          </div></td>
        </tr>;
      })}</tbody>
    </table></div>}
    {review && <Modal title="版本审核" close={() => setReview(undefined)}>
      <ActionForm label={review.decision === "approve" ? "通过" : "驳回"} submit={async form => {
        await api(release(review.version),{decision:review.decision,note:value(form,"note")},"PUT");
        setReview(undefined);
        versions.reload();
      }}><Field label="审核说明"><textarea name="note" rows={3} maxLength={1000}/></Field></ActionForm>
    </Modal>}
    {(modal === "access" || typeof modal === "object") && item.audience && <Modal
      title={modal === "access" ? "访问权限" : "下发资源"} close={() => setModal(undefined)}>
      <ActionForm label={modal === "access" ? "保存" : "下发资源"} submit={async form => {
        const audience = readAudience(form);
        if (modal === "access") await api(enterprisePath + "/grants", { kind, assetId:item.id, audience }, "PUT");
        else await api(release(modal.version), { decision:"publish", audience }, "PUT");
        setModal(undefined);
        refresh();
      }}>
        <OrganizationAudienceFields path={enterprisePath} departments={departments} initial={item.audience}/>
      </ActionForm>
    </Modal>}
    {modal === "archive" && <Modal title="下架资源" close={() => setModal(undefined)}>
      <p>下架后组织成员无法获取该资源，已提交版本保留在历史记录中。</p>
      <ActionForm label="确认下架" submit={async () => { await api(root,undefined,"DELETE"); setModal(undefined); refresh(); }} />
    </Modal>}
    {preview !== undefined && <Modal title={item.title} close={() => setPreview(undefined)}>
      {kind === "skill" ? <pre className="about-document">{preview}</pre> :
        <iframe title={item.title} sandbox="" width="100%" height={380} referrerPolicy="no-referrer"
          srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">${preview}`}/>}
      <button onClick={() => {
        const url = URL.createObjectURL(new Blob([preview],{type:kind === "skill" ? "text/markdown" : "text/html"}));
        const link = document.createElement("a");
        link.href = url; link.download = kind === "skill" ? "SKILL.md":"template.html"; link.click();
        setTimeout(() => URL.revokeObjectURL(url),1000);
      }}>{kind === "skill" ? "下载 Skill" : "下载 HTML"}</button>
    </Modal>}
  </>;
}

export function OrganizationActivity({ path }: {path:string}) {
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);
  const params = new URLSearchParams({actor, ...(before ? {before} : {})});
  const activity = useData<{items:Row[]; next?:string | null}>(path + "/activity?" + params);
  return <section className="panel">
    <div className="toolbar"><h2>操作记录</h2>
      <form onSubmit={event => { event.preventDefault(); setActor(query.trim()); setCursors([]); }}>
        <input type="search" maxLength={120} aria-label="操作人姓名或工号" value={query} onChange={event => setQuery(event.target.value)}/>
        <button type="submit">搜索</button>
      </form>
    </div>
    <Status error={activity.error} loading={!activity.data}/>
    {activity.error && <button onClick={activity.reload}>重试</button>}
    {activity.data && <Table rows={activity.data.items} columns={[
      {label:"操作",cell:item=>operation(item.action)},
      {label:"成员",cell:item=>text(item.actor) || "—"},
      {label:"时间",cell:item=>date(item.created_at)},
    ]}/>}
    <OrganizationPager previous={before ? () => setCursors(current => current.slice(0,-1)) : undefined}
      next={activity.data?.next ? () => setCursors(current => [...current, activity.data!.next!]) : undefined}/>
  </section>;
}

export function OrganizationPager({ previous, next }: { previous?: () => void; next?: () => void }) {
  if (!previous && !next) return null;
  return <div className="actions">
    <button type="button" disabled={!previous} onClick={previous}>上一页</button>
    <button type="button" disabled={!next} onClick={next}>下一页</button>
  </div>;
}

export function OrganizationMemberOptions({ path, initial, name }: { path: string; initial: string[]; name: string }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set(initial));
  const directory = useData<{items: Row[]; more: boolean}>(path + "/members?" + new URLSearchParams({ query, page: String(page), active: "true" }));
  return <fieldset>
    <legend>选定员工 · 已选 {selected.size} 人</legend>
    <input type="search" aria-label="搜索成员" placeholder="姓名、工号或邮箱" maxLength={120} value={query}
      onChange={event => { setQuery(event.target.value); setPage(1); }}/>
    <Status error={directory.error} loading={!directory.data}/>
    {directory.error && <button type="button" onClick={directory.reload}>重试</button>}
    {directory.data?.items.length === 0 && <p className="empty">没有匹配的成员</p>}
    {directory.data?.items.map(row => {
      const id = text(row.user_id);
      const alreadyGranted = row.role !== "member" && !selected.has(id);
      return <label key={id} className="check"><input type="checkbox" checked={selected.has(id)}
        disabled={alreadyGranted || (!selected.has(id) && selected.size >= 500)}
        onChange={event => {
          const checked = event.target.checked;
          setSelected(previous => {
            const next = new Set(previous);
            if (checked) next.add(id); else next.delete(id);
            return next;
          });
        }}/>{[row.name, row.employee_number, row.email, alreadyGranted && "已有访问权限"].filter(Boolean).map(text).join(" · ")}</label>;
    })}
    {[...selected].map(id => <input key={id} type="hidden" name={name} value={id}/>)}
    <OrganizationPager previous={page > 1 ? () => setPage(page - 1) : undefined}
      next={directory.data?.more ? () => setPage(page + 1) : undefined}/>
  </fieldset>;
}

type WebhookSettings = {endpoint: string; enabled: boolean; configured: boolean};

export function OrganizationMembershipWebhook({ path }: { path: string }) {
  const endpoint = path + "/notifications";
  const info = useData<WebhookSettings>(endpoint);
  const [saved, setSaved] = useState<(WebhookSettings & {secret?: string})>();
  const current = saved ?? info.data;
  const [rotate, setRotate] = useState(false);
  return <section className="panel">
    <h2>成员变更通知</h2>
    <Status error={info.error} loading={!current}/>
    {info.error && <button onClick={info.reload}>重试</button>}
    {current && <ActionForm submit={async form => {
      setSaved(await api(endpoint, {endpoint:value(form,"endpoint").trim(),enabled:form.has("enabled"),rotate}, "PUT"));
      setRotate(false);
    }}>
      <Field label="HTTPS 接收地址"><input type="url" name="endpoint" maxLength={2048} defaultValue={current.endpoint}/></Field>
      <label className="check"><input name="enabled" type="checkbox" defaultChecked={current.enabled}/>发送成员变更通知</label>
      {current.configured && <label className="check"><input type="checkbox" checked={rotate} onChange={event => setRotate(event.target.checked)}/>保存时更换签名密钥</label>}
    </ActionForm>}
    {saved?.secret && <Field label="签名密钥，请复制到接收系统，仅此次显示"><input readOnly value={saved.secret}/></Field>}
    {saved && <p role="status">成员变更通知设置已保存</p>}
  </section>;
}

type Mcp = {reviewed?:boolean;id:string;title:string;description:string;host:string;endpoint?:string;enabled:boolean;oauthRequired:boolean;authorized:boolean;audience:Audience;
  oauth?:{authorizationUrl:string;tokenUrl:string;clientId:string;scope:string}};

export function OrganizationMcp({path,departments}: {path:string;departments:Row[]}) {
  const root=path+"/mcp";
  const list=useData<{canManage:boolean;items:Mcp[]}>(root);
  const [edit,setEdit]=useState<Mcp|"new">();
  const [access,setAccess]=useState<Mcp>();
  const [oauth,setOAuth]=useState(false);
  const [remove,setRemove]=useState<Mcp>();
  const item=edit==="new"?undefined:edit;
  return <section className="panel">
    <div className="toolbar"><h2>MCP</h2>{list.data?.canManage && <button className="primary" onClick={()=>{setEdit("new");setOAuth(false);}}>添加 MCP</button>}</div>
    <Status error={list.error} loading={!list.data}/>
    {list.data?.items.length === 0 && <p className="empty">暂无共享 MCP</p>}
    {list.data?.items.map(row=><div className="toolbar" key={row.id}>
      <span><strong>{row.title}</strong><small>{[row.description,row.host,row.enabled ? "" : "已停用"].filter(Boolean).join(" · ")}</small></span>
      {list.data?.canManage && <div className="actions">
        <button onClick={()=>{setEdit(row);setOAuth(row.oauthRequired);}}>编辑</button>
        <button onClick={()=>setAccess(row)}>访问权限</button>
        {!row.reviewed && <button onClick={()=>setRemove(row)}>移除</button>}
      </div>}
      {!list.data?.canManage && row.oauthRequired && !row.authorized && <span>请在桌面端完成授权</span>}
    </div>)}
    {edit && <Modal title={item?"编辑 MCP":"添加 MCP"} close={()=>setEdit(undefined)}>
      <ActionForm submit={async form=>{
        const key=value(form,"key").trim();
        await api(item ? root+"/"+item.id:root,{
          title:value(form,"title"),description:value(form,"description"),endpoint:value(form,"endpoint"),
          ...(item ? {enabled:form.get("enabled")==="on"} : {}),
          ...(oauth?{oauth:{
            authorizationUrl:value(form,"authorizationUrl"),tokenUrl:value(form,"tokenUrl"),
            clientId:value(form,"clientId"),scope:value(form,"scope"),
          }} : {...(item?.oauthRequired?{oauth:null}:{}),...(key?{key}:form.get("clear")==="on"?{key:null}:{})}),
        },item?"PATCH":"POST");
        setEdit(undefined);
        list.reload();
      }}>
        <Field label="名称"><input name="title" maxLength={120} required defaultValue={item?.title}/></Field>
        <Field label="说明"><input name="description" maxLength={1000} defaultValue={item?.description}/></Field>
        <Field label="MCP 地址"><input name="endpoint" type="url" required readOnly={item?.reviewed} defaultValue={item?.endpoint}/></Field>
        <Field label="成员使用 OAuth 授权"><input type="checkbox" checked={oauth} onChange={event=>setOAuth(event.target.checked)}/></Field>
        {oauth ? <>
          <Field label="授权地址"><input name="authorizationUrl" type="url" required defaultValue={item?.oauth?.authorizationUrl}/></Field>
          <Field label="令牌地址"><input name="tokenUrl" type="url" required defaultValue={item?.oauth?.tokenUrl}/></Field>
          <Field label="OAuth Client ID"><input name="clientId" required defaultValue={item?.oauth?.clientId}/></Field>
          <Field label="OAuth Scope"><input name="scope" defaultValue={item?.oauth?.scope}/></Field>
          <p>回调地址 {location.origin}/api/integrations/organization-mcp/callback</p>
        </> : <>
          <Field label="共享 Bearer 令牌（选填）"><input name="key" type="password" autoComplete="new-password"/></Field>
          {item && <Field label="清除保存的令牌"><input name="clear" type="checkbox"/></Field>}
        </>}
        {item && <Field label="启用 MCP"><input name="enabled" type="checkbox" defaultChecked={item.enabled}/></Field>}
      </ActionForm>
    </Modal>}
    {access && <Modal title="MCP 访问权限" close={()=>setAccess(undefined)}>
      <ActionForm submit={async form=>{
        await api(path+"/grants",{kind:"mcp",assetId:access.id,audience:readAudience(form)},"PUT");
        setAccess(undefined);
        list.reload();
      }}>
        <OrganizationAudienceFields path={path} departments={departments} initial={access.audience}/>
      </ActionForm>
    </Modal>}
    {remove && <Modal title="移除 MCP" close={()=>setRemove(undefined)}>
      <p>移除「{remove.title}」后，成员将无法通过组织使用它。</p>
      <ActionForm label="确认移除" submit={async()=>{await api(root+"/"+remove.id,undefined,"DELETE");setRemove(undefined);list.reload();}}/>
    </Modal>}
  </section>;
}

type FilePackage = { id: string; title: string; description: string; audience: Audience };

export function OrganizationPackages({ path, departments, canManage }: { path: string; departments: Row[]; canManage: boolean }) {
  const root = path + "/packages";
  const list = useData<{packages: FilePackage[]}>(path + "/assets");
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<FilePackage | "new">();
  const [grant, setGrant] = useState<FilePackage>();
  const [removing, setRemoving] = useState<FilePackage>();
  const item = editing === "new" ? undefined : editing;
  return <section className="panel">
    <div className="toolbar"><h2>文件包</h2>{canManage && <button className="primary" onClick={() => setEditing("new")}>新建文件包</button>}</div>
    <Status loading={!list.data} error={list.error}/>
    {list.error && <button onClick={list.reload}>重试</button>}
    {list.data?.packages.length === 0 && <p className="empty">暂无组织文件包</p>}
    {list.data?.packages.map(row => <div key={row.id}>
      <div className="toolbar">
        <button className="link" aria-expanded={selected === row.id} onClick={() => setSelected(selected === row.id ? undefined : row.id)}>{row.title}</button>
        <span>{row.description}</span>
        {canManage && <div className="actions">
          <button onClick={() => setEditing(row)}>编辑</button><button onClick={() => setGrant(row)}>访问权限</button>
          <button onClick={() => setRemoving(row)}>移除</button>
        </div>}
      </div>
      {selected === row.id && <PackageFiles path={root + "/" + row.id} canManage={canManage}/>}
    </div>)}
    {editing && <Modal title={item ? "编辑文件包" : "新建文件包"} close={() => setEditing(undefined)}>
      <ActionForm submit={async form => {
        const data = {title:value(form,"title"),description:value(form,"description")};
        if (item) await api(root + "/" + item.id, data, "PATCH");
        else {
          const created = await api<{id:string}>(root, {...data, audience:readAudience(form)});
          setSelected(created.id);
        }
        setEditing(undefined); list.reload();
      }}>
        <Field label="名称"><input name="title" required maxLength={120} defaultValue={item?.title}/></Field>
        <Field label="说明"><textarea name="description" maxLength={2000} defaultValue={item?.description}/></Field>
        {!item && <OrganizationAudienceFields path={path} departments={departments}/>}
      </ActionForm>
    </Modal>}
    {grant && <Modal title="文件包访问权限" close={() => setGrant(undefined)}>
      <ActionForm submit={async form => {
        await api(path + "/grants", {kind:"package",assetId:grant.id,audience:readAudience(form)}, "PUT");
        setGrant(undefined); list.reload();
      }}>
        <OrganizationAudienceFields path={path} departments={departments} initial={grant.audience}/>
      </ActionForm>
    </Modal>}
    {removing && <Modal title="移除文件包" close={() => setRemoving(undefined)}>
      <p>{removing.title}</p>
      <ActionForm label="确认移除" submit={async () => {await deletePermanently(root + "/" + removing.id); setRemoving(undefined); list.reload();}}/>
    </Modal>}
  </section>;
}

function PackageFiles({ path, canManage }: { path: string; canManage: boolean }) {
  const listing = useData<{files: Row[]}>(path);
  const [removing, setRemoving] = useState<Row>();
  return <>
    <Status loading={!listing.data} error={listing.error}/>
    {listing.error && <button onClick={listing.reload}>重试</button>}
    {listing.data && <Table rows={listing.data.files} columns={[
      {label:"文件",cell:row=>text(row.name)}, {label:"上传人",cell:row=>text(row.addedBy)},
      {label:"操作",cell:row=><div className="actions">
        <a href={path + "/files/" + encodeURIComponent(text(row.id)) + "/download?redirect=1"}>下载</a>
        {canManage && <button onClick={() => setRemoving(row)}>移除</button>}
      </div>},
    ]}/>}
    {canManage && <ActionForm label="上传" submit={async form => {
      const file = form.get("file");
      if (!(file instanceof File) || !file.name) throw new Error("请选择文件");
      if (file.size > 24 * 1024 * 1024) throw new Error("单个文件不能超过 24 MB");
      await api(path + "/files", form);
      listing.reload();
    }}><Field label="选择文件"><input type="file" name="file" required/></Field></ActionForm>}
    {removing && <Modal title="移除文件" close={() => setRemoving(undefined)}>
      <p>{text(removing.name)}</p>
      <ActionForm label="确认移除" submit={async () => {
        await deletePermanently(path + "/files/" + encodeURIComponent(text(removing.id)));
        setRemoving(undefined); listing.reload();
      }}/>
    </Modal>}
  </>;
}

type Usage = {
  totals: { tasks: number; measured: number; inputTokens: number; outputTokens: number };
  rows: Row[]; activityRows: Row[]; pageSize: number; totalRows: number; activityTotalRows: number;
  projects: number; skills: number; plugins: number;
  skillInventory?: { direct: number; published: number };
};

export function OrganizationAnalytics({ path }: { path: string }) {
  const [query, setQuery] = useState({ days:30, groupBy:"department", page:1, activityPage:1 });
  const [revision, retry] = useState(0);
  const [result, setResult] = useState<{query: typeof query; data?: Usage; error?: string}>();
  useEffect(() => {
    const abort = new AbortController();
    void api<Usage>(path + "/analytics", query, "POST", abort.signal).then(data => setResult({query,data}),
      error => { if (!abort.signal.aborted) setResult({query,error:error instanceof Error ? error.message : "读取失败"}); });
    return () => abort.abort();
  }, [path, query, revision]);
  const current = result?.query === query ? result : undefined;
  const data = current?.data;
  return <section className="panel">
    <div className="toolbar"><h2>数据分析</h2><div className="actions">
      <label>时间范围 <select value={query.days} onChange={event => setQuery({...query,days:Number(event.target.value),page:1,activityPage:1})}>
        {[7,30,90].map(days => <option key={days} value={days}>近 {days} 天</option>)}
      </select></label>
      <label>按 <select value={query.groupBy} onChange={event => setQuery({...query,groupBy:event.target.value,page:1,activityPage:1})}>
        <option value="department">部门</option><option value="member">成员</option><option value="sku">服务 / 模型</option>
      </select></label>
    </div></div>
    <Status error={current?.error} loading={!data}/>
    {current?.error && <button onClick={() => retry(value => value + 1)}>重试</button>}
    {data && <>
      <p>调用 {data.totals.tasks} · 已采集 Token 的调用 {data.totals.measured} · 新增项目 {data.projects} · 当前技能 {data.skills}
        {data.skillInventory && <>（直接上传 {data.skillInventory.direct} 项，审核发布 {data.skillInventory.published} 项）</>} · 现有插件 {data.plugins}</p>
      <Table rows={data.rows} columns={[
        {label:"名称",cell:row=>text(row.name) || "未分配"}, {label:"调用",cell:row=>text(row.tasks)},
        {label:"成功",cell:row=>text(row.succeeded)}, {label:"失败",cell:row=>text(row.failed)},
        {label:"输入 Token",cell:row=>row.measured ? text(row.inputTokens) : "—"},
        {label:"输出 Token",cell:row=>row.measured ? text(row.outputTokens) : "—"},
      ]}/>
      <OrganizationPager previous={query.page > 1 ? () => setQuery({...query,page:query.page-1}) : undefined}
        next={query.page * data.pageSize < data.totalRows ? () => setQuery({...query,page:query.page+1}) : undefined}/>
      <h3>Skill 与工具使用</h3>
      <Table rows={data.activityRows.map(row => ({...row,id:JSON.stringify([row.id,row.kind,row.activityName])}))} columns={[
        {label:"名称",cell:row=>text(row.activityName ?? row.name) || "未分配"},
        ...(query.groupBy !== "sku" && data.activityRows.some(row => row.activityName !== undefined)
          ? [{label:query.groupBy === "member" ? "成员" : "部门",cell:(row: Row)=>text(row.name) || "未分配"}] : []),
        {label:"类型",cell:row=>row.kind === "skill" ? "技能" : "工具"},
        {label:"调用",cell:row=>text(row.calls)}, {label:"成功",cell:row=>text(row.succeeded)},
      ]}/>
      <OrganizationPager previous={query.activityPage > 1 ? () => setQuery({...query,activityPage:query.activityPage-1}) : undefined}
        next={query.activityPage * data.pageSize < data.activityTotalRows ? () => setQuery({...query,activityPage:query.activityPage+1}) : undefined}/>
    </>}
  </section>;
}
