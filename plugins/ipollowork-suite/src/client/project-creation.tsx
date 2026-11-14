import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  isAbsoluteProjectPath,
  projectCreationError,
  type CreatedProject,
} from "./project-creation-actions.ts";
import type { EnterpriseState } from "./enterprise-controller.ts";
import { enterpriseError, type EnterpriseLabels } from "./enterprise-locale.ts";
import type { EnterpriseDetail, ProjectGrant } from "../shared/enterprise.ts";
import { useRecord } from "./enterprise-ui.tsx";
import { request } from "./api.ts";
import { projectCopy } from "./project-copy.ts";
import css from "./suite.module.css";

const callEnterprise = <T,>(path: string) => request<T>("/enterprise" + path);

export interface DirectoryLevel {
  path: string;
  home: string;
  entries: { name: string; path: string; hidden: boolean }[];
  crumbs: { name: string; path: string }[];
  truncated: boolean;
}
export interface ProjectCreationProps {
  open: boolean;
  organizationId?: string;
  busy?: boolean;
  useEnterpriseState<T>(selector: (state: EnterpriseState) => T): T;
  useEnterpriseLabels<T>(selector: (labels: EnterpriseLabels) => T): T;
  refreshEnterprises(): Promise<void>;
  createProject(
    path: string,
    enterpriseId: string | null,
    access?: { mode: "enterprise" | "selected"; grants: ProjectGrant[] },
  ): Promise<CreatedProject>;
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryLevel>;
  createDirectory(path: string, name: string): Promise<string>;
  pickDirectory(): Promise<string | null>;
  onCreated(project: CreatedProject): void;
  onCancel(): void;
}

/** One form owns both the local directory and personal/enterprise selection. */
export function ProjectCreationDialog(props: ProjectCreationProps) {
  const t = props.useEnterpriseLabels((v) => v),
    state = props.useEnterpriseState((v) => v);
  const c = projectCopy(
    t.title === "组织空间" || t.title === "企业空间" ? "zh" : "en",
  );
  const [shareWith, setShareWith] = useState(""),
    [shareRole, setShareRole] = useState<"view" | "participate">("participate");
  const [path, setPath] = useState(""),
    [enterpriseId, setEnterpriseId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const directory = useRecord<EnterpriseDetail>(
    enterpriseId ? "/organizations/" + enterpriseId : null,
    callEnterprise,
    0,
  );
  const [browsing, setBrowsing] = useState(false),
    [level, setLevel] = useState<DirectoryLevel | null>(null),
    [draft, setDraft] = useState(""),
    [folder, setFolder] = useState(""),
    [showHidden, setShowHidden] = useState(false);
  const readAbort = useRef<AbortController | null>(null),
    alive = useRef(false);
  const pathHelpId = useId(),
    invalidPath = path.trim() !== "" && !isAbsoluteProjectPath(path);
  useEffect(() => {
    alive.current = props.open;
    if (props.open) {
      void props.refreshEnterprises();
      setPath("");
      setEnterpriseId(props.organizationId ?? "");
      setError("");
      setBusy(false);
      setBrowsing(false);
      setLevel(null);
      setDraft("");
      setFolder("");
    }
    return () => {
      alive.current = false;
      readAbort.current?.abort();
    };
  }, [props.open, props.refreshEnterprises, props.organizationId]);
  const targetOrganization = props.organizationId ?? enterpriseId;
  const disabled = busy || !!props.busy;
  const browse = async (target?: string) => {
    readAbort.current?.abort();
    const abort = new AbortController();
    readAbort.current = abort;
    setBusy(true);
    setError("");
    try {
      const result = await props.listDirectory(target, abort.signal);
      if (alive.current && !abort.signal.aborted) {
        setLevel(result);
        setDraft(result.path);
        setBrowsing(true);
      }
    } catch (e) {
      if (!abort.signal.aborted && alive.current)
        setError(projectCreationError(e, t));
    } finally {
      if (alive.current && !abort.signal.aborted) setBusy(false);
    }
  };
  const choose = async () => {
    readAbort.current?.abort();
    const abort = new AbortController();
    readAbort.current = abort;
    setBusy(true);
    setError("");
    try {
      const result = await props.listDirectory(undefined, abort.signal);
      if (alive.current && !abort.signal.aborted) {
        setLevel(result);
        setDraft(result.path);
        setBrowsing(true);
      }
    } catch {
      if (abort.signal.aborted || !alive.current) return;
      try {
        const result = await props.pickDirectory();
        if (alive.current && result) setPath(result);
      } catch (e) {
        if (alive.current) setError(projectCreationError(e, t));
      }
    } finally {
      if (alive.current && !abort.signal.aborted) setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !path.trim() || invalidPath) return;
    setBusy(true);
    setError("");
    void props
      .createProject(
        path.trim(),
        targetOrganization || null,
        targetOrganization
          ? {
              mode: shareWith === "all" ? "enterprise" : "selected",
              grants:
                shareWith && shareWith !== "all"
                  ? [
                      {
                        kind: shareWith.startsWith("d:")
                          ? "department"
                          : "member",
                        subjectId: shareWith.slice(2),
                        role: shareRole,
                      },
                    ]
                  : [],
            }
          : undefined,
      )
      .then(
        (project) => {
          if (alive.current) props.onCreated(project);
        },
        (e) => {
          if (alive.current) setError(projectCreationError(e, t));
        },
      )
      .finally(() => {
        if (alive.current) setBusy(false);
      });
  };
  if (!props.open) return null;
  return (
    <Modal
      open
      title={t.createProject}
      closeLabel={t.close}
      className={
        css.page + " " + css.enterpriseModal + " " + css.enterpriseWide
      }
      contentClassName={css.enterpriseModalContent!}
      onClose={() => {
        if (!disabled) props.onCancel();
      }}
    >
      <form className={css.enterpriseForm} onSubmit={submit}>
        <label className={css.enterpriseField}>
          <span>{t.projectDirectory}</span>
          <div className={css.enterprisePath}>
            <input
              autoFocus
              required
              value={path}
              aria-invalid={invalidPath}
              aria-describedby={pathHelpId}
              placeholder={t.directoryPlaceholder}
              disabled={disabled}
              onChange={(e) => {
                setPath(e.target.value);
                setError("");
              }}
            />
            <button
              type="button"
              className={css.secondary}
              disabled={disabled}
              onClick={() => void choose()}
            >
              {t.chooseFolder}
            </button>
          </div>
        </label>
        <p id={pathHelpId} className={invalidPath ? css.error : css.muted}>
          {invalidPath ? t.folderPathRequired : t.folderHelp}
        </p>
        {browsing && (
          <section
            className={css.enterpriseBrowser}
            aria-label={t.chooseFolder}
          >
            <div className={css.enterprisePath}>
              <input
                aria-label={t.directoryPath}
                value={draft}
                disabled={disabled}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void browse(draft);
                  }
                }}
              />
              <button
                type="button"
                className={css.secondary}
                disabled={disabled}
                onClick={() => void browse(draft)}
              >
                {t.go}
              </button>
            </div>
            <div className={css.enterpriseActions}>
              <button
                type="button"
                className={css.secondary}
                disabled={disabled || !level}
                onClick={() => void browse(level?.home)}
              >
                {t.home}
              </button>
              <button
                type="button"
                className={css.secondary}
                disabled={disabled || !level || level.crumbs.length < 2}
                onClick={() => void browse(level?.crumbs.at(-2)?.path)}
              >
                {t.parentFolder}
              </button>
              <label className={css.enterpriseHidden}>
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
                {t.showHidden}
              </label>
            </div>
            <div className={css.enterpriseFolders} aria-busy={disabled}>
              {level?.entries
                .filter((entry) => showHidden || !entry.hidden)
                .map((entry) => (
                  <button
                    type="button"
                    key={entry.path}
                    disabled={disabled}
                    onClick={() => void browse(entry.path)}
                  >
                    {entry.name}
                  </button>
                ))}
            </div>
            {level?.truncated && (
              <p className={css.muted}>{t.directoryTruncated}</p>
            )}
            <div className={css.enterprisePath}>
              <input
                aria-label={t.newFolder}
                placeholder={t.newFolder}
                value={folder}
                disabled={disabled}
                onChange={(e) => setFolder(e.target.value)}
              />
              <button
                type="button"
                className={css.secondary}
                disabled={disabled || !folder.trim() || !level}
                onClick={async () => {
                  if (!level) return;
                  setBusy(true);
                  setError("");
                  try {
                    const created = await props.createDirectory(
                      level.path,
                      folder.trim(),
                    );
                    setFolder("");
                    await browse(created);
                  } catch (e) {
                    setError(projectCreationError(e, t));
                    setBusy(false);
                  }
                }}
              >
                {t.newFolder}
              </button>
            </div>
            <button
              type="button"
              className={css.secondary}
              disabled={disabled || !level}
              onClick={() => {
                if (level) {
                  setPath(level.path);
                  setBrowsing(false);
                }
              }}
            >
              {t.useFolder}
            </button>
          </section>
        )}
        <label className={css.enterpriseField}>
          <span>{t.choose}</span>
          {props.organizationId ? (
            <strong>
              {
                state.catalog?.enterprises.find(
                  (e) => e.id === props.organizationId,
                )?.name
              }
            </strong>
          ) : (
            <select
              value={enterpriseId}
              disabled={disabled || !state.signedIn || state.loading}
              onChange={(e) => {
                setEnterpriseId(e.target.value);
                setShareWith("");
              }}
            >
              <option value="">{t.personal}</option>
              {state.catalog?.enterprises.map((enterprise) => (
                <option key={enterprise.id} value={enterprise.id}>
                  {enterprise.name}
                </option>
              ))}
            </select>
          )}
        </label>
        {enterpriseId && (
          <div className={css.enterpriseColumns}>
            <label className={css.enterpriseField}>
              <span>{t.visibility}</span>
              <select
                value={shareWith}
                disabled={disabled || !directory.data}
                onChange={(e) => setShareWith(e.target.value)}
              >
                <option value="">{c.selected}</option>
                <option value="all">{c.everyone}</option>
                {directory.data?.departments.map((d) => (
                  <option key={d.id} value={"d:" + d.id}>
                    {d.name}
                  </option>
                ))}
                {directory.data?.members.map((m) => (
                  <option key={m.userId} value={"m:" + m.userId}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </label>
            {shareWith && shareWith !== "all" && (
              <label className={css.enterpriseField}>
                <span>{t.permission}</span>
                <select
                  value={shareRole}
                  onChange={(e) =>
                    setShareRole(e.target.value as "view" | "participate")
                  }
                >
                  <option value="view">{c.view}</option>
                  <option value="participate">{c.participate}</option>
                </select>
              </label>
            )}
          </div>
        )}
        {state.loading && (
          <p className={css.muted} role="status">
            {t.loading}
          </p>
        )}
        {state.error && (
          <div className={css.enterpriseActions}>
            <p className={css.error} role="alert">
              {enterpriseError(state.error, t)}
            </p>
            <button
              type="button"
              className={css.secondary}
              disabled={state.loading}
              onClick={() => void props.refreshEnterprises()}
            >
              {t.refresh}
            </button>
          </div>
        )}
        {!state.signedIn && <p className={css.muted}>{t.signIn}</p>}
        <p className={css.muted}>{t.createProjectHint}</p>
        {error && (
          <p className={css.error} role="alert">
            {error}
          </p>
        )}
        <div className={css.enterpriseActions}>
          <button
            type="button"
            className={css.secondary}
            disabled={disabled}
            onClick={props.onCancel}
          >
            {t.cancel}
          </button>
          <button
            className={css.primary}
            disabled={disabled || !path.trim() || invalidPath}
          >
            {disabled ? t.loading : t.createProject}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Adapt the existing directory-flow slot so its owner still performs final navigation. */
export function EnterpriseDirectoryFlow(
  props: Omit<ProjectCreationProps, "onCreated"> & {
    onPicked(path: string): void;
  },
) {
  return (
    <ProjectCreationDialog
      {...props}
      onCreated={(project) => props.onPicked(project.path)}
    />
  );
}
