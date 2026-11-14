/** Private object storage, per-owner quotas, publication retention and expiring cloud copies. */
import { createHash } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Store } from "./database.js";
import type { Settings } from "./settings.js";
import type { Config } from "./config.js";
import { ServiceError } from "./errors.js";

type Scope = "personal" | "organization";
interface Owner {
  userId: string;
  organizationId: string | null;
}
interface Placement {
  projectId?: string;
  permanent?: boolean;
}
const GIB = 1024 ** 3;

export class Storage {
  private timer?: ReturnType<typeof setInterval>;
  private cleaning?: Promise<void>;
  constructor(
    private store: Store,
    private settings: Settings,
    private config: Config,
  ) {}
  start(): void {
    this.timer = setInterval(() => {
      this.cleaning ??= this.cleanup()
        .catch(() =>
          console.error(
            "Expired cloud files could not be removed; storage remains charged",
          ),
        )
        .finally(() => {
          this.cleaning = undefined;
        });
    }, this.config.storageCleanupIntervalMs);
    this.timer.unref();
  }
  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.cleaning;
  }
  private async client() {
    const setting = await this.settings.get("oss");
    if (
      !setting.region ||
      !setting.bucket ||
      !setting.accessKeyId ||
      !setting.accessKeySecret
    )
      throw new ServiceError("OSS_NOT_CONFIGURED", 503, "请先配置阿里云 OSS");
    const { default: OSS } = await import("ali-oss");
    return new OSS({
      region: setting.region,
      bucket: setting.bucket,
      accessKeyId: setting.accessKeyId,
      accessKeySecret: setting.accessKeySecret,
      secure: true,
    });
  }
  private async ensureQuota(scope: Scope, ownerId: string): Promise<void> {
    await this.store.run(
      "INSERT INTO storage_quotas(scope,owner_id,limit_bytes) VALUES(?,?,?) ON CONFLICT DO NOTHING",
      scope,
      ownerId,
      (scope === "personal"
        ? this.config.personalStorageGiB
        : this.config.organizationStorageGiB) * GIB,
    );
  }
  async quota(scope: Scope, ownerId: string) {
    await this.ensureQuota(scope, ownerId);
    return (await this.store.one(
      "SELECT scope,owner_id,limit_bytes,used_bytes,reserved_bytes FROM storage_quotas WHERE scope=? AND owner_id=?",
      scope,
      ownerId,
    ))!;
  }
  async setQuota(scope: Scope, ownerId: string, bytes: number): Promise<void> {
    await this.store.transaction(async () => {
      await this.ensureQuota(scope, ownerId);
      const row = await this.store.one(
        "SELECT * FROM storage_quotas WHERE scope=? AND owner_id=? FOR UPDATE",
        scope,
        ownerId,
      );
      if (Number(row!.used_bytes) + Number(row!.reserved_bytes) > bytes)
        throw new ServiceError(
          "STORAGE_QUOTA_BELOW_USAGE",
          409,
          "容量不能低于当前已用空间",
        );
      await this.store.run(
        "UPDATE storage_quotas SET limit_bytes=? WHERE scope=? AND owner_id=?",
        bytes,
        scope,
        ownerId,
      );
    });
  }
  async put(
    id: string,
    owner: Owner,
    mime: string,
    bytes: Buffer,
    placement: Placement = {},
  ): Promise<string> {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return (
      await this.putStream(id, owner, mime, body, bytes.byteLength, placement)
    ).storageKey;
  }
  /** Reserve before accepting bytes, stream without buffering, then charge the owner exactly once. */
  async putStream(
    id: string,
    owner: Owner,
    mime: string,
    body: ReadableStream<Uint8Array>,
    expectedBytes: number,
    placement: Placement = {},
  ) {
    const cloud = Boolean((await this.settings.get("oss")).bucket);
    if (!cloud && this.config.requireOss)
      throw new ServiceError("OSS_NOT_CONFIGURED", 503, "请先配置项目存储");
    const scope: Scope = owner.organizationId ? "organization" : "personal",
      ownerId = owner.organizationId ?? owner.userId;
    const prefix = `${scope}/${ownerId}${placement.projectId ? "/projects/" + placement.projectId : ""}`;
    const key = cloud ? "oss/" + prefix + "/" + id : "local/" + id,
      created = Date.now();
    let permanent = scope === "organization" || placement.permanent;
    await this.store.transaction(async () => {
      if (placement.projectId)
        permanent ||= Boolean(
          (
            await this.store.one(
              "SELECT published_at FROM projects WHERE id=? FOR SHARE",
              placement.projectId,
            )
          )?.published_at,
        );
      await this.ensureQuota(scope, ownerId);
      const quota = await this.store.one(
        "SELECT * FROM storage_quotas WHERE scope=? AND owner_id=? FOR UPDATE",
        scope,
        ownerId,
      );
      if (
        Number(quota!.used_bytes) +
          Number(quota!.reserved_bytes) +
          expectedBytes >
        Number(quota!.limit_bytes)
      )
        throw new ServiceError(
          "STORAGE_QUOTA_EXCEEDED",
          409,
          "存储空间不足，请清理或升级容量",
        );
      await this.store.run(
        "INSERT INTO storage_objects VALUES(?,?,?,?,?,'reserved',false,?,?,NULL,?,?,false)",
        id,
        scope,
        ownerId,
        key,
        expectedBytes,
        created,
        created + this.config.uploadReservationMs,
        placement.projectId ?? null,
        permanent
          ? null
          : created + this.config.personalRetentionDays * 86400000,
      );
      await this.store.run(
        "UPDATE storage_quotas SET reserved_bytes=reserved_bytes+? WHERE scope=? AND owner_id=?",
        expectedBytes,
        scope,
        ownerId,
      );
    });
    const digest = createHash("sha256"),
      reader = body.getReader();
    let received = 0;
    const source = Readable.from(
      (async function* () {
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            received += part.value.byteLength;
            if (received > expectedBytes)
              throw new ServiceError("UPLOAD_TOO_LARGE", 413);
            digest.update(part.value);
            yield Buffer.from(part.value);
          }
          if (received !== expectedBytes)
            throw new ServiceError("UPLOAD_INCOMPLETE", 409);
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      })(),
    );
    try {
      if (cloud)
        await (
          await this.client()
        ).put(key.slice(4), source, {
          mime,
          headers: { "x-oss-object-acl": "private" },
        });
      else {
        await mkdir(resolve(this.config.dataDir, "files"), {
          recursive: true,
          mode: 0o700,
        });
        await pipeline(
          source,
          createWriteStream(resolve(this.config.dataDir, "files", id), {
            flags: "wx",
            mode: 0o600,
          }),
        );
      }
      await this.store.transaction(async () => {
        const object = await this.store.one(
          "SELECT * FROM storage_objects WHERE id=? FOR UPDATE",
          id,
        );
        if (object?.state !== "reserved")
          throw new ServiceError("UPLOAD_EXPIRED", 409);
        await this.store.run(
          "UPDATE storage_quotas SET reserved_bytes=reserved_bytes-?,used_bytes=used_bytes+? WHERE scope=? AND owner_id=?",
          expectedBytes,
          expectedBytes,
          scope,
          ownerId,
        );
        await this.store.run(
          "UPDATE storage_objects SET state='ready',charged=true WHERE id=?",
          id,
        );
      });
      return { storageKey: key, bytes: received, sha256: digest.digest("hex") };
    } catch (error) {
      source.destroy();
      if (
        !(
          error instanceof ServiceError &&
          error.code === "DATABASE_COMMIT_UNKNOWN"
        )
      )
        await this.remove(key);
      throw error;
    }
  }
  /** Attach a staged object in the same transaction as its resource or memory reference. */
  async retain(key: string): Promise<void> {
    if (!this.store.inTransaction)
      throw new Error("Storage attachment requires the metadata transaction");
    const result = await this.store.run(
      "UPDATE storage_objects SET attached=true,expires_at=CASE WHEN EXISTS(SELECT 1 FROM projects p WHERE p.id=project_id AND p.published_at IS NOT NULL) THEN NULL ELSE retention_expires_at END WHERE storage_key=? AND state='ready'",
      key,
    );
    if (!result.changes) throw new ServiceError("UPLOAD_EXPIRED", 409);
  }
  async persist<T>(key: string, metadata: () => Promise<T>): Promise<T> {
    try {
      return await this.store.transaction(async () => {
        const result = await metadata();
        await this.retain(key);
        return result;
      });
    } catch (error) {
      if (
        !(
          error instanceof ServiceError &&
          error.code === "DATABASE_COMMIT_UNKNOWN"
        )
      )
        await this.remove(key);
      throw error;
    }
  }
  /** Publication preserves the cloud copy; it does not change who may read it. */
  async publish(key: string): Promise<void> {
    await this.store.transaction(async () => {
      const row = await this.store.one(
        "SELECT * FROM storage_objects WHERE storage_key=? FOR UPDATE",
        key,
      );
      if (
        row?.state !== "ready" ||
        !row.attached ||
        (row.expires_at && Number(row.expires_at) <= Date.now())
      )
        throw new ServiceError(
          "OUTPUT_EXPIRED",
          410,
          "云端文件已到期，本地文件不受影响",
        );
      await this.store.run(
        "UPDATE storage_objects SET published_at=COALESCE(published_at,?),expires_at=NULL WHERE storage_key=?",
        Date.now(),
        key,
      );
    });
  }
  async publishProject(projectId: string): Promise<void> {
    await this.store.run(
      "UPDATE storage_objects SET published_at=COALESCE(published_at,?),expires_at=NULL WHERE project_id=? AND state='ready' AND attached AND (expires_at IS NULL OR expires_at>?)",
      Date.now(),
      projectId,
      Date.now(),
    );
  }
  private async requireReadable(key: string): Promise<void> {
    const row = await this.store.one(
      "SELECT state,expires_at,attached FROM storage_objects WHERE storage_key=?",
      key,
    );
    if (
      row &&
      (row.state !== "ready" ||
        !row.attached ||
        (row.expires_at && Number(row.expires_at) <= Date.now()))
    )
      throw new ServiceError(
        "OUTPUT_EXPIRED",
        410,
        "云端文件已到期，本地文件不受影响",
      );
  }
  async read(key: string): Promise<Buffer> {
    await this.requireReadable(key);
    if (key.startsWith("oss/"))
      return (await (await this.client()).get(key.slice(4))).content as Buffer;
    if (!/^local\/[a-f0-9-]{36}$/.test(key))
      throw new ServiceError("INVALID_STORAGE_KEY", 409);
    return readFile(resolve(this.config.dataDir, "files", key.slice(6)));
  }
  async download(key: string, filename: string): Promise<Response> {
    await this.requireReadable(key);
    if (key.startsWith("oss/"))
      return Response.json({
        url: (await this.client()).signatureUrl(key.slice(4), {
          expires: 60,
          response: { "content-disposition": "attachment" },
        }),
      });
    if (!/^local\/[a-f0-9-]{36}$/.test(key))
      throw new ServiceError("INVALID_STORAGE_KEY", 409);
    return new Response(
      Readable.toWeb(
        createReadStream(resolve(this.config.dataDir, "files", key.slice(6))),
      ) as ReadableStream<Uint8Array>,
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition":
            "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
  /** Only service-owned cloud/cache copies are removed. Native workspace paths are never accepted. */
  async remove(key: string): Promise<void> {
    if (key.startsWith("oss/"))
      await (await this.client()).delete(key.slice(4));
    else {
      if (!/^local\/[a-f0-9-]{36}$/.test(key))
        throw new ServiceError("INVALID_STORAGE_KEY", 409);
      try {
        await unlink(resolve(this.config.dataDir, "files", key.slice(6)));
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
    }
    await this.store.transaction(async () => {
      const row = await this.store.one(
        "SELECT * FROM storage_objects WHERE storage_key=? FOR UPDATE",
        key,
      );
      if (!row || row.state === "deleted") return;
      await this.store.run(
        `UPDATE storage_quotas SET ${row.charged ? "used_bytes" : "reserved_bytes"}=${row.charged ? "used_bytes" : "reserved_bytes"}-? WHERE scope=? AND owner_id=?`,
        row.bytes,
        row.scope,
        row.owner_id,
      );
      await this.store.run(
        "UPDATE storage_objects SET state='deleted' WHERE storage_key=?",
        key,
      );
    });
  }
  /** Claim expired copies transactionally so publication cannot race their deletion. */
  async cleanup(): Promise<void> {
    const keys = await this.store.transaction(async () => {
      const rows = await this.store.all(
        "SELECT storage_key FROM storage_objects WHERE state='deleting' OR (state IN ('ready','reserved') AND expires_at<=? AND published_at IS NULL) ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED",
        Date.now(),
      );
      for (const row of rows)
        await this.store.run(
          "UPDATE storage_objects SET state='deleting' WHERE storage_key=?",
          row.storage_key,
        );
      return rows.map((row) => String(row.storage_key));
    });
    for (const key of keys) await this.remove(key);
  }
}
