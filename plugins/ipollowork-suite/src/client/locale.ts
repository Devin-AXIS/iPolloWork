/** Feature-owned copy. Missing locales use English; identifiers never depend on translated text. */
import { useSyncExternalStore } from "react";
import type { ClientContext } from "./native.ts";
const en = {
  connections: "Service connections",
  market: "iPolloWork market",
  intro: "Native DSH plugins, selected by iPolloWork.",
  search: "Search plugins",
  all: "All categories",
  public: "Public",
  enterprise: "Enterprise",
  enterpriseEmpty:
    "Enterprise plugins will appear here when an enterprise catalog is connected.",
  install: "Install",
  installed: "Installed",
  provided: "Provided by DSH",
  enabled: "Enabled",
  disabled: "Disabled",
  incompatible: "Incompatible version",
  details: "View details",
  back: "Back",
  refresh: "Refresh",
  empty: "No matching plugins",
  loading: "Loading…",
  retry: "Try again",
  resources: "Included plugins",
  nativeDetails: "View components and configuration",
  resourceHint:
    "Install this plugin to see its actual components and packaged documentation in DSH.",
  manage: "Manage plugin",
  information: "Plugin information",
  author: "Developer",
  category: "Category",
  packageName: "Package name",
  component: "Component",
  anyVersion: "Not specified",
  noResources: "No component entries are listed for this plugin.",
  homepage: "Project website",
  version: "Version",
  requires: "Requires DSH",
  account: "iPolloWork account",
  accountIntro:
    "One account for official models, enterprise spaces and points.",
  email: "Email",
  password: "Password",
  signIn: "Sign in",
  signOut: "Sign out",
  service: "Account service",
  registerAccount: "Sign up",
  registerAndSignIn: "Create account",
  passwordHint: "Password, at least 10 characters",
  registrationError:
    "Could not create the account. Check your details or sign in to an existing account.",
  points: "Available points",
  unavailable: "Unavailable",
  guest: "Not signed in",
  error: "Unable to complete this operation. Please try again.",
  loginError: "Sign-in failed. Check your email and password.",
  canceled: "The sign-in was cancelled.",
  incompatibleHint: "Choose a compatible release before installing.",
  welcomeTitle: "Welcome to iPolloWork",
  createTitle: "Create your account",
  showPassword: "Show password",
  hidePassword: "Hide password",
  accountStatus: "Account status",
  connected: "Connected",
};
const zh: typeof en = {
  connections: "服务连接",
  market: "iPolloWork 市场",
  intro: "由 iPolloWork 收录的 DSH 原生插件。",
  search: "搜索插件",
  all: "全部分类",
  public: "公开",
  enterprise: "组织",
  enterpriseEmpty: "连接组织目录后，这里会显示组织发布的插件",
  install: "安装",
  installed: "已安装",
  provided: "DSH 已提供",
  enabled: "已启用",
  disabled: "已停用",
  incompatible: "版本不兼容",
  details: "查看详情",
  back: "返回",
  refresh: "刷新",
  empty: "没有匹配的插件",
  loading: "正在加载…",
  retry: "重试",
  resources: "包含的插件",
  nativeDetails: "查看组件与配置",
  resourceHint: "安装后，可在 DSH 中查看此插件实际包含的组件和随包文档",
  manage: "管理插件",
  information: "插件信息",
  author: "开发者",
  category: "分类",
  packageName: "包名",
  component: "组件",
  anyVersion: "未指定",
  noResources: "此插件暂无可显示的组件条目",
  homepage: "项目主页",
  version: "版本",
  requires: "需要 DSH",
  account: "iPolloWork 账户",
  accountIntro: "一个账号，连接官方模型、组织空间和积分",
  email: "邮箱",
  password: "密码",
  signIn: "登录",
  signOut: "退出登录",
  service: "账户服务",
  registerAccount: "注册",
  registerAndSignIn: "注册并登录",
  passwordHint: "密码，至少 10 位",
  registrationError: "注册失败，请检查填写信息，或尝试登录已有账号",
  points: "可用积分",
  unavailable: "暂时无法读取",
  guest: "未登录",
  error: "操作未完成，请重试",
  loginError: "登录失败，请检查邮箱和密码",
  canceled: "本次登录已取消",
  incompatibleHint: "请先选择与当前 DSH 兼容的版本",
  welcomeTitle: "欢迎使用 iPolloWork",
  createTitle: "创建你的账号",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  accountStatus: "账户状态",
  connected: "已连接",
};
export function language(ctx: ClientContext): "zh" | "en" {
  const snapshot = ctx.locale.getSnapshot();
  const value =
    typeof snapshot === "string"
      ? snapshot
      : (snapshot.active ??
        snapshot.locale ??
        snapshot.language ??
        document.documentElement.lang);
  return value.startsWith("zh") ? "zh" : "en";
}
export function useCopy(ctx: ClientContext): typeof en {
  const value = useSyncExternalStore(
    (listener) => ctx.locale.subscribe(listener),
    () => language(ctx),
  );
  return value === "zh" ? zh : en;
}
export function copy(ctx: ClientContext): typeof en {
  return language(ctx) === "zh" ? zh : en;
}
export type Labels = typeof en;
export function labelSource(ctx: ClientContext) {
  return {
    getSnapshot: () => copy(ctx),
    subscribe: (listener: () => void) => ctx.locale.subscribe(listener),
  };
}
