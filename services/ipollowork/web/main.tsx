import { PluginMarket } from "./plugin-market.js";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Puzzle,
  Users,
  Building2,
  Folder,
  Library,
  CreditCard,
  Receipt,
  Settings,
  Moon,
  Sun,
  LogOut,
  ArrowUpRight,
  ArrowRight,
  Plus,
  RefreshCw,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Zap,
  Database,
} from "lucide-react";
import {
  api,
  count,
  date,
  text,
  operation,
  type Row,
  type User,
} from "./api.js";
import {
  ActionForm,
  Field,
  Status,
  Table,
  useData,
  value,
} from "./components.js";
import {
  Enterprises,
  Projects,
  Resources,
  Plans,
  SettingsPage,
  UsersPage,
  SharePage,
} from "./pages.js";
import "./style.css";
import { Services } from "./services.js";
import { StorageQuota } from "./storage.js";
import { Connect, DataApps } from "./data-apps.js";

function Auth({ done }: { done: () => void }) {
  const inviteToken = location.pathname.startsWith("/invite/") ? location.pathname.split("/")[2] : null;
  const invitation = useData<{ organization: string; space: string | null; emailBound?:boolean }>(inviteToken ? "/api/invitations/" + encodeURIComponent(inviteToken) : "/api/health");
  const [register, setRegister] = useState(false);
  const [recover, setRecover] = useState(false), [sent, setSent] = useState(false);
  const [reveal, setReveal] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      email = value(form, "email");
    setBusy(true);
    setError("");
    try {
      if (recover) {
        await api('/api/auth/request-password-reset', { email, redirectTo: location.origin + '/reset-password' });
        setSent(true);
        return;
      }
      // Registration needs a display name; the email's local part is the default and can be changed later.
      await api("/api/auth/" + (register ? "sign-up" : "sign-in") + "/email", {
        name: email.split("@")[0] || email,
        email,
        password: value(form, "password"),
        callbackURL: location.href,
      });
      done();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-panel">
        <span className="auth-mark">
          <img src="/mark.svg" alt="iPollo" width="22" />
        </span>
        <h1>{recover ? '找回密码' : register ? "创建你的账号" : "欢迎回来"}</h1>
        <p>{inviteToken ? invitation.data?.organization ? `加入「${invitation.data.organization}」${invitation.data.space ? "的「" + invitation.data.space + "」空间" : ""}。${invitation.data.emailBound === false ? "请用自己的 iPolloWork 账号接受邀请。" : "请使用受邀邮箱登录或注册。"}` : invitation.error ? "邀请已失效，请联系管理员获取新链接。" : "正在检查组织邀请…" : "一个账号，连接官方模型、组织空间和积分"}</p>
        <Status error={invitation.error} />
        {register && inviteToken && invitation.data?.emailBound !== false && <p>使用受邀邮箱注册后，即可接受邀请，无需发送邮件。</p>}
        <div className="segmented" role="group" aria-label="账号">
          <button
            type="button"
            aria-pressed={!register}
            onClick={() => {
              setRegister(false);
              setRecover(false); setSent(false);
              setError("");
            }}
          >
            登录
          </button>
          <button
            type="button"
            aria-pressed={register}
            onClick={() => {
              setRegister(true);
              setRecover(false); setSent(false);
              setError("");
            }}
          >
            注册
          </button>
        </div>
        <form className="auth-form" onSubmit={(e) => void submit(e)}>
          <label className="icon-field">
            <Mail size={15} />
            <input
              name="email"
              type="email"
              placeholder="邮箱"
              required
              autoComplete="email"
              aria-label="邮箱"
            />
          </label>
          {!recover && <label className="icon-field">
            <Lock size={15} />
            <input
              name="password"
              type={reveal ? "text" : "password"}
              placeholder={register ? "密码，至少 10 位" : "密码"}
              minLength={register ? 10 : undefined}
              required
              autoComplete={register ? "new-password" : "current-password"}
              aria-label="密码"
            />
            <button
              type="button"
              className="field-eye"
              aria-label={reveal ? "隐藏密码" : "显示密码"}
              onClick={() => setReveal(!reveal)}
            >
              {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </label>}
          {sent && <p role="status">如果该邮箱对应已注册账号，重置邮件已发送，请检查收件箱和垃圾邮件。</p>}
          <Status error={error} />
          <button className="primary submit" disabled={busy}>
            {busy ? "处理中…" : recover ? '发送重置邮件' : register ? "注册并登录" : "登录"}
            <ArrowRight size={15} />
          </button>
        </form>
        {!register && <button type="button" className="link" onClick={() => { setRecover(!recover); setSent(false); setError(''); }}>{recover ? '返回登录' : '忘记密码？'}</button>}
      </div>
    </main>
  );
}
function ResetPassword() {
  const [done, setDone] = useState(false);
  return (
    <main className="auth">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-panel">
        <span className="auth-mark">
          <img src="/mark.svg" alt="iPollo" width="22" />
        </span>
        <h1>设置新密码</h1>
        {done ? (
          <p>
            密码已更新。<a href="/">返回登录</a>
          </p>
        ) : (
          <ActionForm
            submit={async (f) => {
              await api("/api/auth/reset-password", {
                token: new URLSearchParams(location.search).get("token"),
                newPassword: value(f, "password"),
              });
              setDone(true);
            }}
          >
            <Field label="新密码">
              <input
                name="password"
                type="password"
                minLength={10}
                autoComplete="new-password"
                required
              />
            </Field>
          </ActionForm>
        )}
      </div>
    </main>
  );
}
function InvitationJoin({ user, invite, done }: { user: User; invite: string; done: () => void }) {
  const [joined, setJoined] = useState(false);
  return <section className="panel invite">
    <h2>加入组织空间</h2>
    <p>当前账号：{user.email}。请确认使用接收此邀请的账号。</p>
    {joined ? <p role="status">已加入，可以返回 iPolloWork 刷新组织列表。</p> : <ActionForm label="接受邀请" submit={async () => {
      await api("/api/v1/invitations/" + encodeURIComponent(invite) + "/accept", {});
      setJoined(true); done();
    }}>{null}</ActionForm>}
  </section>;
}
const navigation = [
  { id: "overview", title: "概览", icon: LayoutDashboard },
  { id: "users", title: "用户", icon: Users, admin: true },
  { id: "enterprises", title: "组织", icon: Building2 },
  { id: "projects", title: "项目", icon: Folder },
  { id: "services", title: "服务中心", icon: Zap },
  { id: "resources", title: "资源", icon: Library },
  { id: "plans", title: "套餐", icon: CreditCard },
  { id: "orders", title: "订单", icon: Receipt },
  { id: "plugin-market", title: "插件市场", icon: Puzzle, admin: true },
  { id: "data-apps", title: "应用数据", icon: Database, admin: true },
  { id: "settings", title: "设置", icon: Settings, admin: true },
];
function Overview({ user, go }: { user: User; go: (page: string) => void }) {
  const mine = useData<{
    points: Row;
    entitlements: Row[];
    enterprises: Row[];
  }>("/api/v1/me/summary");
  const stats = useData<{
    users: number;
    enterprises: number;
    paidOrders: number;
    points: number;
    audit: Row[];
    revenue: Row[];
  }>(user.role === "admin" ? "/api/v1/admin/overview" : "/api/v1/me/summary");
  return (
    <>
      <Status
        error={mine.error || stats.error}
        loading={!mine.data || !stats.data}
      />
      {mine.data && stats.data && (
        <div className="dashboard">
          <section className="panel account">
            <div className="section-title">
              我的账户 <CreditCard size={17} />
            </div>
            <div className="account-name">iPolloWork · {user.name}</div>
            <div className="balance">
              {count(mine.data.points.balance)}
              <span>可用积分</span>
            </div>
            <p>套餐、积分和组织，使用同一个账号。</p>
            <div className="account-stats">
              <div>
                <small>我的组织</small>
                <strong>{mine.data.enterprises.length}</strong>
              </div>
              <div>
                <small>有效权益</small>
                <strong>{mine.data.entitlements.length}</strong>
              </div>
              <div>
                <small>累计消费</small>
                <strong>{count(mine.data.points.totalSpent)}</strong>
              </div>
            </div>
            <button className="link end" onClick={() => go("plans")}>
              查看套餐 <ArrowUpRight size={14} />
            </button>
          </section>
          <div className="dashboard-right">
            <div className="metrics">
              {(user.role === "admin"
                ? ([
                    ["注册用户", stats.data.users, Users],
                    ["组织", stats.data.enterprises, Building2],
                    ["已支付订单", stats.data.paidOrders, Receipt],
                  ] as const)
                : ([
                    ["已获取积分", mine.data.points.totalEarned, CreditCard],
                    ["组织", mine.data.enterprises.length, Building2],
                    ["权益", mine.data.entitlements.length, Receipt],
                  ] as const)
              ).map(([label, v, Icon]) => (
                <section className="panel metric" key={label}>
                  <div>
                    {label}
                    <Icon size={16} />
                  </div>
                  <strong>{count(v)}</strong>
                </section>
              ))}
            </div>
            <section className="panel recent">
              <div className="section-title">
                {user.role === "admin" ? "最近操作" : "我的组织"}
              </div>
              {user.role === "admin" ? (
                <Table
                  rows={stats.data.audit}
                  columns={[
                    { label: "操作人", cell: (r) => text(r.name) },
                    { label: "操作", cell: (r) => operation(r.action) },
                    { label: "时间", cell: (r) => date(r.created_at) },
                  ]}
                />
              ) : (
                <Table
                  rows={mine.data.enterprises}
                  columns={[
                    { label: "组织", cell: (r) => text(r.name) },
                    { label: "身份", cell: (r) => text(r.role) },
                  ]}
                />
              )}
            </section>
          </div>
          <StorageQuota scope="personal" ownerId={user.id} />
          <section className="panel shortcuts">
            <h2>常用操作</h2>
            {[
              ["enterprises", "管理组织", "成员、部门与邀请"],
              ["resources", "组织资源", "团队共享的 Skills 与插件"],
              ["projects", "我的项目", "按组织查看项目"],
            ].map(([page, label, sub]) => (
              <button key={page} onClick={() => go(page)}>
                <span>
                  {label}
                  <small>{sub}</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </section>
          <section className="panel recent">
            <h2>{user.role === "admin" ? "累计实收" : "有效套餐"}</h2>
            {user.role === "admin" ? (
              <Table
                rows={stats.data.revenue}
                columns={[
                  { label: "币种", cell: (r) => text(r.currency) },
                  {
                    label: "金额",
                    cell: (r) => (Number(r.amount) / 100).toFixed(2),
                  },
                ]}
              />
            ) : (
              <Table
                rows={mine.data.entitlements}
                columns={[
                  { label: "套餐", cell: (r) => text(r.name) },
                  { label: "到期", cell: (r) => date(r.expires_at) },
                ]}
              />
            )}
          </section>
        </div>
      )}
    </>
  );
}
function Orders({ user }: { user: User }) {
  const result = useData<{ items: Row[] }>(
    user.role === "admin" ? "/api/v1/admin/orders" : "/api/v1/orders",
  );
  return (
    <section className="panel">
      <Status error={result.error} loading={!result.data} />
      {result.data && (
        <Table
          rows={result.data.items}
          columns={[
            {
              label: "订单",
              cell: (r) => <code>{text(r.id).slice(0, 8)}</code>,
            },
            { label: "用户", cell: (r) => text(r.email || user.email) },
            {
              label: "金额",
              cell: (r) =>
                r.provider === "points"
                  ? count(r.amount) + " 积分"
                  : (Number(r.amount) / 100).toFixed(2) +
                    " " +
                    text(r.currency),
            },
            { label: "渠道", cell: (r) => text(r.provider) },
            {
              label: "状态",
              cell: (r) => (
                <span className="badge">
                  {{
                    paid: "已支付",
                    pending: "待支付",
                    refunded: "已退款",
                    failed: "失败",
                  }[text(r.status)] ?? text(r.status)}
                </span>
              ),
            },
            { label: "创建时间", cell: (r) => date(r.created_at) },
          ]}
        />
      )}
    </section>
  );
}
function App() {
  const session = useData<{ user: User } | null>("/api/auth/get-session"),
    [page, setPage] = useState(() => location.hash === "#plugin-market" ? "plugin-market" : "overview"),
    [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  React.useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  if (session.error) return <Status error={session.error} />;
  if (session.data === undefined)
    return (
      <main className="auth">
        <Status loading />
      </main>
    );
  if (!session.data?.user) return <Auth done={session.reload} />;
  if (location.pathname === "/connect") return <Connect name={session.data.user.name} />;
  const user = session.data.user,
    nav = navigation.filter((n) => !n.admin || user.role === "admin"),
    selected = nav.find((n) => n.id === page) ?? nav[0];
  const invite = location.pathname.startsWith("/invite/")
    ? location.pathname.split("/")[2]
    : null;
  const shared = location.pathname.startsWith("/share/")
    ? location.pathname.split("/")[2]
    : null;
  return (
    <div className="app">
      <a className="skip" href="#content">
        跳到内容
      </a>
      <aside className="rail">
        <a className="brand" href="/" aria-label="iPolloWork">
          <img src="/mark.svg" width="30" alt="" />
        </a>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              title={n.title}
              aria-label={n.title}
              aria-current={selected.id === n.id ? "page" : undefined}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={19} />
              <span>{n.title}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button
            title={dark ? "浅色" : "深色"}
            aria-label="切换外观"
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            aria-label="退出登录"
            title="退出登录"
            onClick={async () => {
              await api("/api/auth/sign-out", {});
              session.reload();
            }}
          >
            <LogOut size={18} />
          </button>
          <span className="avatar" title={user.email}>
            {user.name.slice(0, 1)}
          </span>
        </div>
      </aside>
      <div className="shell">
        <header>
          <span>
            iPolloWork <i>/</i> {shared ? "会话分享" : selected.title}
          </span>
          <span className="user-name">
            {user.name} · {user.role === "admin" ? "管理员" : "个人账户"}
          </span>
        </header>
        <main id="content">
          <div className="page-heading">
            <div>
              <h1>{shared ? "会话分享" : selected.title}</h1>
              <p>
                {
                  {
                    overview: "账户与团队的工作概况",
                    users: "账号、权限与积分",
                    enterprises: "把成员与资源放在同一个组织下",
                    projects:
                      "管理个人与组织项目，分享与协作请在 iPolloWork 中操作",
                    resources: "管理你的 Skills、插件和文件",
                    plans: "套餐、权益与积分充值",
                    orders: "查看交易与支付状态",
                    settings: "支付和私有存储配置",
                    services: "模型连接、价格与调用能力",
                    'plugin-market': "管理 iPolloWork 官方在线插件目录",
                    'data-apps': "应用归属、记录和存储用量",
                  }[selected.id]
                }
              </p>
            </div>
          </div>
          {invite && <InvitationJoin user={user} invite={invite} done={() => setPage("enterprises")} />}
          {shared ? (
            <SharePage id={shared} />
          ) : selected.id === "overview" ? (
            <Overview user={user} go={setPage} />
          ) : selected.id === "users" ? (
            <UsersPage />
          ) : selected.id === "enterprises" ? (
            <Enterprises user={user} />
          ) : selected.id === "projects" ? (
            <Projects />
          ) : selected.id === "resources" ? (
            <Resources user={user} />
          ) : selected.id === "plans" ? (
            <Plans user={user} />
          ) : selected.id === "orders" ? (
            <Orders user={user} />
          ) : selected.id === "services" ? (
            <Services user={user} />
          ) : selected.id === "plugin-market" ? (
            <PluginMarket />
          ) : selected.id === "data-apps" ? (
            <DataApps />
          ) : (
            <SettingsPage />
          )}
        </main>
        <footer>
          <span>iPolloWork</span>
          <span>账号与组织服务</span>
        </footer>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  location.pathname === "/reset-password" ? <ResetPassword /> : <App />,
);
