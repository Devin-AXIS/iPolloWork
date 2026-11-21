import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FormButton, FormSelect, TextInput } from "../../../_shared/ui/controls.tsx";
import { Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  isAbsoluteProjectPath,
  projectCreationError,
  type CreatedProject,
} from "./project-creation-actions.ts";
import type { EnterpriseState } from "./enterprise-controller.ts";
import { enterpriseError, type EnterpriseLabels } from "./enterprise-locale.ts";
import type { ProjectGrant } from "../shared/enterprise.ts";
import { DirectoryStatus, useMemberDirectory, type Call } from "./enterprise-ui.tsx";
import { request } from "./api.ts";
import { projectCopy } from "./project-copy.ts";
import css from "./suite.module.css";

const callEnterprise: Call = (path, data) => request("/enterprise" + path, {
  method: "POST", body: JSON.stringify(data),
});

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
    t.personal === "个人" ? "zh" : "en",
  );
  const [cloudEnabled,setCloudEnabled]=useState(false);
  const [mode,setMode]=useState<'local'|'cloud'>('local');
  const [cloudName,setCloudName]=useState('');
  const creationKey=useRef('');
  useEffect(()=>{
    if(!props.open)return;
    const abort=new AbortController();
    const refresh=()=>void request<{enabled:boolean}>('/cloud/availability',{signal:abort.signal}).then(value=>{
      if(!abort.signal.aborted){setCloudEnabled(value.enabled);if(!value.enabled)setMode('local');}
    },()=>{if(!abort.signal.aborted){setCloudEnabled(false);setMode('local');}});
    refresh();
    window.addEventListener('focus',refresh);
    const timer=window.setInterval(refresh,5000);
    return ()=>{abort.abort();window.removeEventListener('focus',refresh);window.clearInterval(timer);};
  },[props.open]);
  const [shareWith, setShareWith] = useState(""),
    [shareRole, setShareRole] = useState<"view" | "participate">("participate");
  const [path, setPath] = useState(""),
    [enterpriseId, setEnterpriseId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [shareName, setShareName] = useState("");
  const directory = useMemberDirectory(props.open ? enterpriseId || null : null, callEnterprise, state.revision, {
    query: memberQuery, active: true,
  });
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
      setShareWith(""); setShareName(""); setMemberQuery("");
      setMode("local");setCloudName("");creationKey.current=crypto.randomUUID();
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
    if(disabled)return;
    if(mode==='cloud') {
      if(!cloudEnabled||!cloudName.trim()||!state.signedIn)return;
      setBusy(true);setError('');
      void request<{url:string}>('/cloud/projects',{method:'POST',body:JSON.stringify({title:cloudName.trim(),enterpriseId:targetOrganization||null,creationKey:creationKey.current,
        ...(targetOrganization?{access:{mode:'selected',grants:shareWith?[{kind:'member',subjectId:shareWith.slice(2),role:shareRole}]:[]}}:{})})}).then(result=>{
        if(!alive.current)return;
        const target=new URL(result.url);if(target.protocol!=='https:')throw new Error('IPW_INVALID_RESPONSE');
        window.location.assign(target.href);
      }).catch(error=>{if(alive.current)setError(projectCreationError(error,t));}).finally(()=>{if(alive.current)setBusy(false);});
      return;
    }
    if(!path.trim()||invalidPath)return;
    setBusy(true);
    setError("");
    void props
      .createProject(
        path.trim(),
        targetOrganization || null,
        targetOrganization
          ? {
              mode: "selected",
              grants:
                shareWith
                  ? [
                      {
                        kind: "member",
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
        css.page + " " + css.enterpriseModal + " " + css.enterpriseWide + " ipw-frosted"
      }
      contentClassName={css.enterpriseModalContent!}
      onClose={() => {
        if (!disabled) props.onCancel();
      }}
    >
      <form className={css.projectCreationForm} onSubmit={submit}>
        {cloudEnabled && <label className={css.enterpriseField}><span>{c.location}</span><FormSelect value={mode} disabled={disabled} onChange={event=>setMode(event.target.value==='cloud'?'cloud':'local')}><option value="local">{c.localMode}</option><option value="cloud">{c.cloud}</option></FormSelect></label>}
        {mode==='cloud' ? <label className={css.enterpriseField}><span>{c.name}</span><TextInput required value={cloudName} maxLength={120} disabled={disabled} onChange={event=>setCloudName(event.target.value)}/></label> : <>

        <label className={css.enterpriseField}>
          <span>{t.projectDirectory}</span>
          <div className={css.enterprisePath}>
            <TextInput
              autoFocus
              required
              value={path}
              aria-label={t.projectDirectory}
              aria-invalid={invalidPath}
              aria-describedby={pathHelpId}
              placeholder={t.directoryPlaceholder}
              disabled={disabled}
              onChange={(e) => {
                setPath(e.target.value);
                setError("");
              }}
            />
            <FormButton
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => void choose()}
            >
              {t.chooseFolder}
            </FormButton>
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
              <TextInput
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
              <FormButton
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => void browse(draft)}
              >
                {t.go}
              </FormButton>
            </div>
            <div className={css.enterpriseActions}>
              <FormButton
                type="button"
                variant="outline"
                disabled={disabled || !level}
                onClick={() => void browse(level?.home)}
              >
                {t.home}
              </FormButton>
              <FormButton
                type="button"
                variant="outline"
                disabled={disabled || !level || level.crumbs.length < 2}
                onClick={() => void browse(level?.crumbs.at(-2)?.path)}
              >
                {t.parentFolder}
              </FormButton>
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
              <TextInput
                aria-label={t.newFolder}
                placeholder={t.newFolder}
                value={folder}
                disabled={disabled}
                onChange={(e) => setFolder(e.target.value)}
              />
              <FormButton
                type="button"
                variant="outline"
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
              </FormButton>
            </div>
            <FormButton
              type="button"
              variant="outline"
              disabled={disabled || !level}
              onClick={() => {
                if (level) {
                  setPath(level.path);
                  setBrowsing(false);
                }
              }}
            >
              {t.useFolder}
            </FormButton>
          </section>
        )}
        </>}
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
            <FormSelect
              value={enterpriseId}
              disabled={disabled || !state.signedIn || state.loading}
              onChange={(e) => {
                setEnterpriseId(e.target.value);
                setShareWith(""); setShareName(""); setMemberQuery("");
              }}
            >
              <option value="">{t.personal}</option>
              {state.catalog?.enterprises.map((enterprise) => (
                <option key={enterprise.id} value={enterprise.id}>
                  {enterprise.name}
                </option>
              ))}
            </FormSelect>
          )}
        </label>
        {enterpriseId && (
          <div className={css.enterpriseColumns}>
            <label className={css.enterpriseField}>
              <span>{t.visibility}</span>
              <TextInput type="search" maxLength={120} value={memberQuery} placeholder={t.searchMembers} aria-label={t.searchMembers}
                onChange={event => setMemberQuery(event.target.value)}/>
              <FormSelect aria-label={t.visibility}
                value={shareWith}
                disabled={disabled || (!directory.data && !shareWith)}
                onChange={(e) => { setShareWith(e.target.value); setShareName(e.currentTarget.selectedOptions[0]?.text ?? ""); }}
              >
                <option value="">{c.selected}</option>
                {shareWith && !directory.data?.items.some(m => "m:" + m.userId === shareWith) &&
                  <option value={shareWith}>{shareName}</option>}
                {directory.data?.items.map((m) => (
                  <option key={m.userId} value={"m:" + m.userId}>
                    {m.name || m.email}
                  </option>
                ))}
              </FormSelect>
            </label>
            <DirectoryStatus directory={directory} t={t}/>
            {shareWith && (
              <label className={css.enterpriseField}>
                <span>{t.permission}</span>
                <FormSelect
                  value={shareRole}
                  onChange={(e) =>
                    setShareRole(e.target.value as "view" | "participate")
                  }
                >
                  <option value="view">{c.view}</option>
                  <option value="participate">{c.participate}</option>
                </FormSelect>
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
            <FormButton
              type="button"
              variant="outline"
              disabled={state.loading}
              onClick={() => void props.refreshEnterprises()}
            >
              {t.refresh}
            </FormButton>
          </div>
        )}
        {!state.signedIn && <p className={css.muted}>{t.signIn}</p>}
        <p className={css.muted}>{mode==='cloud'?c.cloudHint:t.createProjectHint}</p>
        {error && (
          <p className={css.error} role="alert">
            {error}
          </p>
        )}
        <div className={css.dialogFooter}>
          <FormButton
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={props.onCancel}
          >
            {t.cancel}
          </FormButton>
          <FormButton
            type="submit"
            variant="primary"
            disabled={disabled || (mode==='cloud' ? !cloudEnabled || !cloudName.trim() || !state.signedIn : !path.trim() || invalidPath)}
          >
            {disabled ? t.loading : t.createProject}
          </FormButton>
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
