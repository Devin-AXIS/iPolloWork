/** The same capacity view serves personal accounts and organizations. */
import { useState } from "react";
import { api, type Row } from "./api.js";
import { ActionForm, Field, Status, useData, value } from "./components.js";

export function StorageQuota({
  scope,
  ownerId,
  editable = false,
}: {
  scope: "personal" | "organization";
  ownerId: string;
  editable?: boolean;
}) {
  const path = editable
    ? `/api/v1/admin/storage/${scope}/${ownerId}`
    : scope === "personal"
      ? "/api/v1/me/storage"
      : `/api/v1/enterprises/${ownerId}/storage`;
  const record = useData<Row>(path),
    [editing, setEditing] = useState(false);
  const used = Number(record.data?.used_bytes ?? 0),
    limit = Number(record.data?.limit_bytes ?? 0),
    gib = 1024 ** 3;
  return (
    <section className="panel">
      <div className="section-title">
        {scope === "personal" ? "个人容量" : "组织容量"}
        {editable && (
          <button className="link" onClick={() => setEditing(!editing)}>
            调整
          </button>
        )}
      </div>
      <Status error={record.error} loading={!record.data} />
      {record.data && (
        <>
          <p>
            {(used / gib).toFixed(2)} / {limit / gib} GiB
          </p>
          <progress
            aria-label="已用容量"
            max={Math.max(limit, 1)}
            value={used}
          />
          <p>
            {scope === "personal"
              ? "未发布输出保留 7 天，发布后长期保留"
              : "组织输出长期保留，按总容量管理"}
          </p>
        </>
      )}
      {editing && (
        <ActionForm
          submit={async (form) => {
            await api(
              `/api/v1/admin/storage/${scope}/${ownerId}`,
              { bytes: Number(value(form, "gib")) * gib },
              "PUT",
            );
            record.reload();
            setEditing(false);
          }}
        >
          <Field label="总容量（GiB）">
            <input
              name="gib"
              type="number"
              min="1"
              step="1"
              required
              defaultValue={limit / gib}
            />
          </Field>
        </ActionForm>
      )}
    </section>
  );
}
