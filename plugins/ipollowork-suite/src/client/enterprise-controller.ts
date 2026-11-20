import type { EnterpriseCatalog, EnterpriseTab, MemberNotice, MemberNoticeFeed } from "../shared/enterprise.ts";
export type { EnterpriseTab } from "../shared/enterprise.ts";
import { request } from "./api.ts";

/** Short forms and native-entry actions; detail records open as page views instead. */
export type EnterpriseDialog =
  | { kind: "create" | "joinService" }
  | { kind: "createProject"; enterpriseId: string }
  | { kind: "assign"; projectId: string }
  | { kind: "continue"; shareId?: string; workId?: string }
  | {
      kind: "joinCode";
      enterpriseId: string;
      projectId?: string;
      projectRole?: "view" | "participate" | "maintain";
    }
  | { kind: "memberNotices"; noticeId: string }
  | { kind: "member"; enterpriseId: string; userId: string }
  | {
      kind: "confirm";
      title: string;
      description: string;
      confirmLabel: string;
      run: () => Promise<void>;
    };
/** One level of the enterprise page; the page keeps a stack so Back returns to the previous level. */
export type EnterpriseView =
  | { kind: "project"; id: string }
  | { kind: "work"; id: string }
  | { kind: "share"; id: string };
export interface EnterpriseToast {
  id: number;
  text: string;
}
export interface EnterpriseState {
  catalog: EnterpriseCatalog | null;
  loading: boolean;
  error: string;
  dialog: EnterpriseDialog | null;
  signedIn: boolean;
  /** Selected enterprise; null shows personal records. */
  enterpriseId: string | null;
  tab: EnterpriseTab;
  views: readonly EnterpriseView[];
  toast: EnterpriseToast | null;
  memberNotices: MemberNoticeFeed | null;
  memberNoticeError: string;
  /** Increments after every mutation so open detail views reload their records. */
  revision: number;
  publicationTarget?: string | undefined;
}
const SELECTED_KEY = "ipollowork.enterprise.selected";
const FOCUS_REFRESH_MS = 30_000;
function remembered(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}
function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(SELECTED_KEY, id);
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    /* Browser storage is a convenience; selection still works for this page lifetime. */
  }
}

/** One account-scoped source shared by the enterprise page, its dialogs, and native row actions. */
export class EnterpriseController {
  private state: EnterpriseState = {
    catalog: null,
    loading: false,
    error: "",
    dialog: null,
    signedIn: false,
    enterpriseId: remembered(),
    tab: "projects",
    views: [],
    toast: null,
    memberNotices: null,
    memberNoticeError: "",
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private lifetime = new AbortController();
  private generation = 0;
  private loadedAt = 0;
  private toastId = 0;
  private noticeAccount = 0;
  private noticeRequest = 0;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<EnterpriseState>) {
    if (this.lifetime.signal.aborted) return;
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  call = <T>(path: string, data?: unknown, method?: string): Promise<T> =>
    request<T>("/enterprise" + path, {
      signal: this.lifetime.signal,
      ...(method ? { method } : data === undefined ? {} : { method: "POST" }),
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  accountChanged(signedIn: boolean) {
    this.generation++;
    this.noticeAccount++;
    this.noticeRequest++;
    this.publish({
      catalog: null,
      loading: false,
      error: "",
      dialog: null,
      signedIn,
      views: [],
      toast: null,
      memberNotices: null,
      memberNoticeError: "",
      publicationTarget: undefined,
    });
    if (signedIn) void this.load();
  }
  loadNotices = async (): Promise<MemberNoticeFeed | undefined> => {
    if (!this.state.signedIn) return;
    const requestId = ++this.noticeRequest;
    try {
      const feed = await this.call<MemberNoticeFeed>("/notices");
      if (requestId !== this.noticeRequest) return;
      this.publish({ memberNotices: feed, memberNoticeError: "" });
      return feed;
    } catch (error) {
      if (requestId === this.noticeRequest) this.publish({
        memberNoticeError: error instanceof Error ? error.message : "IPW_ACCOUNT_UNAVAILABLE",
      });
    }
  };
  readNotices = async (input: { ids: string[] } | { all: true }) => {
    const account = this.noticeAccount;
    await this.call("/notices", input, "PUT");
    if (account === this.noticeAccount) await this.loadNotices();
    return account === this.noticeAccount;
  };
  openNotices = () => this.loadNotices();

  /** Resolve existing destinations under the current account before switching view. */
  openOrganizationNotice = async (row: MemberNotice, showPanel?: () => void) => {
    const generation = this.noticeAccount;
    const { enterpriseId, tab, targetId } = row;
    if (!this.state.signedIn) return;
    if (enterpriseId && tab) {
      const registry = { templates: "template", skills: "skill", plugins: "plugin", mcp: "mcp" } as const;
      const root = "/organizations/" + encodeURIComponent(enterpriseId);
      if (targetId) {
        const id = encodeURIComponent(targetId);
        if (tab === "projects") await this.call("/projects/" + id + "/space");
        else if (tab === "messages") await this.call(root + "/messages/" + id);
        else if (Object.hasOwn(registry, tab)) await this.call(root + "/publications/" + registry[tab as keyof typeof registry] + "/" + id);
        else await this.call(root);
      } else await this.call(root);
      if (generation !== this.noticeAccount) return;
      this.open(null);
      this.openNotice(enterpriseId, tab, targetId ?? undefined);
      showPanel?.();
    } else {
      this.open({ kind: "memberNotices", noticeId: row.id });
    }
    if (row.readAt === null && generation === this.noticeAccount) await this.readNotices({ ids: [row.id] });
  };

  load = async () => {
    if (!this.state.signedIn) return;
    const generation = ++this.generation;
    this.publish({ loading: true, error: "" });
    try {
      const catalog = await this.call<EnterpriseCatalog>("");
      if (generation !== this.generation) return;
      this.loadedAt = Date.now();
      const current = this.state.enterpriseId;
      const enterpriseId =
        current && catalog.enterprises.some((e) => e.id === current)
          ? current
          : (catalog.enterprises[0]?.id ?? null);
      if (enterpriseId !== current) remember(enterpriseId);
      this.publish({
        catalog,
        loading: false,
        enterpriseId,
        revision: this.state.revision + 1,
      });
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          loading: false,
          error:
            error instanceof Error ? error.message : "IPW_ACCOUNT_UNAVAILABLE",
          revision: this.state.catalog ? this.state.revision + 1 : this.state.revision,
        });
    }
  };
  /** Window-focus refresh; skipped while a recent load is still current. */
  refreshIfStale = () => {
    if (Date.now() - this.loadedAt >= FOCUS_REFRESH_MS && !this.state.loading)
      void this.load();
  };
  open = (dialog: EnterpriseDialog | null) => this.publish({ dialog });
  selectEnterprise = (enterpriseId: string | null) => {
    remember(enterpriseId);
    this.publish({ enterpriseId, views: [], publicationTarget: undefined });
  };
  selectTab = (tab: EnterpriseTab) => this.publish({ tab, views: [], publicationTarget: undefined });
  openNotice = (enterpriseId: string, tab: EnterpriseTab, target?: string) => {
    remember(enterpriseId);
    this.publish({
      enterpriseId, tab, publicationTarget: tab === "projects" ? undefined : target,
      views: tab === "projects" && target ? [{ kind:"project", id:target }] : [],
      revision: this.state.revision + 1,
    });
  };
  clearNoticeTarget = () => this.publish({ publicationTarget: undefined });
  push = (view: EnterpriseView) =>
    this.publish({ views: [...this.state.views, view], dialog: null });
  /** Replace the stack with one view, used when another surface opens a record directly. */
  show = (view: EnterpriseView) =>
    this.publish({ views: [view], dialog: null });
  back = () => this.publish({ views: this.state.views.slice(0, -1) });
  notify = (text: string) =>
    this.publish({ toast: { id: ++this.toastId, text } });
  dismissToast = (id: number) => {
    if (this.state.toast?.id === id) this.publish({ toast: null });
  };
  dispose() {
    this.lifetime.abort();
    this.listeners.clear();
  }
}
