import { OrganizationFilePackages } from "./organization-file-packages.tsx";
import { AnalyticsTab } from "./enterprise-analytics.tsx";
import { MemberNoticeDialog, MemberNoticeHistory, noticeMessage, OrganizationActivityTab, OrganizationNotices, OrganizationPublications } from "./organization-publications.tsx";
import { ConversationShareAction, OrganizationMessages } from "./conversation-shares.tsx";
import { McpTab } from "./enterprise-mcp.tsx";
import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  IconChevronDownOutlineRegular,
  IconRefreshOutlineRegular,
  IconUsersOutlineRegular,
  IconWorkspaceTreeOutlineRegular,
  Menu,
  Modal,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  EnterpriseCatalog,
  EnterpriseDetail,
  ProjectWork,
  ProjectGrant,
  ProjectSpace,
} from "../shared/enterprise.ts";
import { projectBoardOwnershipEvent, projectBoardPeopleEvent, type ProjectBoardPeopleAction } from "../shared/enterprise.ts";
import type { ClientContext } from "./native.ts";
import type { AccountController } from "./account-controller.ts";
import {
  EnterpriseController,
  type EnterpriseState,
  type EnterpriseTab,
} from "./enterprise-controller.ts";
import {
  enterpriseCopy,
  enterpriseLabels,
  format,
  type EnterpriseLabels,
} from "./enterprise-locale.ts";
import { language } from "./locale.ts";
import { EnterpriseSettings } from "./enterprise-settings.tsx";
import { createOwnedProject } from "./project-creation-actions.ts";
import {
  EnterpriseDirectoryFlow,
  ProjectCreationDialog,
  type ProjectCreationProps,
} from "./project-creation.tsx";
import {
  ProjectView,
  ProjectsTab,
  type CollaborationActions,
  type ViewProps,
} from "./collaboration.tsx";
import {
  JoinCodeDialog,
  MemberDialog,
  MembersTab,
  NoEnterprise,
} from "./enterprise-members.tsx";
import {
  DepartmentsTab,
  ModelsTab,
  SkillsTab,
} from "./enterprise-assets.tsx";
import {
  ConfirmDialog,
  EmptyState,
  Field,
  FormError,
  ListSkeleton,
  Notice,
  ToastHost,
  roleName,
  useRecord,
  useTask,
} from "./enterprise-ui.tsx";
import css from "./suite.module.css";
import { organizationTemplateSource } from './organization-templates.ts';

const PANEL = "ipollowork-enterprise";

export interface Props
  extends Pick<
    ProjectCreationProps,
    | "createProject"
    | "listDirectory"
    | "createDirectory"
    | "pickDirectory"
    | "refreshEnterprises"
  > {
  useEnterpriseState<T>(selector: (state: EnterpriseState) => T): T;
  useEnterpriseLabels<T>(selector: (labels: EnterpriseLabels) => T): T;
  useLocale<T>(selector: (value: string) => T): T;
  useDesignAvailable<T>(selector: (value: boolean) => T): T;
  controller: EnterpriseController;
  actions: CollaborationActions;
  openAccountSettings(): boolean;
  installEnterprisePlugin(spec: string): Promise<void>;
}

function EnterpriseSwitcher({
  catalog,
  enterpriseId,
  t,
  controller,
}: {
  catalog: EnterpriseCatalog;
  enterpriseId: string;
  t: EnterpriseLabels;
  controller: EnterpriseController;
}) {
  const [open, setOpen] = useState(false);
  const current = catalog.enterprises.find((e) => e.id === enterpriseId);
  return (
    <Menu
      open={open}
      portal
      onClose={() => setOpen(false)}
      selectedId={enterpriseId}
      anchor={
        <button
          type="button"
          className={css.switcher}
          aria-label={t.switchEnterprise}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={css.switcherMark} aria-hidden>
            {current?.logo ? <img src={current.logo} alt="" /> : current?.name.slice(0, 1)}
          </span>
          <span className={css.switcherText}>
            <strong>{current?.name}</strong>
            <small>
              {current &&
                `${roleName(current.role, t)} · ${format(t.memberCount, { count: current.memberCount })}`}
            </small>
          </span>
          <IconChevronDownOutlineRegular size={14} />
        </button>
      }
      items={[
        { type: "label", id: "label", text: t.switchEnterprise },
        ...catalog.enterprises.map((e) => ({ id: e.id, label: e.name })),
        { type: "separator", id: "separator" },
        { id: ":create", label: t.create },
      ]}
      onSelect={(id) => {
        setOpen(false);
        if (id === ":create") controller.open({ kind: "create" });
        else controller.selectEnterprise(id);
      }}
    />
  );
}

function EnterpriseFeedback({ useEnterpriseState, useEnterpriseLabels, useLocale, controller }: Props) {
  const userId = useEnterpriseState(state => state.catalog?.userId);
  const t = useEnterpriseLabels(value => value);
  const locale = useLocale(value => value);
  return <>
    {userId && <OrganizationNotices key={userId} controller={controller} t={t} language={locale}/>}
    <ToastHost useEnterpriseState={useEnterpriseState} dismiss={controller.dismissToast}/>
  </>;
}

function EnterprisePanel(props: Props) {
  const designAvailable = props.useDesignAvailable(value => value);
  const t = props.useEnterpriseLabels((v) => v),
    state = props.useEnterpriseState((v) => v),
    language = props.useLocale((v) => v);
  const { controller } = props;
  const joinService = <Button variant="outline" onClick={() => controller.open({ kind: "joinService" })}>
    {t.joinByService}
  </Button>;
  useEffect(() => {
    if (state.signedIn && !state.catalog) void controller.load();
  }, [state.signedIn]);
  if (!state.signedIn)
    return (
      <section
        className={css.page + " " + css.enterprisePage}
        data-ipw-enterprise
      >
        <div className={css.heading}>
          <div>
            <h1>{t.title}</h1>
            <p>{t.intro}</p>
          </div>
        </div>
        <EmptyState title={t.signIn} hint={t.signInRequired}>
          <Button variant="primary" onClick={() => props.openAccountSettings()}>
            {t.signInAction}
          </Button>
        </EmptyState>
      </section>
    );
  const catalog = state.catalog;
  if (!catalog)
    return (
      <section
        className={css.page + " " + css.enterprisePage}
        data-ipw-enterprise
      >
        <div className={css.heading}>
          <div>
            <h1>{t.title}</h1>
            <p>{t.intro}</p>
          </div>
          <div className={css.enterpriseActions}>
            <MemberNoticeHistory controller={controller} state={state} t={t} language={language}/>
            {joinService}
          </div>
        </div>
        {state.error ? (
          <Notice
            error={state.error}
            t={t}
            fallback={t.organizationListLoadFailed}
            retry={() => void controller.load()}
          />
        ) : (
          <ListSkeleton rows={4} />
        )}
      </section>
    );
  const view: ViewProps = {
    t,
    language,
    call: controller.call,
    controller,
    catalog,
    revision: state.revision,
    actions: props.actions,
  };
  const top = state.views.at(-1);
  const enterpriseId = state.enterpriseId;
  return (
    <section
      className={css.page + " " + css.enterprisePage}
      data-ipw-enterprise
    >
      {top ? (
        <div key={JSON.stringify(top)} className={css.enterpriseView}>
          {<ProjectView key={top.id} id={top.id} view={view} />}
        </div>
      ) : (
        <>
          <div className={css.heading}>
            <div>
              <h1>{t.title}</h1>
              <p>{t.intro}</p>
            </div>
            <div className={css.enterpriseActions}>
              <MemberNoticeHistory controller={controller} state={state} t={t} language={language}/>
              {enterpriseId && joinService}
              {enterpriseId && (
                <EnterpriseSwitcher
                  catalog={catalog}
                  enterpriseId={enterpriseId}
                  t={t}
                  controller={controller}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label={t.refresh}
                title={t.refresh}
                disabled={state.loading}
                icon={<IconRefreshOutlineRegular size={16} />}
                onClick={() => void controller.load()}
              />
            </div>
          </div>
          {!enterpriseId ? (
            <>
              <Notice error={state.error} t={t} fallback={t.organizationListLoadFailed} retry={controller.load} />
              <NoEnterprise t={t} controller={controller} />
            </>
          ) : (
            <EnterpriseBody
              key={enterpriseId}
              enterpriseId={enterpriseId}
              userId={catalog.userId}
              tab={state.tab}
              view={view}
              t={t}
              language={language}
              controller={controller}
              revision={state.revision}
              catalogError={state.error}
              refreshing={state.loading}
              publicationTarget={state.publicationTarget}
              installEnterprisePlugin={props.installEnterprisePlugin}
              designAvailable={designAvailable}
            />
          )}
        </>
      )}
    </section>
  );
}

/** Stats, tabs and the selected tab for one enterprise; the enterprise record is read once for every tab. */
function EnterpriseBody({
  enterpriseId,
  userId,
  tab,
  view,
  t,
  language,
  controller,
  revision,
  catalogError,
  refreshing,
  publicationTarget,
  installEnterprisePlugin,
  designAvailable,
}: {
  enterpriseId: string;
  userId: string;
  tab: EnterpriseTab;
  view: ViewProps;
  t: EnterpriseLabels;
  language: string;
  controller: EnterpriseController;
  revision: number;
  catalogError: string;
  refreshing: boolean;
  publicationTarget: string | undefined;
  installEnterprisePlugin(spec: string): Promise<void>;
  designAvailable: boolean;
}) {
  const detail = useRecord<EnterpriseDetail>(
    "/organizations/" + enterpriseId,
    controller.call,
    revision,
  );
  const detailError = !detail.data && !refreshing ? detail.error : "";
  const labels = (
    [
      ["departments", t.departmentsTab],
      ["members", t.membersTab],
      ["projects", t.projectsTab],
      ["templates", t.templatesTab],
      ["packages", t.packagesTab],
      ["plugins", t.pluginsTab],
      ["skills", t.skillsTab],
      ["mcp", t.mcpTab],
      ["models", t.modelsTab],
      ["messages", t.messagesTab],
      ["analytics", t.analyticsTab],
      ["activity", t.activityTab],
      ["settings", t.settingsTab],
    ] as const
  ).map(([value, label]) => ({
    value,
    label,
    id: "ipw-enterprise-tab-" + value,
    panelId: "ipw-enterprise-panel-" + value,
  }));
  const tabs = labels.filter(item => (item.value !== "activity" && item.value !== "analytics") || detail.data?.canManage);
  const active = tabs.find((item) => item.value === tab) ?? tabs[0]!;
  const assetProps = detail.data
    ? {
        enterpriseId,
        detail: detail.data,
        t,
        call: controller.call,
        controller,
        revision,
        language,
      }
    : null;
  return (
    <>
      <Notice
        error={detailError || catalogError}
        t={t}
        fallback={detailError ? t.organizationDetailsLoadFailed : t.organizationListLoadFailed}
        retry={catalogError ? controller.load : detail.reload}
      />
      <nav className={css.lineTabs} role="tablist" aria-label={t.title}>
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={item.id}
            aria-controls={item.panelId}
            aria-selected={item.value === active.value}
            onClick={() => controller.selectTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div
        id={active.panelId}
        role="tabpanel"
        aria-labelledby={active.id}
        className={css.enterpriseView}
      >
        {active.value === "projects" ? (
          <ProjectsTab enterpriseId={enterpriseId} view={view} />
        ) : active.value === "members" ? (
          <MembersTab
            enterpriseId={enterpriseId}
            userId={userId}
            language={language}
            revision={revision}
            t={t}
            call={controller.call}
            controller={controller}
          />
        ) : !assetProps ? (
          detailError ? null : <ListSkeleton />
        ) : active.value === "departments" ? (
          <DepartmentsTab {...assetProps} />
        ) : active.value === "templates" || active.value === "plugins" ? (
          <OrganizationPublications key={active.value} {...assetProps} target={publicationTarget}
            designAvailable={designAvailable} kind={active.value === "templates" ? "template" : "plugin"} install={installEnterprisePlugin} />
        ) : active.value === "packages" ? (
          <OrganizationFilePackages {...assetProps} />
        ) : active.value === "analytics" ? (
          <AnalyticsTab {...assetProps} canManage={assetProps.detail.canManage} />
        ) : active.value === "activity" ? (
          <OrganizationActivityTab {...assetProps} />
        ) : active.value === "messages" ? (
          <OrganizationMessages key={enterpriseId} {...assetProps} target={publicationTarget} openSession={view.actions.openSession} />
        ) : active.value === "skills" ? (
          <>
            <OrganizationPublications {...assetProps} target={publicationTarget} kind="skill" install={installEnterprisePlugin} />
            <SkillsTab {...assetProps} />
          </>
        ) : active.value === "mcp" ? (
          <>
            <OrganizationPublications {...assetProps} target={publicationTarget} kind="mcp" install={installEnterprisePlugin} />
            <McpTab {...assetProps} />
          </>
        ) : active.value === "settings" ? (
          <EnterpriseSettings key={enterpriseId} {...assetProps} serviceAddress={view.catalog.serviceOrigin} />
        ) : (
          <ModelsTab {...assetProps} />
        )}
      </div>
    </>
  );
}

function SimpleDialog({
  kind,
  t,
  controller,
  serviceOrigin,
}: {
  kind: "create" | "joinService";
  t: EnterpriseLabels;
  controller: EnterpriseController;
  serviceOrigin: string | undefined;
}) {
  const task = useTask(t),
    [input, setInput] = useState(""),
    [serviceAddress, setServiceAddress] = useState(serviceOrigin ?? "");
  const close = () => {
    if (!task.busy) controller.open(null);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void task.run(async () => {
      if (kind === "create") {
        const result = await controller.call<{ id: string }>("/organizations", {
          name: input,
        });
        controller.selectEnterprise(result.id);
        controller.selectTab("members");
        controller.notify(t.enterpriseCreated);
      } else {
        const result = await controller.call<{
          enterpriseId?: string;
          enterprise_id?: string;
        }>("/join", { invitation: input, ...(kind === "joinService" ? { serviceAddress: serviceAddress.trim() } : {}) });
        const joined = result.enterpriseId ?? result.enterprise_id;
        if (joined) controller.selectEnterprise(joined);
        controller.selectTab("projects");
        controller.notify(t.joined);
      }
      controller.open(null);
      await controller.load();
    });
  };
  return (
    <Modal
      open
      title={kind === "create" ? t.create : t.joinByService}
      {...(kind === "create" ? {description:t.emptyHint} : {})}
      closeLabel={t.close}
      className={css.enterpriseModal!}
      onClose={close}
    >
      <form className={css.enterpriseForm} onSubmit={submit}>
        {kind === "joinService" && <Field label={t.serviceAddress}><input type="url" required maxLength={2048}
          value={serviceAddress} onChange={event => setServiceAddress(event.target.value)} disabled={task.busy} /></Field>}
        <Field label={kind === "create" ? t.name : t.invitationCode}>
          <input
            autoFocus
            required
            maxLength={kind === "create" ? 120 : 2048}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={task.busy}
          />
        </Field>
        <FormError message={task.error} />
        <div className={css.dialogFooter}>
          <Button
            variant="outline"
            type="button"
            disabled={task.busy}
            onClick={close}
          >
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={task.busy || !input.trim()}
          >
            {kind === "create" ? t.create : t.joinAction}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AssignDialog({
  projectId,
  t,
  controller,
  catalog,
}: {
  projectId: string;
  t: EnterpriseLabels;
  controller: EnterpriseController;
  catalog: EnterpriseCatalog;
}) {
  const project = catalog.projects.find((p) => p.id === projectId);
  const task = useTask(t),
    [selected, setSelected] = useState(project?.enterpriseId ?? "");
  const close = () => {
    if (!task.busy) controller.open(null);
  };
  if (!project) return null;
  return (
    <Modal
      open
      title={t.ownership}
      description={project.path}
      closeLabel={t.close}
      className={css.enterpriseModal!}
      onClose={close}
    >
      <form
        className={css.enterpriseForm}
        onSubmit={(e) => {
          e.preventDefault();
          void task.run(async () => {
            await controller.call("/assign", {
              projectId: project.id,
              enterpriseId: selected || null,
            });
            controller.notify(t.ownershipSaved);
            controller.open(null);
            window.dispatchEvent(new Event(projectBoardOwnershipEvent));
            await controller.load();
          });
        }}
      >
        <Field label={t.choose} hint={t.ownershipHint}>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={task.busy}
          >
            <option value="">{t.personal}</option>
            {catalog.enterprises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <FormError message={task.error} />
        <div className={css.dialogFooter}>
          <Button
            variant="outline"
            type="button"
            disabled={task.busy}
            onClick={close}
          >
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={task.busy || selected === (project.enterpriseId ?? "")}
          >
            {t.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Member dialogs read the enterprise record they edit, so they work from any page state. */
function WithDetail({
  enterpriseId,
  t,
  controller,
  children,
}: {
  enterpriseId: string;
  t: EnterpriseLabels;
  controller: EnterpriseController;
  children(detail: EnterpriseDetail): JSX.Element | null;
}) {
  const detail = useRecord<EnterpriseDetail>(
    "/organizations/" + enterpriseId,
    controller.call,
    0,
  );
  if (detail.data) return children(detail.data);
  return detail.error ? (
    <Modal
      open
      title={t.manage}
      closeLabel={t.close}
      className={css.enterpriseModal!}
      onClose={() => controller.open(null)}
    >
      <Notice error={detail.error} t={t} retry={detail.reload} />
    </Modal>
  ) : null;
}

function DialogHost(props: Props) {
  const state = props.useEnterpriseState((v) => v),
    t = props.useEnterpriseLabels((v) => v);
  const { controller } = props,
    dialog = state.dialog,
    close = () => controller.open(null);
  const language = props.useLocale(value => value);
  if (!dialog || !state.signedIn) return null;
  switch (dialog.kind) {
    case "create":
    case "joinService":
      return (
        <SimpleDialog
          key={dialog.kind}
          kind={dialog.kind}
          t={t}
          controller={controller}
          serviceOrigin={state.catalog?.serviceOrigin}
        />
      );
    case "createProject":
      return (
        <ProjectCreationDialog
          {...props}
          organizationId={dialog.enterpriseId}
          open
          onCancel={close}
          onCreated={(project) => {
            close();
            props.actions.openProject(project.workspaceId);
          }}
        />
      );
    case "confirm":
      return (
        <ConfirmDialog
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          t={t}
          run={dialog.run}
          close={close}
        />
      );
    case "joinCode":
      return (
        <WithDetail
          enterpriseId={dialog.enterpriseId}
          t={t}
          controller={controller}
        >
          {(detail) => (
            <JoinCodeDialog
              dialog={dialog}
              t={t}
              call={controller.call}
              controller={controller}
              departments={detail.departments}
            />
          )}
        </WithDetail>
      );
    case "memberNotices":
      return <MemberNoticeDialog controller={controller} state={state} t={t} language={language} noticeId={dialog.noticeId} close={close}/>;
    case "member":
      return (
        <WithDetail
          enterpriseId={dialog.enterpriseId}
          t={t}
          controller={controller}
        >
          {(detail) => (
            <MemberDialog key={dialog.userId}
              enterpriseId={dialog.enterpriseId}
              userId={dialog.userId}
              t={t}
              call={controller.call}
              controller={controller}
              detail={detail}
            />
          )}
        </WithDetail>
      );
  }
  const catalog = state.catalog;
  if (!catalog) return null;
  if (dialog.kind === "assign")
    return (
      <AssignDialog
        key={dialog.projectId}
        projectId={dialog.projectId}
        t={t}
        controller={controller}
        catalog={catalog}
      />
    );
  return null;
}

/** Sidebar row mark for native conversations that continue team work. */
function CollaborationMark({
  sessionId,
  useEnterpriseState,
  useEnterpriseLabels,
}: { sessionId: string } & Pick<
  Props,
  "useEnterpriseState" | "useEnterpriseLabels"
>) {
  const linked = useEnterpriseState(
      (s) => !!s.catalog?.work.some((w) => w.nativeSessionId === sessionId),
    ),
    t = useEnterpriseLabels((v) => v);
  return linked ? (
    <span
      className={css.rowMark}
      role="img"
      aria-label={t.collaborationSession}
      title={t.collaborationSession}
    >
      <IconUsersOutlineRegular size={13} />
    </span>
  ) : null;
}

/** Register a reversible enterprise page plus actions on the existing project and conversation menus. */
export function mountEnterprise(
  ctx: ClientContext,
  account: AccountController,
  installEnterprisePlugin: (spec: string) => Promise<void>,
): void {
  const controller = new EnterpriseController(),
    labels = enterpriseLabels(ctx);
  let designEnabled = false;
  const designListeners = new Set<() => void>();
  const designAvailable = { getSnapshot: () => designEnabled, subscribe(listener: () => void) {
    designListeners.add(listener); return () => { designListeners.delete(listener); };
  } };
  const setDesign = (value: boolean) => { designEnabled = value; for (const listener of designListeners) listener(); };
  ctx.inject(['ipolloDesignTemplates'], scope => {
    scope.effect(() => {
      let lifetime = new AbortController();
      let off = scope.ipolloDesignTemplates.register(organizationTemplateSource(lifetime.signal, enterpriseCopy(ctx).templatesTab));
      const changed = scope.remote.$on('credentials/record-updated', () => {
        lifetime.abort(); off(); lifetime = new AbortController();
        off = scope.ipolloDesignTemplates.register(organizationTemplateSource(lifetime.signal, enterpriseCopy(ctx).templatesTab));
      });
      setDesign(true);
      return () => { changed(); lifetime.abort(); off(); setDesign(false); };
    }, 'ipollowork: organization Design templates');
  });
  const locale = {
    getSnapshot: () => language(ctx),
    subscribe: (listener: () => void) => ctx.locale.subscribe(listener),
  };
  ctx.effect(() => () => controller.dispose(), "ipollowork-suite: enterprise");
  ctx.effect(() => {
    window.addEventListener("focus", controller.refreshIfStale);
    return () => window.removeEventListener("focus", controller.refreshIfStale);
  }, "ipollowork-suite: refresh collaboration");
  ctx.inject(["ipolloNotificationCenter", "layout"], scope => scope.effect(() =>
    scope.ipolloNotificationCenter.registerSource("ipollo.organization", {
      label: () => enterpriseCopy(ctx).memberNotices,
      getSnapshot: () => {
        const t = enterpriseCopy(ctx);
        const zh = language(ctx) === "zh";
        return controller.getSnapshot().memberNotices?.items.map(row => ({
          id: row.id, title: row.name, summary: noticeMessage(row, t, zh),
          createdAt: row.createdAt, read: row.readAt !== null,
        })) ?? [];
      },
      subscribe(listener) {
        let feed = controller.getSnapshot().memberNotices;
        const stop = controller.subscribe(() => {
          const next = controller.getSnapshot().memberNotices;
          if (next !== feed) { feed = next; listener(); }
        });
        const stopLocale = ctx.locale.subscribe(listener);
        return () => { stop(); stopLocale(); };
      },
      async markRead(id) { await controller.readNotices({ ids: [id] }); },
      async open(id) {
        const row = controller.getSnapshot().memberNotices?.items.find(item => item.id === id);
        if (!row) throw new Error("IPW_NOT_FOUND");
        await controller.openOrganizationNotice(row, () => scope.layout.selectPanel(PANEL));
      },
    }), "iPolloWork organization notifications"));
  const pendingOwnership = new Set<string>();
  const actions: CollaborationActions = {
    openSession: async (id) => {
      await ctx.sessions.refresh();
      ctx.uiWorkspace.openSession(id);
    },
    openProject: (id) => {
      void ctx.uiWorkspace.openWorkspace(id);
    },
  };
  const creation = {
    refreshEnterprises: controller.load,
    listDirectory: (path?: string, signal?: AbortSignal) =>
      ctx.uiWorkspace.listDirectory(path, signal),
    createDirectory: (path: string, name: string) =>
      ctx.uiWorkspace.createDirectory(path, name),
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    createProject: async (
      path: string,
      enterpriseId: string | null,
      access?: { mode: "enterprise" | "selected"; grants: ProjectGrant[] },
    ) => {
      const project = await createOwnedProject(path, enterpriseId, {
        create: (path) => ctx.workspaces.create({ path }),
        assign: async (projectId, enterpriseId) => {
          const existing = controller
            .getSnapshot()
            .catalog?.projects.find((project) => project.id === projectId);
          if (
            enterpriseId ||
            existing?.enterpriseId ||
            pendingOwnership.has(projectId)
          ) {
            pendingOwnership.add(projectId);
            await controller.call("/assign", { projectId, enterpriseId, ...(access ? { access } : {}) });
            pendingOwnership.delete(projectId);
          }
        },
      });
      await controller.load();
      return project;
    },
  };
  const creationProps = () => ({
    hooks: { enterpriseState: controller, enterpriseLabels: labels },
    ...creation,
  });
  const props = () => ({
    ...creationProps(),
    hooks: { enterpriseState: controller, enterpriseLabels: labels, locale, designAvailable },
    controller,
    actions,
    openAccountSettings: account.openAccountSettings,
    installEnterprisePlugin,
  });
  for (const name of [
    "sidebar.workspaces.directoryFlow",
    "conversation.hero.workspace.directoryFlow",
  ]) {
    ctx.slots.inject(name, () =>
      ctx.slots.register(
        { name, priority: -100, inject: creationProps },
        EnterpriseDirectoryFlow,
      ),
    );
  }
  ctx.slots.inject("main", () =>
    ctx.slots.register<Props>(
      { name: "main", key: PANEL, inject: props },
      EnterprisePanel,
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register<Props>(
      {
        name: "shell.overlay",
        id: "ipollowork-enterprise-dialog",
        inject: props,
      },
      DialogHost,
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register<Props>(
      { name: "shell.overlay", id: "ipollowork-enterprise-toast", inject: props },
      EnterpriseFeedback,
    ),
  );
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL,
        order: 9,
        label: () => enterpriseCopy(ctx).title,
      },
      IconWorkspaceTreeOutlineRegular,
    ),
  );
  ctx.slots.inject("sidebar.session.row.trailing", () =>
    ctx.slots.register(
      {
        name: "sidebar.session.row.trailing",
        id: "ipollowork-enterprise.row",
        order: 30,
        inject: () => ({
          hooks: { enterpriseState: controller, enterpriseLabels: labels },
        }),
      },
      CollaborationMark,
    ),
  );
  ctx.slots.inject("conversation.session.header.utilities", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "liveshare-share",
        priority: -100,
        order: -7,
        inject: props,
      },
      ConversationShareAction,
    ),
  );
  let userId: string | undefined;
  ctx.effect(() => {
    const openBoardPeople = (event: Event) => {
      const action = (event as CustomEvent<ProjectBoardPeopleAction>).detail;
      if (!action || (action.kind !== "ownership" && action.kind !== "invite")) return;
      if (!controller.getSnapshot().signedIn) { account.openAccountSettings(); return; }
      const accountId = userId;
      void (async () => {
        if (action.kind === "ownership") {
          await controller.load();
          if (accountId === userId && controller.getSnapshot().catalog?.projects.some(project => project.id === action.workspaceId))
            controller.open({ kind: "assign", projectId: action.workspaceId });
          return;
        }
        const [detail, space] = await Promise.all([
          controller.call<EnterpriseDetail>("/organizations/" + encodeURIComponent(action.enterpriseId)),
          controller.call<ProjectSpace>("/projects/" + encodeURIComponent(action.projectId) + "/space"),
        ]);
        if (accountId !== userId || !detail.canManage || space.project.enterpriseId !== action.enterpriseId) return;
        controller.open({ kind: "joinCode", enterpriseId: action.enterpriseId, projectId: action.projectId, projectRole: "participate" });
      })().catch(() => controller.notify(enterpriseCopy(ctx).operationFailed));
    };
    window.addEventListener(projectBoardPeopleEvent, openBoardPeople);
    return () => window.removeEventListener(projectBoardPeopleEvent, openBoardPeople);
  }, "ipollowork-suite: project board people");
  const syncAccount = () => {
    const current = account.getSnapshot().account;
    const next = current?.status === "signed-in" ? current.user.id : undefined;
    if (next === userId) return;
    userId = next;
    controller.accountChanged(!!next);
  };
  syncAccount();
  ctx.effect(
    () => account.subscribe(syncAccount),
    "ipollowork-suite: enterprise account",
  );
  ctx.slots.inject("contextMenu.icon", function* () {
    yield ctx.slots.register(
      { name: "contextMenu.icon", key: "ipollowork.enterprise.ownership" },
      IconWorkspaceTreeOutlineRegular,
    );
  });
  ctx.effect(
    () =>
      ctx.contextMenus.register({
        id: "ipollo.enterprise.project",
        target: "workspace",
        order: 350,
        resolve: (value) => {
          if (!controller.getSnapshot().signedIn || !value.workspaceId)
            return [];
          return [
            {
              id: "enterprise-ownership",
              label: enterpriseCopy(ctx).ownership,
              icon: { key: "ipollowork.enterprise.ownership" },
              run: async () => {
                await controller.load();
                controller.open({
                  kind: "assign",
                  projectId: value.workspaceId!,
                });
              },
            },
          ];
        },
      }),
    "ipollowork-suite: project ownership action",
  );
}
