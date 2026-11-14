/** Project archives and versions use the same native rows and dialogs as project collaboration. */
import { useState } from "react";
import { Button, Modal, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ViewProps } from "./collaboration.tsx";
import {
  EmptyState,
  FormError,
  ListSkeleton,
  Notice,
  Row,
  Section,
  useRecord,
  useTask,
  When,
} from "./enterprise-ui.tsx";
import { projectCopy } from "./project-copy.ts";
import css from "./suite.module.css";

interface Artifact {
  id: string;
  path: string;
  resource_id: string;
  kind: "output";
  version: number;
  author_name: string;
  created_at: number;
  expires_at?: number | null;
  published_at?: number | null;
  bytes: number;
}
interface Listing {
  items: Artifact[];
  policy: { outputs: boolean };
}

export function ProjectOverview({ id, view }: { id: string; view: ViewProps }) {
  const c = projectCopy(view.language);
  const record = useRecord<{
    people: {
      id: string;
      name: string;
      outputs: number;
      contributions: number;
      updated_at: number;
    }[];
    memoryVersion: number;
    outputs: { count: number };
  }>("/projects/" + id + "/overview", view.call, view.revision);
  if (!record.data)
    return record.error ? (
      <Notice error={record.error} t={view.t} retry={record.reload} />
    ) : (
      <ListSkeleton />
    );
  return (
    <Section
      title={c.contributors}
      meta={c.version + " " + record.data.memoryVersion}
    >
      <div className={css.enterpriseList}>
        {record.data.people.map((person) => (
          <Row
            key={person.id}
            title={person.name}
            meta={
              <>
                {c.outputs} {person.outputs} · {c.contributions}{" "}
                {person.contributions}
                {person.updated_at > 0 && (
                  <>
                    {" "}
                    · <When at={person.updated_at} language={view.language} />
                  </>
                )}
              </>
            }
          />
        ))}
      </div>
    </Section>
  );
}

export function ProjectFiles({
  id,
  maintain,
  participate,
  view,
}: {
  id: string;
  maintain: boolean;
  participate: boolean;
  view: ViewProps;
}) {
  const c = projectCopy(view.language),
    task = useTask(view.t);
  const record = useRecord<Listing>(
    "/projects/" + id + "/artifacts",
    view.call,
    view.revision,
  );
  const capacity = useRecord<{
    limit_bytes: number;
    used_bytes: number;
    reserved_bytes: number;
  }>("/projects/" + id + "/storage", view.call, view.revision);
  const status = useRecord<{
    items: { path: string; state: string; error?: string }[];
  }>("/projects/" + id + "/archive-status", view.call, view.revision);
  const [history, setHistory] = useState<Artifact | null>(null);
  const [files, setFiles] = useState<File[]>([]),
    [requests] = useState(() => new Map<File, string>());
  if (!record.data)
    return record.error ? (
      <Notice error={record.error} t={view.t} retry={record.reload} />
    ) : (
      <ListSkeleton />
    );
  const listing = record.data,
    items = listing.items;
  const failed =
    status.data?.items.filter((item) => item.state === "failed") ?? [];
  const upload = () =>
    void task.run(async () => {
      for (const file of files) {
        let requestId = requests.get(file);
        if (!requestId) {
          requestId = crypto.randomUUID();
          requests.set(file, requestId);
        }
        const metadata = JSON.stringify({
          requestId,
          kind: "output",
          path: file.name,
          bytes: file.size,
          mime: file.type || "application/octet-stream",
        });
        const encoded = btoa(
          String.fromCharCode(...new TextEncoder().encode(metadata)),
        )
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "");
        const response = await fetch(
          "/ipollowork-suite/enterprise/projects/" + id + "/artifacts/upload",
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "x-ipw-artifact": encoded },
            body: file,
          },
        );
        if (!response.ok) {
          const value = (await response.json()) as { error?: string };
          throw new Error(value.error ?? "IPW_FILE_TRANSFER_FAILED");
        }
      }
      setFiles([]);
      record.reload();
      status.reload();
      capacity.reload();
    });
  return (
    <div className={css.enterpriseStack}>
      {capacity.data && (
        <p className={css.muted}>
          {c.storageUsed} {(capacity.data.used_bytes / 1024 ** 3).toFixed(2)} /{" "}
          {capacity.data.limit_bytes / 1024 ** 3} GiB
        </p>
      )}
      {maintain && (
        <details>
          <summary className={css.muted}>{c.archiveOutputs}</summary>
          <label className={css.muted}>
            <input
              type="checkbox"
              checked={listing.policy.outputs}
              disabled={task.busy}
              onChange={(event) => {
                const outputs = event.target.checked;
                void task.run(async () => {
                  await view.call(
                    "/projects/" + id + "/archive-policy",
                    { outputs },
                    "PUT",
                  );
                  record.reload();
                });
              }}
            />
            {c.archiveHint}
          </label>
        </details>
      )}
      {failed.length > 0 && (
        <Section
          title={c.archiveFailed}
          actions={
            <Button
              size="sm"
              disabled={task.busy}
              onClick={() =>
                void task.run(async () => {
                  await view.call("/projects/" + id + "/archive-status", {});
                  status.reload();
                  record.reload();
                })
              }
            >
              {c.retry}
            </Button>
          }
        >
          <p className={css.muted}>{c.archiveFailedHint}</p>
        </Section>
      )}
      <div>
        {items.length ? (
          <div className={css.enterpriseList}>
            {items.map((file) => (
              <Row
                key={file.id}
                title={file.path}
                meta={
                  <>
                    {file.author_name} ·{" "}
                    <When at={file.created_at} language={view.language} />
                  </>
                }
                aside={
                  <Tag tone="outline">
                    {c.version} {file.version}
                  </Tag>
                }
                onOpen={() => setHistory(file)}
                actions={
                  <a
                    className={css.projectDownload}
                    href={
                      "/ipollowork-suite/enterprise/download/" +
                      file.resource_id
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {c.download}
                  </a>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title={c.outputsEmpty} />
        )}
      </div>
      {participate && listing.policy.outputs && (
        <div className={css.enterpriseForm}>
          <input
            aria-label={c.chooseFiles}
            type="file"
            multiple
            disabled={task.busy}
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <Button
            variant="outline"
            disabled={task.busy || !files.length}
            onClick={upload}
          >
            {task.busy ? c.uploading : c.upload}
          </Button>
        </div>
      )}
      <FormError message={task.error} />
      {history && (
        <VersionHistory
          file={history}
          id={id}
          view={view}
          close={() => setHistory(null)}
        />
      )}
    </div>
  );
}

function VersionHistory({
  file,
  id,
  view,
  close,
}: {
  file: Artifact;
  id: string;
  view: ViewProps;
  close(): void;
}) {
  const c = projectCopy(view.language),
    record = useRecord<{ items: Artifact[] }>(
      "/projects/" + id + "/artifacts/" + file.id + "/versions",
      view.call,
      view.revision,
    );
  return (
    <Modal
      open
      title={file.path}
      closeLabel={c.close}
      onClose={close}
      className={css.enterpriseModal!}
    >
      {!record.data ? (
        record.error ? (
          <Notice error={record.error} t={view.t} retry={record.reload} />
        ) : (
          <ListSkeleton />
        )
      ) : (
        <div className={css.enterpriseList}>
          {record.data.items.map((item) => (
            <Row
              key={item.id}
              title={c.version + " " + item.version}
              meta={
                <>
                  {item.author_name} ·{" "}
                  <When at={item.created_at} language={view.language} />
                </>
              }
              actions={
                <a
                  className={css.projectDownload}
                  href={
                    "/ipollowork-suite/enterprise/download/" + item.resource_id
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.download}
                </a>
              }
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

export function MemoryVersions({ id, view }: { id: string; view: ViewProps }) {
  const c = projectCopy(view.language),
    record = useRecord<{
      items: { version: number; author_name: string; created_at: number }[];
    }>("/projects/" + id + "/memory-versions", view.call, view.revision);
  return (
    <details>
      <summary className={css.muted}>{c.versions}</summary>
      {record.data?.items.map((item) => (
        <Row
          key={item.version}
          title={c.version + " " + item.version}
          meta={item.author_name}
          actions={
            <a
              className={css.projectDownload}
              href={
                "/ipollowork-suite/enterprise/projects/" +
                id +
                "/memory-versions/" +
                item.version
              }
              target="_blank"
              rel="noreferrer"
            >
              {c.download}
            </a>
          }
        />
      ))}
    </details>
  );
}
