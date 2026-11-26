import { useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { Modal } from "../../../_shared/ui/modal.tsx";
import { waitForDeletion } from "./deletion.ts";
import { audienceDraft, audienceInput, audienceReady } from "../../../../services/ipollowork/src/audience-scope.ts";
import type { EnterpriseAssets, EnterprisePackage, PackageDetail } from "../shared/enterprise.ts";
import { AccessDialog, AudienceFields, AudiencePill, RowMenu, type AssetProps } from "./enterprise-assets.tsx";
import { EmptyState, Field, FormError, ListSkeleton, Notice, Row, Section, useRecord, useTask } from "./enterprise-ui.tsx";
import { FilePicker } from "./file-picker.tsx";
import { ProjectDownload } from "./project-files.tsx";
import { projectCopy } from "./project-copy.ts";
import { enterpriseError, format } from "./enterprise-locale.ts";
import css from "./suite.module.css";

export function OrganizationFilePackages(props: AssetProps) {
  const { enterpriseId, call, revision, t, controller, language } = props;
  const base = "/organizations/" + enterpriseId;
  const record = useRecord<EnterpriseAssets>(base + "/assets", call, revision);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<EnterprisePackage | "new">();
  const [access, setAccess] = useState<EnterprisePackage>();
  const zh = language.startsWith("zh");
  const add = zh ? "新建文件包" : "New file package";
  const canManage = props.detail.canManage;
  return <Section title={t.packagesTab} actions={canManage && <Button variant="primary" onClick={() => setEditing("new")}>{add}</Button>}>
    <Notice error={record.error} t={t} retry={record.reload}/>
    {!record.data && !record.error && <ListSkeleton/>}
    {record.data && !record.data.packages?.length && <EmptyState title={zh ? "暂无组织文件包" : "No organization file packages"}/>}
    {record.data?.packages?.map(item => {
      const path = base + "/packages/" + item.id;
      return <div key={item.id}>
        <Row title={item.title} meta={item.description}
          onOpen={() => setSelected(current => current === item.id ? undefined : item.id)}
          actions={canManage && <>
            <AudiencePill audience={item.audience} detail={props.detail} t={t} onEdit={() => setAccess(item)}/>
            <RowMenu t={t} items={[{id:"edit",label:t.edit},{id:"remove",label:t.remove,danger:true}]} onSelect={id => {
              if (id === "edit") setEditing(item);
              else controller.open({kind:"confirm",title:zh ? "移除文件包" : "Remove file package",
                description:item.title,confirmLabel:t.remove,run:async()=>{await waitForDeletion(await call(path,undefined,"DELETE"), true); record.reload();}});
            }}/>
          </>}/>
        {selected === item.id && <PackageFiles {...props} path={path} afterChange={record.reload}/>}
      </div>;
    })}
    {(record.data?.packages?.length ?? 0) >= 200 && <p className={css.quietLine}>{t.packageListLimit}</p>}
    {editing && <PackageEditor {...props} item={editing === "new" ? undefined : editing} title={editing === "new" ? add : t.edit}
      path={base + "/packages"} close={() => { setEditing(undefined); record.reload(); }} opened={setSelected}/>}
    {access && <AccessDialog {...props} kind="package" assetId={access.id} title={access.title} audience={access.audience} close={() => setAccess(undefined)}/>}
  </Section>;
}

function PackageEditor({ item, title, path, close, opened, call, t, language, enterpriseId, detail, revision }: AssetProps & {
  item: EnterprisePackage | undefined; title: string; path: string; close(): void; opened(id: string): void;
}) {
  const task = useTask(t);
  const [audience, setAudience] = useState(() => audienceDraft());
  return <Modal open title={title} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close(); }}>
    <form className={css.enterpriseForm} onSubmit={event => {
      event.preventDefault();
      if (!item && !audienceReady(audience)) return;
      const form = new FormData(event.currentTarget);
      void task.run(async () => {
        const metadata = { title: String(form.get("name") ?? ""), description: String(form.get("description") ?? "") };
        if (item) await call(path + "/" + item.id, metadata, "PATCH");
        else {
          const { id } = await call<{id:string}>(path, { ...metadata, audience: audienceInput(audience) });
          opened(id);
        }
        close();
      });
    }}>
      <Field label={t.name}><input name="name" required maxLength={120} defaultValue={item?.title} disabled={task.busy}/></Field>
      <Field label={language.startsWith("zh") ? "说明" : "Description"}><textarea name="description" maxLength={2000} rows={3}
        defaultValue={item?.description} disabled={task.busy}/></Field>
      {!item && <AudienceFields enterpriseId={enterpriseId} detail={detail} t={t} call={call} revision={revision}
        value={audience} change={setAudience} disabled={task.busy}/>}
      <FormError message={task.error}/>
      <div className={css.dialogFooter}><Button type="submit" variant="primary" disabled={task.busy || (!item && !audienceReady(audience))}>{t.save}</Button></div>
    </form>
  </Modal>;
}

function PackageFiles({ path, afterChange, call, revision, controller, detail, t, language }: AssetProps & { path: string; afterChange(): void }) {
  const record = useRecord<PackageDetail>(path, call, revision);
  const task = useTask(t, error => {
    const code = error instanceof Error ? error.message : '';
    if (code === 'FILE_NOT_FOUND') return t.packageFileMissing;
    if (code === 'STORAGE_QUOTA_EXCEEDED') return t.packageQuotaExceeded;
    return ['UPLOAD_TOO_LARGE', 'IPW_FILE_TOO_LARGE', 'IPW_REQUEST_TOO_LARGE'].includes(code)
      ? t.packageFileLimit : enterpriseError(code, t, t.packageUploadFailed);
  });
  const [files, setFiles] = useState<File[]>([]);
  const [savedPath, setSavedPath] = useState<string>();
  const c = projectCopy(language);
  const refresh = () => { record.reload(); afterChange(); };
  return <div className={css.enterpriseForm}>
    <Notice error={record.error} t={t} retry={record.reload}/>
    {savedPath && <p className={css.projectDownloadPath} role="status">{format(c.downloadedTo, { path: savedPath })}</p>}
    {!record.data && !record.error && <ListSkeleton rows={2}/>}
    {record.data?.files.map(file => <Row key={file.id} title={file.name} meta={file.addedBy}
      actions={<>
        <ProjectDownload href={"/ipollowork-suite/enterprise" + path + "/files/" + file.id + "/download"}
          name={file.name} view={{t, language, controller}} chooseDestination onSaved={setSavedPath}/>
        {detail.canManage && <Button size="sm" variant="ghost" onClick={() => controller.open({
          kind:"confirm", title:t.remove, description:file.name, confirmLabel:t.remove,
          run:async()=>{await waitForDeletion(await call(path + "/files/" + file.id, undefined, "DELETE"), true); refresh();},
        })}>{t.remove}</Button>}
      </>}/>)}
    {record.data?.files.length === 0 && <p className={css.quietLine}>{language.startsWith("zh") ? "暂无文件" : "No files yet"}</p>}
    {(record.data?.files.length ?? 0) >= 500 && <p className={css.quietLine}>{t.packageFilesLimit}</p>}
    {detail.canManage && <div className={css.enterpriseForm}>
      <FilePicker label={c.upload} hint={language.startsWith("zh") ? "单个文件最大 24 MB" : "Up to 24 MB per file"} files={files}
        disabled={task.busy} language={language} onSelect={setFiles}/>
      <Button size="sm" variant="outline" style={{ alignSelf: 'flex-start' }} disabled={!files.length || task.busy} onClick={() => void task.run(async () => {
        const file = files[0]!;
        if (file.size > 24 * 1024 * 1024) throw new Error("UPLOAD_TOO_LARGE");
        const form = new FormData();
        form.set("file", file);
        const response = await fetch("/ipollowork-suite/enterprise" + path + "/files", { method: "POST", body: form });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "IPW_FILE_TRANSFER_FAILED");
        setFiles([]);
        refresh();
      })}>{task.busy ? c.uploading : c.upload}</Button>
      <FormError message={task.error}/>
    </div>}
  </div>;
}
