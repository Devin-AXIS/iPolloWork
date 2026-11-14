import type { EnterpriseCatalog } from "../shared/enterprise.ts";
import { request } from "./api.ts";

/** Short forms and native-entry actions; detail records open as page views instead. */
export type EnterpriseDialog =
  | { kind: "create" | "join" }
  | { kind: "createProject"; enterpriseId: string }
  | { kind: "assign"; projectId: string }
  | { kind: "continue"; shareId?: string; workId?: string }
  | {
      kind: "invite";
      enterpriseId: string;
      email?: string;
      role?: string;
      departmentId?: string | null;
      replaces?: string;
    }
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
export type EnterpriseTab =
  | "projects"
  | "members"
  | "departments"
  | "files"
  | "skills"
  | "models";
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
  /** Increments after every mutation so open detail views reload their records. */
  revision: number;
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
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private lifetime = new AbortController();
  private generation = 0;
  private loadedAt = 0;
  private toastId = 0;
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
    this.publish({
      catalog: null,
      loading: false,
      error: "",
      dialog: null,
      signedIn,
      views: [],
    });
    if (signedIn) void this.load();
  }
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
    this.publish({ enterpriseId, views: [] });
  };
  selectTab = (tab: EnterpriseTab) => this.publish({ tab, views: [] });
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
