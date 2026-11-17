import { useState, type FormEvent } from "react";
import { Button, IconPlusOutlineRegular, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import type { EnterpriseMcp } from "../shared/enterprise.ts";
import { AccessDialog, AudiencePill, RowMenu, type AssetProps } from "./enterprise-assets.tsx";
import { format } from "./enterprise-locale.ts";
import { EmptyState, Field, FormError, ListSkeleton, Notice, useRecord, useTask } from "./enterprise-ui.tsx";
import css from "./suite.module.css";

export function McpTab(props: AssetProps) {
  const { enterpriseId, detail, t, call, controller, revision } = props;
  const path = "/organizations/" + enterpriseId + "/mcp";
  const record = useRecord<{ canManage: boolean; items: EnterpriseMcp[] }>(path, call, revision);
  const [creating, setCreating] = useState(false);
  const [access, setAccess] = useState<EnterpriseMcp | null>(null);
  if (!record.data) return record.error
    ? <Notice error={record.error} t={t} retry={record.reload} />
    : <ListSkeleton />;
  const { canManage, items } = record.data;
  return <div className={css.teamView}>
    {canManage && <div className={css.tabActions}>
      <Button variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={() => setCreating(true)}>{t.newMcp}</Button>
    </div>}
    {!items.length ? <EmptyState title={t.noMcp} hint={t.noMcpHint} /> :
      <div className={css.peopleList}>{items.map(item => <div key={item.id} className={css.person}>
        <span className={css.personText}>
          <strong>{item.title}</strong>
          <small>{item.description ? item.description + " · " : ""}{item.host}</small>
        </span>
        <AudiencePill audience={item.audience} detail={detail} t={t}
          {...(canManage ? { onEdit: () => setAccess(item) } : {})} />
        {canManage && <span className={css.personActions}>
          <RowMenu t={t} items={[{ id: "delete", label: t.remove, danger: true }]} onSelect={() => controller.open({
            kind: "confirm", title: format(t.deleteMcpTitle, { name: item.title }), description: t.deleteMcpBody,
            confirmLabel: t.remove,
            run: async () => {
              await call(path + "/" + item.id, undefined, "DELETE");
              await controller.load();
            },
          })} />
        </span>}
      </div>)}</div>}
    {creating && <McpDialog {...props} path={path} close={() => setCreating(false)} />}
    {access && <AccessDialog {...props} kind="mcp" assetId={access.id} title={access.title}
      audience={access.audience} close={() => setAccess(null)} />}
  </div>;
}

function McpDialog({ path, t, call, controller, close }: AssetProps & { path: string; close(): void }) {
  const task = useTask(t);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void task.run(async () => {
      await call(path, { title, description, endpoint: endpoint.trim(), ...(key ? { key } : {}) });
      controller.notify(t.mcpCreated);
      close();
      await controller.load();
    });
  };
  return <Modal open title={t.newMcp} description={t.mcpEndpointHint} closeLabel={t.close}
    className={css.enterpriseModal!} onClose={() => { if (!task.busy) close(); }}>
    <form onSubmit={submit} className={css.enterpriseForm}>
      <Field label={t.name}><input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></Field>
      <Field label={t.skillDescription}><input maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></Field>
      <Field label={t.mcpEndpoint}><input type="url" required maxLength={2048} value={endpoint} onChange={event => setEndpoint(event.target.value)} /></Field>
      <Field label={t.mcpKey}><input type="password" autoComplete="new-password" maxLength={8192} value={key}
        onChange={event => setKey(event.target.value)} /></Field>
      <FormError message={task.error} />
      <div className={css.dialogFooter}>
        <Button type="button" variant="outline" disabled={task.busy} onClick={close}>{t.cancel}</Button>
        <Button type="submit" variant="primary" disabled={task.busy || !title.trim() || !endpoint.trim()}>{t.newMcp}</Button>
      </div>
    </form>
  </Modal>;
}
