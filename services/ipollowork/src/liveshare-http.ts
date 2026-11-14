/** HTTP surface for project-bound native sharing; untrusted owner pages run in sandboxed frames. */
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Auth } from "./auth.js";
import type { App } from "./http.js";
import { uid } from "./domain.js";
import {
  readShareAudience,
  resolveShareAudience,
  shareAudienceSchema,
} from "./share-audience.js";
import { randomUUID } from "node:crypto";
import { ServiceError } from "./errors.js";
import { LiveshareRelay, sessionExpiry, type LiveShare } from "./liveshare.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const js = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const page = (title: string, body: string) =>
  `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · iPolloWork</title><style>html{color-scheme:light dark;font:15px system-ui}body{margin:0;background:light-dark(#fafafa,#171717);color:light-dark(#171717,#eee)}main{max-width:360px;margin:12vh auto;padding:24px}h1{font-size:24px;font-weight:600}p{line-height:1.65;opacity:.65}input,button{box-sizing:border-box;width:100%;padding:12px;margin:6px 0;border:1px solid #8885;border-radius:10px;background:transparent;color:inherit;font:inherit}button{background:light-dark(#171717,#eee);color:light-dark(white,#171717);cursor:pointer}iframe{border:0;width:100vw;height:100dvh;display:block}</style>${body}</html>`;

/** Mount account-owned authorization, management, and credential-scoped viewer routes. */
export function mountLiveshare(
  app: App,
  relay: LiveshareRelay,
  auth: Auth,
): void {
  const { store, config } = relay;
  app.get("/", async (c, next) => {
    const id = c.req.query("shareId");
    if (id === undefined) return await next();
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id))
      throw new ServiceError("LIVESHARE_NOT_FOUND", 404);
    return c.redirect("/s/" + encodeURIComponent(id));
  });
  const viewerPolicy = `sandbox allow-scripts allow-forms allow-downloads; default-src 'none'; script-src ${config.origin} 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src ${config.origin} 'unsafe-inline'; img-src ${config.origin} data: blob:; font-src ${config.origin} data:; connect-src ${config.origin}; worker-src blob:; base-uri ${config.origin}; form-action 'none'; frame-ancestors 'self'`;
  const carrier = readFileSync(
    new URL(
      import.meta.url.includes("/dist/")
        ? "./liveshare-carrier.js"
        : "../web/liveshare-carrier.js",
      import.meta.url,
    ),
    "utf8",
  );
  app.post("/api/v1/liveshare/authorize", async (c) => {
    const input = z
      .object({
        challenge: z.string().regex(/^[\w-]{43}$/),
        instanceKey: z.string().min(1).max(200),
      })
      .parse(await c.req.json());
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new ServiceError("SIGN_IN_REQUIRED", 401);
    const code = randomBytes(32).toString("base64url");
    await store.run("DELETE FROM live_codes WHERE expires_at<?", Date.now());
    await store.run(
      "INSERT INTO live_codes VALUES(?,?,?,?,?)",
      hash(code),
      session.session.id,
      input.challenge,
      input.instanceKey,
      Date.now() + 120_000,
    );
    return c.json({ code });
  });
  app.get("/__liveshare/owner-credential", async (c) => {
    const raw = c.req.header("x-liveshare-owner-credential");
    const credential = raw ? await relay.verify(raw, "owner") : undefined;
    return c.json({
      supported: true,
      ...(credential
        ? {
            ownerCredentialExpiresAt: new Date(
              credential.expiresAt,
            ).toISOString(),
          }
        : {}),
    });
  });
  app.post("/__liveshare/owner-credential", async (c) => {
    const input = z
      .object({
        code: z.string().max(200),
        code_verifier: z.string().min(43).max(128),
        instanceKey: z.string().max(200),
      })
      .parse(await c.req.json());
    const grant = await store.transaction(async () => {
      const row = await store.one(
        "SELECT * FROM live_codes WHERE hash=?",
        hash(input.code),
      );
      if (
        !row ||
        Number(row.expires_at) <= Date.now() ||
        row.challenge !== hash(input.code_verifier) ||
        row.instance_key !== input.instanceKey
      )
        throw new ServiceError("LIVESHARE_CODE_INVALID", 401);
      await store.run("DELETE FROM live_codes WHERE hash=?", hash(input.code));
      const user = await store.one(
        'SELECT s.id,s."userId",s."expiresAt",u.name,u.banned FROM session s JOIN "user" u ON u.id=s."userId" WHERE s.id=?',
        row.session_id,
      );
      if (!user || user.banned || !(sessionExpiry(user.expiresAt) > Date.now()))
        throw new ServiceError("SIGN_IN_REQUIRED", 401);
      return user;
    });
    const expiresAt = Math.min(
      sessionExpiry(grant.expiresAt),
      Date.now() + 86_400_000,
    );
    return c.json({
      credential: relay.sign({
        purpose: "owner",
        sessionId: String(grant.id),
        subjectId: String(grant.userId),
        displayName: String(grant.name),
        instanceKey: input.instanceKey,
        expiresAt,
      }),
      ownerCredentialExpiresAt: new Date(expiresAt).toISOString(),
    });
  });
  app.post("/api/v1/liveshare/intents", async (c) => {
    const input = z
      .object({
        projectId: z.string().min(1).max(200).optional(),
        audience: shareAudienceSchema.optional(),
        sessionId: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(4096),
        role: z.enum(["view", "participate"]),
        allowsFork: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const actor = c.get("actor");
    const audience = await resolveShareAudience(
      store,
      actor,
      input.audience,
      input.projectId,
    );
    const id = uid();
    await store.run(
      "DELETE FROM live_shares WHERE native_id IS NULL AND created_at<?",
      Date.now() - 300_000,
    );
    await store.run(
      "INSERT INTO live_shares(id,owner_id,project_id,source_session,mode,title,created_at,allows_fork,audience_json) VALUES(?,?,?,?,?,?,?,?,?)",
      id,
      actor.id,
      input.projectId ?? null,
      input.sessionId,
      input.role === "view" ? "view" : "write",
      input.title,
      Date.now(),
      (input.allowsFork ?? input.role === "participate") ? 1 : 0,
      JSON.stringify(audience),
    );
    return c.json({ intent: "ipollo-intent:" + id }, 201);
  });
  app.get("/api/v1/liveshare/shares", async (c) => {
    const actor = c.get("actor");
    const items = (
      await Promise.all(
        (
          await store.all<LiveShare>(
            "SELECT l.*,p.enterprise_id FROM live_shares l LEFT JOIN projects p ON p.id=l.project_id WHERE l.native_id IS NOT NULL AND l.revoked_at IS NULL ORDER BY l.created_at DESC LIMIT 1000",
          )
        ).map(async (share) => {
          try {
            const audience = readShareAudience(share);
            if (audience.kind === "link" && share.owner_id !== actor.id)
              return [];
            await relay.admit(share, actor);
            return [
              {
                enterpriseId:
                  audience.kind === "team" ||
                  audience.kind === "departments" ||
                  audience.kind === "members"
                    ? audience.enterpriseId
                    : (share.enterprise_id ?? null),
                shareId: share.native_id,
                projectId: share.project_id,
                sessionTitle: share.title,
                sessionMode: share.mode,
                ownerId: share.owner_id,
                online: relay.online(share.native_id!),
                link: config.origin + "/s/" + share.native_id,
              },
            ];
          } catch (error) {
            if (!(error instanceof ServiceError)) throw error;
            return [];
          }
        }),
      )
    ).flat();
    return c.json({ shares: items });
  });
  app.get("/api/v1/liveshare/shares/:id/audience", async (c) => {
    const share = await relay.share(c.req.param("id"));
    if (share.owner_id !== c.get("actor").id)
      throw new ServiceError("LIVESHARE_FORBIDDEN", 403);
    return c.json({ audience: readShareAudience(share) });
  });
  app.put("/api/v1/liveshare/shares/:id/audience", async (c) => {
    const share = await relay.share(c.req.param("id"));
    const actor = c.get("actor");
    if (share.owner_id !== actor.id)
      throw new ServiceError("LIVESHARE_FORBIDDEN", 403);
    const input = z
      .object({ audience: shareAudienceSchema })
      .parse(await c.req.json());
    const audience = await resolveShareAudience(
      store,
      actor,
      input.audience,
      share.project_id ?? undefined,
    );
    await store.run(
      "UPDATE live_shares SET audience_json=? WHERE id=?",
      JSON.stringify(audience),
      share.id,
    );
    await relay.refresh();
    return c.json({ audience });
  });
  app.get("/__liveshare/requests", async (c) =>
    c.json(
      await relay.snapshot(
        await relay.managed(
          c.req.query("shareId") ?? "",
          c.req.header("authorization") ?? "",
        ),
      ),
    ),
  );
  app.delete("/__liveshare/share", async (c) => {
    const share = await relay.managed(
      c.req.query("shareId") ?? "",
      c.req.header("authorization") ?? "",
    );
    await store.run(
      "UPDATE live_shares SET revoked_at=? WHERE id=?",
      Date.now(),
      share.id,
    );
    await relay.refresh();
    return c.json({ ok: true });
  });
  app.post("/__liveshare/share/claim", async (c) => {
    const share = await relay.managed(
      c.req.query("shareId") ?? "",
      c.req.header("authorization") ?? "",
    );
    const owner = await relay.verify(
      c.req.header("x-liveshare-owner-credential") ?? "",
      "owner",
    );
    if (
      share.owner_id !== owner.subjectId ||
      share.instance_key !== owner.instanceKey
    )
      throw new ServiceError("LIVESHARE_FORBIDDEN", 403);
    return c.json({
      claimed: true,
      ownerCredentialExpiresAt: new Date(owner.expiresAt).toISOString(),
    });
  });
  app.use("/__share/*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });
  app.use("/__liveshare/assets/*", async (c, next) => {
    c.header("Content-Security-Policy", viewerPolicy);
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cross-Origin-Resource-Policy", "cross-origin");
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  const viewer = async (token: string) => {
    const grant = await relay.verify(token, "viewer");
    const share = await relay.share(grant.shareId ?? "");
    const actor = await relay.actor(grant);
    await relay.admit(share, actor);
    return { share, actor, grant };
  };
  app.post("/__share/rpc", async (c) => {
    const { share, actor, grant } = await viewer(
      (c.req.header("authorization") ?? "").replace(/^Bearer /, ""),
    );
    if (c.req.query("shareId") !== share.native_id)
      throw new ServiceError("LIVESHARE_FORBIDDEN", 403);
    const answer = await relay.rpc(
      share,
      actor,
      await c.req.json(),
      c.req.raw.signal,
      grant,
    );
    return new Response(JSON.stringify(answer.body ?? null), {
      status: answer.status,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  });
  app.get("/__liveshare/assets/:ticket/*", async (c) => {
    const token = c.req.param("ticket"),
      { share, actor, grant } = await viewer(token);
    const prefix = "/__liveshare/assets/" + token + "/";
    const path = c.req.path.slice(prefix.length);
    if (path === "__liveshare/context")
      return c.json({
        ownerSubjectId: share.owner_id,
        viewer: { subjectId: actor.id, displayName: actor.name },
        capabilities: {
          online: relay.online(share.native_id!),
          sessionMode: share.mode,
          fork: { enabled: share.allows_fork === 1 },
        },
      });
    if (path === "health")
      return c.json({
        service: "ipollowork-services",
        release_id: "native-relay-v1",
      });
    const answer = await relay.rpc(
      share,
      actor,
      { op: "asset", path: path + new URL(c.req.url).search },
      c.req.raw.signal,
      grant,
    );
    const asset = z
      .object({ contentType: z.string(), base64: z.string() })
      .safeParse(answer.body);
    if (answer.status !== 200 || !asset.success)
      return c.json({ error: "LIVESHARE_ASSET_UNAVAILABLE" }, 404);
    let bytes = Buffer.from(asset.data.base64, "base64");
    if (path === "" || path === "index.html") {
      const target = {
        basePath: "",
        shareId: share.native_id,
        sessionId: share.source_session,
        readTimeoutMs: 65_000,
      };
      // The native document has an opaque sandbox origin. Only this share-scoped ticket is exposed.
      const boot = `<base href="${escape(config.origin + prefix)}"><script>(()=>{const relayOrigin=${js(config.origin)},ticket=${js(token)};for(const name of ['localStorage','sessionStorage']){const values=new Map();Object.defineProperty(globalThis,name,{value:{get length(){return values.size},getItem:k=>values.get(String(k))??null,setItem:(k,v)=>values.set(String(k),String(v)),removeItem:k=>values.delete(String(k)),clear:()=>values.clear(),key:i=>[...values.keys()][i]??null}})}const rawFetch=globalThis.fetch;globalThis.fetch=(input,init={})=>{const url=new URL(input instanceof Request?input.url:String(input),document.baseURI);if(url.pathname==='/__share/rpc'){const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+ticket);return rawFetch(url,{...init,headers,credentials:'omit'})}if(url.pathname==='/__liveshare/context')url.pathname=${js(prefix)}+'__liveshare/context';if(url.pathname==='/health')url.pathname=${js(prefix)}+'health';return rawFetch(url,{...init,credentials:'omit'})};${carrier}\ninstallNativeViewerCarrier(${js(target)});})();</script>`;
      const html = bytes.toString("utf8");
      bytes = Buffer.from(html.replace(/<head[^>]*>/i, (head) => head + boot));
    }
    return c.body(bytes, 200, { "Content-Type": asset.data.contentType });
  });
  app.get("/s/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    const share = await relay.share(c.req.param("id"));
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (
      (!session || session.user.banned) &&
      readShareAudience(share).kind !== "link"
    )
      return c.html(
        page(
          "登录后查看会话",
          '<main><h1>共享会话</h1><p>使用你的组织账号登录，继续项目中的工作。</p><form id="login"><input type="email" name="email" autocomplete="username" placeholder="邮箱" required><input type="password" name="password" autocomplete="current-password" placeholder="密码" required><button>登录</button><p id="error" role="status"></p></form></main><script src="/__liveshare/login.js"></script>',
        ),
      );
    const signedIn = session && !session.user.banned ? session : null;
    const actor = signedIn
      ? {
          id: signedIn.user.id,
          name: signedIn.user.name,
          email: signedIn.user.email,
          role: signedIn.user.role ?? "user",
        }
      : {
          id: "guest:" + randomUUID(),
          name: "Guest",
          email: "",
          role: "guest",
        };
    await relay.admit(share, actor);
    if (!relay.online(share.native_id!))
      return c.html(
        page(
          share.title,
          "<main><h1>" +
            escape(share.title) +
            '</h1><p>分享方当前离线，重新上线后可继续。</p><form method="get"><button>重试</button></form></main>',
        ),
      );
    const grant = relay.sign({
      purpose: "viewer",
      shareId: share.native_id!,
      sessionId: signedIn?.session.id ?? "",
      subjectId: actor.id,
      displayName: actor.name,
      ...(!signedIn ? { anonymous: true as const } : {}),
      expiresAt: Math.min(
        signedIn ? new Date(signedIn.session.expiresAt).getTime() : Infinity,
        Date.now() + 3_600_000,
      ),
    });
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'",
    );
    return c.html(
      page(
        share.title,
        `<iframe title="${escape(share.title)}" sandbox="allow-scripts allow-forms allow-downloads" referrerpolicy="no-referrer" src="/__liveshare/assets/${grant}/"></iframe>`,
      ),
    );
  });
  app.get("/__liveshare/login.js", (c) =>
    c.body(
      "document.querySelector('#login').addEventListener('submit',async e=>{e.preventDefault();const form=new FormData(e.target);const response=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.get('email'),password:form.get('password')})});if(response.ok)location.reload();else document.querySelector('#error').textContent='登录失败，请检查邮箱和密码。';});",
      200,
      { "Content-Type": "text/javascript" },
    ),
  );
}
