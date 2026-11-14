import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LayoutDashboard, Users, Building2, Folder, Library, CreditCard, Receipt, Settings, Moon, Sun, LogOut, ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import { api, count, date, text, operation, type Row, type User } from "./api.js";
import { ActionForm, Field, Modal, Status, Table, useData, value } from "./components.js";
import { Enterprises, Projects, Resources, Plans, SettingsPage, UsersPage, SharePage } from "./pages.js";
import "./style.css";
import { Services } from "./services.js";

function Auth({ done }: { done: () => void }) {
  const [register, setRegister] = useState(false), [reset, setReset] = useState(false), [message, setMessage] = useState("");
  return <main className="auth"><div className="auth-panel"><img src="/mark.svg" alt="iPollo" width="42"/><h1>{register ? "创建账号" : "欢迎回来"}</h1><p>登录 iPolloWork，连接你的工作与团队。</p>
    <ActionForm label={register ? "注册并登录" : "登录"} submit={async f => {
      await api("/api/auth/" + (register ? "sign-up" : "sign-in") + "/email", { name: value(f, "name"), email: value(f, "email"), password: value(f, "password") }); done();
    }}>
      {register && <Field label="姓名"><input name="name" required autoComplete="name"/></Field>}
      <Field label="邮箱"><input name="email" type="email" required autoComplete="email"/></Field>
      <Field label="密码"><input name="password" type="password" minLength={10} required autoComplete={register ? "new-password" : "current-password"}/></Field>
    </ActionForm>
    <div className="actions"><button className="link" onClick={() => setRegister(!register)}>{register ? "已有账号，返回登录" : "还没有账号？注册"}</button><button className="link" onClick={() => setReset(true)}>忘记密码</button></div>
    {reset && <Modal title="重置密码" close={() => setReset(false)}><ActionForm label="发送重置邮件" submit={async f => {
      await api("/api/auth/request-password-reset", {email:value(f,"email"),redirectTo:location.origin+"/reset-password"}); setMessage("如果邮箱已注册，你会收到重置邮件。");
    }}><Field label="邮箱"><input name="email" type="email" required/></Field></ActionForm><p role="status">{message}</p></Modal>}
  </div></main>;
}
function ResetPassword() {
  const [done,setDone]=useState(false);
  return <main className="auth"><div className="auth-panel"><h1>设置新密码</h1>{done?<p>密码已更新。<a href="/">返回登录</a></p>:<ActionForm submit={async f=>{
    await api("/api/auth/reset-password",{token:new URLSearchParams(location.search).get("token"),newPassword:value(f,"password")});setDone(true);
  }}><Field label="新密码"><input name="password" type="password" minLength={10} autoComplete="new-password" required/></Field></ActionForm>}</div></main>;
}
const navigation = [
  { id: "overview", title: "概览", icon: LayoutDashboard },
  { id: "users", title: "用户", icon: Users, admin: true },
  { id: "enterprises", title: "企业", icon: Building2 },
  { id: "projects", title: "项目", icon: Folder },
  { id: "services", title: "服务中心", icon: Settings },
  { id: "resources", title: "资源", icon: Library },
  { id: "plans", title: "套餐", icon: CreditCard },
  { id: "orders", title: "订单", icon: Receipt },
  { id: "settings", title: "设置", icon: Settings, admin: true },
];
function Overview({ user, go }: { user: User; go: (page: string) => void }) {
  const mine = useData<{ points: Row; entitlements: Row[]; enterprises: Row[] }>("/api/v1/me/summary");
  const stats = useData<{ users: number; enterprises: number; paidOrders: number; points: number; audit: Row[]; revenue: Row[] }>(user.role === "admin" ? "/api/v1/admin/overview" : "/api/v1/me/summary");
  return <><Status error={mine.error || stats.error} loading={!mine.data || !stats.data}/>
    {mine.data && stats.data && <div className="dashboard">
      <section className="panel account"><div className="section-title">我的账户 <CreditCard size={17}/></div><div className="account-name">iPolloWork · {user.name}</div><div className="balance">{count(mine.data.points.balance)}<span>可用积分</span></div><p>套餐、积分和企业，使用同一个账号。</p>
        <div className="account-stats"><div><small>我的企业</small><strong>{mine.data.enterprises.length}</strong></div><div><small>有效权益</small><strong>{mine.data.entitlements.length}</strong></div><div><small>累计消费</small><strong>{count(mine.data.points.totalSpent)}</strong></div></div>
        <button className="link end" onClick={() => go("plans")}>查看套餐 <ArrowUpRight size={14}/></button>
      </section>
      <div className="dashboard-right"><div className="metrics">{(user.role === "admin" ? [
        ["注册用户", stats.data.users, Users], ["企业", stats.data.enterprises, Building2], ["已支付订单", stats.data.paidOrders, Receipt],
      ] as const : [["已获取积分", mine.data.points.totalEarned, CreditCard], ["企业", mine.data.enterprises.length, Building2], ["权益", mine.data.entitlements.length, Receipt]] as const).map(([label, v, Icon]) =>
        <section className="panel metric" key={label}><div>{label}<Icon size={16}/></div><strong>{count(v)}</strong></section>)}</div>
        <section className="panel recent"><div className="section-title">{user.role === "admin" ? "最近操作" : "我的企业"}</div>{user.role === "admin" ? <Table rows={stats.data.audit} columns={[{ label: "操作人", cell: r => text(r.name) }, { label: "操作", cell: r => operation(r.action) }, { label: "时间", cell: r => date(r.created_at) }]}/> : <Table rows={mine.data.enterprises} columns={[{ label: "企业", cell: r => text(r.name) }, { label: "身份", cell: r => text(r.role) }]}/>}</section>
      </div>
      <section className="panel shortcuts"><h2>常用操作</h2>{[["enterprises", "管理企业", "成员、部门与邀请"], ["resources", "企业资源", "团队共享的 Skills 与插件"], ["projects", "我的项目", "按企业查看项目"]].map(([page, label, sub]) => <button key={page} onClick={() => go(page)}><span>{label}<small>{sub}</small></span><ArrowUpRight size={16}/></button>)}</section>
      <section className="panel recent"><h2>{user.role === "admin" ? "累计实收" : "有效套餐"}</h2>{user.role === "admin" ? <Table rows={stats.data.revenue} columns={[{ label: "币种", cell: r => text(r.currency) }, { label: "金额", cell: r => (Number(r.amount) / 100).toFixed(2) }]}/> : <Table rows={mine.data.entitlements} columns={[{ label: "套餐", cell: r => text(r.name) }, { label: "到期", cell: r => date(r.expires_at) }]}/>}</section>
    </div>}
  </>;
}
function Orders({ user }: { user: User }) {
  const result = useData<{ items: Row[] }>(user.role === "admin" ? "/api/v1/admin/orders" : "/api/v1/orders");
  return <section className="panel"><Status error={result.error} loading={!result.data}/>{result.data && <Table rows={result.data.items} columns={[
    { label: "订单", cell: r => <code>{text(r.id).slice(0, 8)}</code> }, { label: "用户", cell: r => text(r.email || user.email) },
    { label: "金额", cell: r => r.provider === "points" ? count(r.amount) + " 积分" : (Number(r.amount) / 100).toFixed(2) + " " + text(r.currency) },
    { label: "渠道", cell: r => text(r.provider) }, { label: "状态", cell: r => <span className="badge">{({ paid: "已支付", pending: "待支付", refunded: "已退款", failed: "失败" }[text(r.status)] ?? text(r.status))}</span> },
    { label: "创建时间", cell: r => date(r.created_at) },
  ]}/>}</section>;
}
function App() {
  const session = useData<{ user: User } | null>("/api/auth/get-session"), [page, setPage] = useState("overview"), [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  const [inviteMessage, setInviteMessage] = useState("");
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("theme", dark ? "dark" : "light"); }, [dark]);
  if (session.error) return <Status error={session.error}/>;
  if (session.data === undefined) return <main className="auth"><Status loading/></main>;
  if (!session.data?.user) return <Auth done={session.reload}/>;
  const user = session.data.user, nav = navigation.filter(n => !n.admin || user.role === "admin"), selected = nav.find(n => n.id === page) ?? nav[0];
  const invite = location.pathname.startsWith("/invite/") ? location.pathname.split("/")[2] : null;
  const shared = location.pathname.startsWith("/share/") ? location.pathname.split("/")[2] : null;
  return <div className="app"><a className="skip" href="#content">跳到内容</a><aside className="rail"><a className="brand" href="/" aria-label="iPolloWork"><img src="/mark.svg" width="30" alt=""/></a>
    <nav>{nav.map(n => <button key={n.id} title={n.title} aria-label={n.title} aria-current={selected.id === n.id ? "page" : undefined} onClick={() => setPage(n.id)}><n.icon size={19}/><span>{n.title}</span></button>)}</nav>
    <div className="rail-bottom"><button title={dark ? "浅色" : "深色"} aria-label="切换外观" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><button aria-label="退出登录" title="退出登录" onClick={async () => { await api("/api/auth/sign-out", {}); session.reload(); }}><LogOut size={18}/></button><span className="avatar" title={user.email}>{user.name.slice(0, 1)}</span></div>
  </aside><div className="shell"><header><span>iPolloWork <i>/</i> {shared ? "会话分享" : selected.title}</span><span className="user-name">{user.name} · {user.role === "admin" ? "管理员" : "个人账户"}</span></header>
    <main id="content"><div className="page-heading"><div><h1>{shared ? "会话分享" : selected.title}</h1><p>{({ overview: "账户与团队的工作概况", users: "账号、权限与积分", enterprises: "把成员与资源放在同一个企业下", projects: "管理个人与企业项目，分享与协作请在 iPolloWork 中操作", resources: "管理你的 Skills、插件和文件", plans: "套餐、权益与积分充值", orders: "查看交易与支付状态", settings: "支付和私有存储配置" }[selected.id])}</p></div></div>
      {invite && <section className="panel invite"><h2>你收到了一份企业邀请</h2><p>请使用被邀请的邮箱登录：{user.email}</p><ActionForm label="接受邀请" submit={async () => { await api("/api/v1/invitations/" + encodeURIComponent(invite) + "/accept", {}); setInviteMessage("已加入企业"); setPage("enterprises"); }}>{!user.emailVerified && <button type="button" onClick={async () => { try { await api("/api/auth/send-verification-email", { email: user.email, callbackURL: location.href }); setInviteMessage("验证邮件已发送"); } catch (e) { setInviteMessage(e instanceof Error ? e.message : "发送失败"); } }}>发送验证邮件</button>}</ActionForm><p role="status">{inviteMessage}</p></section>}
      {shared ? <SharePage id={shared}/> : selected.id === "overview" ? <Overview user={user} go={setPage}/> : selected.id === "users" ? <UsersPage/> : selected.id === "enterprises" ? <Enterprises/> : selected.id === "projects" ? <Projects/> : selected.id === "resources" ? <Resources user={user}/> : selected.id === "plans" ? <Plans user={user}/> : selected.id === "orders" ? <Orders user={user}/> : selected.id === "services" ? <Services user={user}/> : <SettingsPage/>}
    </main><footer><span>iPolloWork</span><span>账号与企业服务</span></footer></div></div>;
}
createRoot(document.getElementById("root")!).render(location.pathname==="/reset-password"?<ResetPassword/>:<App/>);
