/** Enterprise admission and the DSH v1 relay. Models and Session storage stay on the owner's DSH. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { Actor } from "./auth.js";
import type { Config } from "./config.js";
import type { Row, Store } from "./database.js";
import { enterpriseAccess, projectRole, uid, type Project } from "./domain.js";
import { audienceAllows, readShareAudience } from "./share-audience.js";
import { ServiceError } from "./errors.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const ticket = z.object({
  purpose: z.enum(["owner", "viewer"]),
  sessionId: z.string(),
  subjectId: z.string(),
  displayName: z.string(),
  expiresAt: z.number(),
  instanceKey: z.string().optional(),
  shareId: z.string().optional(),
  anonymous: z.literal(true).optional(),
});
type Ticket = z.infer<typeof ticket>;
export type LiveShare = Row & {
  id: string;
  owner_id: string;
  project_id: string | null;
  audience_json: string;
  allows_fork: number;
  expires_at: number | null;
  source_session: string;
  mode: "view" | "write";
  native_id: string | null;
  gateway_hash: string | null;
  instance_key: string | null;
  title: string;
  revoked_at: number | null;
  access_json: string;
  access_version: number;
};
type Answer = { status: number; body: unknown };
type Pending = { actor: Actor; grant?: Ticket; finish(answer: Answer): void };
type Tunnel = {
  socket: WebSocket;
  owner: Ticket;
  pending: Map<number, Pending>;
  nextId: number;
  alive: boolean;
};

/** Better Auth persists ISO dates; numeric timestamps are accepted for migrated rows. */
export function sessionExpiry(value: unknown): number {
  return typeof value === "number"
    ? value
    : typeof value === "string"
      ? Date.parse(value)
      : NaN;
}

/** One relay instance owns all sockets; its durable registry survives restart. */
export class LiveshareRelay {
  private readonly sockets = new Map<string, Tunnel>();
  private readonly ws = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024 * 1024,
  });
  private readonly timer: ReturnType<typeof setInterval>;
  private refreshing?: Promise<void>;
  private closing?: Promise<void>;
  constructor(
    readonly store: Store,
    readonly config: Config,
  ) {
    this.timer = setInterval(() => {
      void this.refresh().catch(() =>
        console.error("Share access refresh failed"),
      );
    }, 1000);
    this.timer.unref();
  }
  /** Sign a scoped capability; account tokens never cross the relay wire. */
  sign(value: Ticket): string {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return (
      payload +
      "." +
      createHmac("sha256", this.config.secret)
        .update("liveshare:" + payload)
        .digest("base64url")
    );
  }
  /** Validate signature, expiry, and the live Better Auth session on every use. */
  async verify(value: string, purpose: Ticket["purpose"]): Promise<Ticket> {
    const [payload = "", signature = "", extra] = value.split(".");
    const expected = createHmac("sha256", this.config.secret)
      .update("liveshare:" + payload)
      .digest();
    const actual = Buffer.from(signature, "base64url");
    if (
      extra !== undefined ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new ServiceError("LIVESHARE_UNAUTHORIZED", 401);
    let parsed: Ticket;
    try {
      parsed = ticket.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString()),
      );
    } catch {
      throw new ServiceError("LIVESHARE_UNAUTHORIZED", 401);
    }
    if (parsed.purpose !== purpose || parsed.expiresAt <= Date.now())
      throw new ServiceError("LIVESHARE_EXPIRED", 401);
    await this.actor(parsed);
    return parsed;
  }
  /** Resolve the current identity; deleted sessions and banned accounts immediately lose access. */
  async actor(value: Ticket): Promise<Actor> {
    if (value.anonymous) {
      if (
        value.purpose !== "viewer" ||
        !value.shareId ||
        !value.subjectId.startsWith("guest:") ||
        value.expiresAt <= Date.now() ||
        readShareAudience(await this.share(value.shareId)).kind !== "link"
      )
        throw new ServiceError("LIVESHARE_UNAUTHORIZED", 401);
      return { id: value.subjectId, name: "Guest", email: "", role: "guest" };
    }
    const user = await this.store.one(
      'SELECT u.id,u.name,u.email,u.role,u.banned,s."expiresAt" FROM session s JOIN "user" u ON u.id=s."userId" WHERE s.id=? AND u.id=?',
      value.sessionId,
      value.subjectId,
    );
    if (
      !user ||
      user.banned ||
      !(sessionExpiry(user.expiresAt) > Date.now()) ||
      value.expiresAt <= Date.now()
    )
      throw new ServiceError("LIVESHARE_UNAUTHORIZED", 401);
    return {
      id: String(user.id),
      name: String(user.name),
      email: String(user.email),
      role: String(user.role ?? "user"),
    };
  }
  /** Find a live share. Revoked rows remain as replay tombstones. */
  async share(id: string): Promise<LiveShare> {
    const share = await this.store.one<LiveShare>(
      "SELECT * FROM live_shares WHERE native_id=? AND revoked_at IS NULL",
      id,
    );
    if (!share) throw new ServiceError("LIVESHARE_NOT_FOUND", 404);
    if (share.expires_at && share.expires_at <= Date.now())
      throw new ServiceError("LIVESHARE_EXPIRED", 401);
    return share;
  }
  /** Re-evaluate both the sharer and the recipient against current project membership. */
  async admit(share: LiveShare, actor: Actor): Promise<void> {
    if (share.expires_at && share.expires_at <= Date.now())
      throw new ServiceError("LIVESHARE_EXPIRED", 401);
    const owner = await this.store.one(
      'SELECT id,name,email,role,banned FROM "user" WHERE id=?',
      share.owner_id,
    );
    if (!owner || owner.banned)
      throw new ServiceError("LIVESHARE_FORBIDDEN", 403);
    const sharer: Actor = {
      id: String(owner.id),
      name: String(owner.name),
      email: String(owner.email),
      role: String(owner.role ?? "user"),
    };
    if (share.project_id) {
      const project = await this.store.one<Project>(
        "SELECT * FROM projects WHERE id=?",
        share.project_id,
      );
      const role = project && (await projectRole(this.store, sharer, project));
      if (!role || role === "view")
        throw new ServiceError("LIVESHARE_FORBIDDEN", 403);
    }
    const audience = readShareAudience(share);
    if (audience.kind !== "link" && audience.kind !== "project")
      await enterpriseAccess(this.store, sharer, audience.enterpriseId);
    if (!(await audienceAllows(this.store, share, actor)))
      throw new ServiceError("LIVESHARE_FORBIDDEN", 403);
  }

  /** DSH ACL snapshots use qualified identities and a durable increasing revision. */
  async snapshot(share: LiveShare) {
    const audience = readShareAudience(share);
    const members =
      audience.kind === "link"
        ? []
        : audience.kind !== "project"
          ? await this.store.all(
              'SELECT u.id,u.name,u.email,u.role FROM "user" u JOIN members m ON m.user_id=u.id WHERE m.enterprise_id=? AND COALESCE(u.banned,false)=false UNION SELECT id,name,email,role FROM \"user\" WHERE id=? AND COALESCE(banned,false)=false',
              audience.enterpriseId,
              share.owner_id,
            )
          : await this.store.all(
              "SELECT u.id,u.name,u.email,u.role FROM \"user\" u WHERE COALESCE(u.banned,false)=false AND (u.id=? OR u.role='admin' OR EXISTS(SELECT 1 FROM members m JOIN projects p ON p.enterprise_id=m.enterprise_id WHERE p.id=? AND m.user_id=u.id))",
              share.owner_id,
              share.project_id,
            );
    const allowedSubjectIds: string[] = [];
    for (const member of members) {
      try {
        await this.admit(share, {
          id: String(member.id),
          name: String(member.name),
          email: String(member.email),
          role: String(member.role ?? "user"),
        });
        allowedSubjectIds.push(
          ["ipollo", share.project_id ?? share.id, String(member.id)]
            .map(encodeURIComponent)
            .join(":"),
        );
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
      }
    }
    allowedSubjectIds.sort();
    const state = {
      accessMode:
        audience.kind === "link" ? ("open" as const) : ("selected" as const),
      allowedSubjectIds,
      sessionMode: share.mode,
      allowsFork: share.allows_fork === 1,
      ...(share.expires_at
        ? { expiresAt: new Date(share.expires_at).toISOString() }
        : {}),
    };
    const json = JSON.stringify(state);
    if (json !== share.access_json) {
      await this.store.run(
        "UPDATE live_shares SET access_json=?,access_version=access_version+1 WHERE id=?",
        json,
        share.id,
      );
      share.access_version++;
      share.access_json = json;
    }
    return {
      type: "share-access-state" as const,
      version: share.access_version,
      ...state,
    };
  }
  /** Check a DSH management token without accepting it as an account or viewer credential. */
  async managed(id: string, authorization: string): Promise<LiveShare> {
    const share = await this.share(id);
    if (
      !share.gateway_hash ||
      hash(authorization.replace(/^Bearer /, "")) !== share.gateway_hash
    )
      throw new ServiceError("LIVESHARE_UNAUTHORIZED", 401);
    return share;
  }
  /** Forward opaque native calls with server-derived identity; release work on cancellation. */
  async rpc(
    share: LiveShare,
    actor: Actor,
    body: unknown,
    signal?: AbortSignal,
    grant?: Ticket,
  ): Promise<Answer> {
    await this.admit(share, actor);
    // Native View permits read-only AI questions. The enterprise View role grants no model execution.
    if (share.mode === "view" && requestsInput(body))
      return {
        status: 403,
        body: {
          error: {
            code: "liveshare/read-only",
            message: "此链接仅供查看",
            details: {},
          },
        },
      };
    const tunnel = this.sockets.get(share.native_id!);
    if (!tunnel || tunnel.socket.readyState !== WebSocket.OPEN)
      throw new ServiceError(
        "LIVESHARE_OFFLINE",
        503,
        "分享方当前离线，请稍后重试",
      );
    await this.actor(tunnel.owner);
    if (tunnel.pending.size >= 256)
      throw new ServiceError("LIVESHARE_BUSY", 429);
    await this.push(share, tunnel);
    const id = ++tunnel.nextId;
    return new Promise((resolve) => {
      const finish = (answer: Answer) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        tunnel.pending.delete(id);
        resolve(answer);
      };
      const cancel = () => {
        if (tunnel.socket.readyState === WebSocket.OPEN)
          tunnel.socket.send(JSON.stringify({ type: "share-rpc-cancel", id }));
        finish({ status: 408, body: { error: "liveshare/cancelled" } });
      };
      const timer = setTimeout(cancel, 60_000);
      tunnel.pending.set(id, { actor, grant, finish });
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) {
        cancel();
        return;
      }
      tunnel.socket.send(
        JSON.stringify({
          type: "share-rpc",
          id,
          body,
          actor: {
            providerId: "ipollo",
            tenantId: share.project_id ?? share.id,
            subjectId: actor.id,
            displayName: actor.name,
          },
        }),
      );
    });
  }
  private async push(share: LiveShare, tunnel: Tunnel): Promise<void> {
    tunnel.socket.send(JSON.stringify(await this.snapshot(share)));
  }
  /** Apply membership changes to open streams and queued native execution. */
  refresh(): Promise<void> {
    if (this.closing) return this.closing;
    return (this.refreshing ??= this.refreshOnce().finally(() => {
      this.refreshing = undefined;
    }));
  }
  private async refreshOnce(): Promise<void> {
    for (const [id, tunnel] of this.sockets) {
      try {
        const share = await this.share(id);
        await this.admit(share, await this.actor(tunnel.owner));
        await this.push(share, tunnel);
        for (const [rpcId, pending] of tunnel.pending) {
          try {
            if (pending.grant) pending.actor = await this.actor(pending.grant);
            await this.admit(share, pending.actor);
          } catch (error) {
            if (!(error instanceof ServiceError)) throw error;
            tunnel.socket.send(
              JSON.stringify({ type: "share-rpc-cancel", id: rpcId }),
            );
            pending.finish({
              status: 403,
              body: { error: "liveshare/access-revoked" },
            });
          }
        }
      } catch {
        tunnel.socket.close(1008, "access ended");
      }
    }
  }
  /** Bind native owner connections to an authorized audience or an explicitly open link. */
  attach(server: Server): () => void {
    const upgrade = async (
      request: IncomingMessage,
      socket: Socket,
      head: Buffer,
    ) => {
      try {
        const url = new URL(request.url ?? "/", this.config.origin);
        if (url.pathname !== "/__tunnel_gateway__") {
          socket.destroy();
          return;
        }
        const owner = await this.verify(
          String(request.headers["x-liveshare-owner-credential"] ?? ""),
          "owner",
        );
        if (url.searchParams.get("protocolVersion") !== "1")
          throw new ServiceError("LIVESHARE_VERSION", 409);
        const id = z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,200}$/)
          .parse(url.searchParams.get("shareId"));
        const token = String(request.headers.authorization ?? "").replace(
          /^Bearer /,
          "",
        );
        if (token.length < 20 || !owner.instanceKey)
          throw new ServiceError("LIVESHARE_UNAUTHORIZED", 401);
        let share = await this.store.one<LiveShare>(
          "SELECT * FROM live_shares WHERE native_id=?",
          id,
        );
        if (!share) {
          const intent = url.searchParams
            .getAll("allowedSubjectId")
            .find((value) => value.startsWith("ipollo-intent:"))
            ?.slice(14);
          share = await this.store.one<LiveShare>(
            "SELECT * FROM live_shares WHERE id=? AND native_id IS NULL AND created_at>?",
            intent ?? "",
            Date.now() - 300_000,
          );
          if (
            !share &&
            !intent &&
            url.searchParams.get("accessMode") === "open" &&
            url.searchParams.getAll("allowedSubjectId").length === 0
          ) {
            const sessionId = z
              .string()
              .min(1)
              .max(200)
              .parse(url.searchParams.get("sessionId"));
            const mode = z
              .enum(["view", "write"])
              .parse(url.searchParams.get("sessionMode") ?? "view");
            const title = z
              .string()
              .min(1)
              .max(4096)
              .parse(url.searchParams.get("sessionTitle") || sessionId);
            const key = uid();
            await this.store.run(
              "INSERT INTO live_shares(id,owner_id,source_session,mode,title,created_at,allows_fork,audience_json) VALUES(?,?,?,?,?,?,?,?)",
              key,
              owner.subjectId,
              sessionId,
              mode,
              title,
              Date.now(),
              url.searchParams.get("allowsFork") === "1" ? 1 : 0,
              JSON.stringify({ kind: "link" }),
            );
            share = await this.store.one<LiveShare>(
              "SELECT * FROM live_shares WHERE id=?",
              key,
            );
          }
          if (
            !share ||
            share.owner_id !== owner.subjectId ||
            share.source_session !== url.searchParams.get("sessionId") ||
            share.mode !== url.searchParams.get("sessionMode")
          )
            throw new ServiceError("LIVESHARE_INTENT_REQUIRED", 403);
          await this.admit(share, await this.actor(owner));
          await this.store.run(
            "UPDATE live_shares SET native_id=?,gateway_hash=?,instance_key=? WHERE id=?",
            id,
            hash(token),
            owner.instanceKey,
            share.id,
          );
          share.native_id = id;
          share.gateway_hash = hash(token);
          share.instance_key = owner.instanceKey;
        }
        if (
          share.revoked_at ||
          share.owner_id !== owner.subjectId ||
          share.instance_key !== owner.instanceKey ||
          share.gateway_hash !== hash(token) ||
          share.source_session !== url.searchParams.get("sessionId") ||
          share.mode !== url.searchParams.get("sessionMode")
        )
          throw new ServiceError("LIVESHARE_FORBIDDEN", 403);
        if (share.expires_at && share.expires_at <= Date.now())
          throw new ServiceError("LIVESHARE_EXPIRED", 401);
        const expiry = url.searchParams.get("expiresAt");
        if (expiry) {
          const timestamp = Date.parse(expiry);
          if (!Number.isFinite(timestamp) || timestamp <= Date.now())
            throw new ServiceError("LIVESHARE_EXPIRED", 401);
          await this.store.run(
            "UPDATE live_shares SET expires_at=? WHERE id=?",
            timestamp,
            share.id,
          );
          share.expires_at = timestamp;
        }
        await this.admit(share, await this.actor(owner));
        const bound = share;
        this.ws.handleUpgrade(request, socket, head, async (ws) => {
          this.sockets.get(id)?.socket.close(1000, "reconnected");
          const tunnel: Tunnel = {
            socket: ws,
            owner,
            pending: new Map(),
            nextId: 0,
            alive: true,
          };
          this.sockets.set(id, tunnel);
          ws.on("error", () => ws.close());
          ws.on("pong", () => {
            tunnel.alive = true;
          });
          ws.on("message", async (data) => {
            const parsed = z
              .object({
                type: z.literal("share-rpc-res"),
                id: z.number().int().positive(),
                status: z.number().int().min(200).max(599),
                body: z.unknown().optional(),
              })
              .safeParse(parseJSON(data.toString()));
            if (!parsed.success) {
              ws.close(1008, "invalid frame");
              return;
            }
            const pending = tunnel.pending.get(parsed.data.id);
            if (!pending) return;
            try {
              if (pending.grant)
                pending.actor = await this.actor(pending.grant);
              await this.admit(await this.share(id), pending.actor);
              await this.actor(owner);
              pending.finish({
                status: parsed.data.status,
                body: parsed.data.body,
              });
            } catch {
              pending.finish({
                status: 403,
                body: { error: "liveshare/access-revoked" },
              });
            }
          });
          ws.on("close", () => {
            if (this.sockets.get(id) === tunnel) this.sockets.delete(id);
            for (const pending of [...tunnel.pending.values()])
              pending.finish({
                status: 503,
                body: { error: "liveshare/offline" },
              });
          });
          try {
            await this.push(bound, tunnel);
          } catch (error) {
            ws.close(1011, "access check unavailable");
          }
        });
      } catch (error) {
        const status = error instanceof ServiceError ? error.status : 400;
        socket.end(
          `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
      }
    };
    server.on("upgrade", upgrade);
    const heartbeat = setInterval(() => {
      for (const tunnel of this.sockets.values()) {
        if (!tunnel.alive) tunnel.socket.terminate();
        else {
          tunnel.alive = false;
          tunnel.socket.ping();
        }
      }
    }, 30_000);
    heartbeat.unref();
    return () => {
      clearInterval(heartbeat);
      server.off("upgrade", upgrade);
    };
  }
  online(id: string): boolean {
    return this.sockets.get(id)?.socket.readyState === WebSocket.OPEN;
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      clearInterval(this.timer);
      for (const tunnel of this.sockets.values()) tunnel.socket.terminate();
      await this.refreshing;
      await new Promise<void>((resolve) => this.ws.close(() => resolve()));
    })());
  }
}

function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Input routes of the pinned DSH protocol; inspect both the HTTP target and its wire method. */
function requestsInput(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  const body =
    typeof request.body === "object" && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {};
  const denied = new Set([
    "session/prompt",
    "session/cancel",
    "session/fork",
    "session/rename",
    "fileUploads/upload",
  ]);
  return [request.path, request.endpoint, body.method].some((target) => {
    if (typeof target !== "string") return false;
    try {
      return denied.has(
        new URL(
          decodeURIComponent(target),
          "https://relay.invalid/",
        ).pathname.replace(/^\/(?:api\/)?/, ""),
      );
    } catch {
      return true;
    }
  });
}
