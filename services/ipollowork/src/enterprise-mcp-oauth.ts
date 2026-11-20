import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { Actor } from "./auth.js";
import type { Store } from "./database.js";
import type { App } from "./http.js";
import type { Settings } from "./settings.js";
import { now } from "./domain.js";
import { requireUse } from "./grants.js";
import { ServiceError } from "./errors.js";

const digest = (value:string) => createHash("sha256").update(value).digest("base64url");
const secret = () => randomBytes(32).toString("base64url");
const callbackPath = "/api/integrations/organization-mcp/callback";
export const mcpOAuthConfig = z.object({
  authorizationUrl:z.url().max(2048),
  tokenUrl:z.url().max(2048),
  clientId:z.string().trim().min(1).max(256),
  scope:z.string().trim().max(512).default(""),
}).strict();
const tokenResult = z.object({
  access_token:z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/),
  refresh_token:z.string().min(1).max(8192).optional(),
  expires_in:z.number().int().positive().max(31_536_000).optional(),
  token_type:z.string().refine(value=>value.toLowerCase() === "bearer"),
});
export type McpOAuthConfig = z.infer<typeof mcpOAuthConfig>;
export type OAuthTransport = (url:URL,method:string,headers:Record<string,string>,body:Buffer,signal:AbortSignal) => Promise<IncomingMessage>;
type Mcp = {id:string; enterprise_id:string; enabled:boolean; endpoint:string; oauth_config:string|null};
export const memberMcpToken = (id:string,user:string) => "enterprise-mcp-member/" + id + "/" + user;
export const mcpMemberCredentials = (id:string) => "enterprise-mcp-member/" + id + "/%";

/** An organization's account grant never leaves Work. Only the member's provider token reaches the MCP endpoint. */
export class EnterpriseMcpOAuth {
  constructor(
    private store:Store, private settings:Settings,
    private origin:string, private transport:OAuthTransport,
  ) {}

  private async usable(actor:Actor, id:string) {
    const row = await this.store.one<Mcp>("SELECT id,enterprise_id,enabled,endpoint,oauth_config FROM enterprise_mcp WHERE id=?",id);
    if (!row || !row.enabled || !row.oauth_config) throw new ServiceError("MCP_OAUTH_UNAVAILABLE",404,"该 MCP 未开启个人授权");
    await requireUse(this.store,actor,row.enterprise_id,"mcp",row.id);
    return row;
  }

  private async exchange(config:McpOAuthConfig, input:Record<string,string>) {
    const data = Buffer.from(new URLSearchParams({ ...input, client_id:config.clientId }).toString());
    const response = await this.transport(new URL(config.tokenUrl),"POST",{
      Accept:"application/json", "Content-Type":"application/x-www-form-urlencoded", "Content-Length":String(data.length),
    },data,AbortSignal.timeout(10_000)).catch(() => { throw new ServiceError("MCP_OAUTH_UNAVAILABLE",503,"MCP 授权服务暂时不可用"); });
    if (response.statusCode !== 200) {
      response.destroy();
      throw new ServiceError("MCP_OAUTH_REJECTED",422,"授权失败，请重新连接 MCP");
    }
    const chunks:Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of response) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 32768) throw new Error("Response too large");
        chunks.push(buffer);
      }
      return tokenResult.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      response.destroy();
      throw new ServiceError("MCP_OAUTH_REJECTED",422,"MCP 授权服务返回无效响应");
    }
  }

  private save(name:string, data:z.infer<typeof tokenResult>, previousRefresh?:string) {
    return this.settings.set(name,{
      accessToken:data.access_token,
      refreshToken:data.refresh_token ?? previousRefresh ?? "",
      expiresAt:String(data.expires_in ? now() + data.expires_in * 1000 : 0),
    });
  }

  async token(row:Mcp, actor:Actor):Promise<string> {
    return this.store.transaction(async () => {
      const name = memberMcpToken(row.id,actor.id);
      // Serialize rotating refresh tokens for this member across server processes.
      await this.store.one("SELECT key FROM settings WHERE key=? FOR UPDATE",name);
      const saved = await this.settings.get(name);
      if (saved.accessToken && (!Number(saved.expiresAt) || Number(saved.expiresAt) > now() + 1000)) return saved.accessToken;
      if (saved.refreshToken && row.oauth_config) {
        const data = await this.exchange(mcpOAuthConfig.parse(JSON.parse(row.oauth_config)),{
          grant_type:"refresh_token",refresh_token:saved.refreshToken,
        });
        await this.save(name,data,saved.refreshToken);
        return data.access_token;
      }
      throw new ServiceError("MCP_OAUTH_REQUIRED",401,"请在组织空间重新授权 MCP");
    });
  }

  mount(app:App) {
    app.post("/api/v1/me/enterprise-mcp/:mcpId/oauth",async c => {
      const actor=c.get("actor"), row=await this.usable(actor,c.req.param("mcpId"));
      const text = row.oauth_config!;
      const config=mcpOAuthConfig.parse(JSON.parse(text)), state=secret(), verifier=secret();
      await this.store.run(`INSERT INTO enterprise_mcp_oauth_pending(mcp_id,user_id,state_hash,verifier,configuration,expires_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(mcp_id,user_id) DO UPDATE SET state_hash=excluded.state_hash,verifier=excluded.verifier,configuration=excluded.configuration,expires_at=excluded.expires_at`,
      row.id,actor.id,digest(state),verifier,digest(row.endpoint+"\n"+text),now()+600_000);
      const url=new URL(config.authorizationUrl);
      for (const [key,value] of Object.entries({
        response_type:"code",client_id:config.clientId,redirect_uri:this.origin+callbackPath,
        state,code_challenge:digest(verifier),code_challenge_method:"S256",scope:config.scope,
      })) {
        if (value) url.searchParams.set(key,value);
      }
      return c.json({ authorizationUrl:url.href });
    });
    app.delete("/api/v1/me/enterprise-mcp/:mcpId/oauth",async c => {
      const actor=c.get("actor"), id=c.req.param("mcpId");
      await this.store.transaction(async()=>{
        await this.store.run("DELETE FROM enterprise_mcp_oauth_pending WHERE mcp_id=? AND user_id=?",id,actor.id);
        await this.store.run("DELETE FROM settings WHERE key=?",memberMcpToken(id,actor.id));
      });
      return c.json({ok:true});
    });
    app.get(callbackPath,async c => {
      c.header("Cache-Control","no-store");
      const { code,state }=z.object({code:z.string().min(1).max(4096),state:z.string().regex(/^[A-Za-z0-9_-]{43}$/)})
        .parse({code:c.req.query("code"),state:c.req.query("state")});
      const pending=await this.store.one<{mcp_id:string;user_id:string;verifier:string;configuration:string}>(
        "DELETE FROM enterprise_mcp_oauth_pending WHERE state_hash=? AND expires_at>? RETURNING mcp_id,user_id,verifier,configuration",
        digest(state),now(),
      );
      if (!pending) throw new ServiceError("MCP_OAUTH_EXPIRED",409,"授权已过期，请返回组织空间重新发起");
      const account=await this.store.one<{id:string;name:string;email:string;role:string|null;verified:boolean}>(
        'SELECT id,name,email,role,"emailVerified" AS verified FROM "user" WHERE id=? AND NOT COALESCE(banned,false)',pending.user_id,
      );
      if (!account) throw new ServiceError("SIGN_IN_REQUIRED",401);
      const actor:Actor={id:account.id,name:account.name,email:account.email,role:account.role ?? "user",emailVerified:account.verified};
      const row=await this.usable(actor,pending.mcp_id);
      const text=row.oauth_config!;
      if (digest(row.endpoint+"\n"+text) !== pending.configuration) throw new ServiceError("MCP_OAUTH_EXPIRED",409,"授权配置已变更，请重新发起");
      const data=await this.exchange(mcpOAuthConfig.parse(JSON.parse(text)),{
        grant_type:"authorization_code",code,code_verifier:pending.verifier,redirect_uri:this.origin+callbackPath,
      });
      await this.store.transaction(async()=>{
        const current=await this.store.one<Mcp>("SELECT id,enterprise_id,enabled,endpoint,oauth_config FROM enterprise_mcp WHERE id=? FOR SHARE",row.id);
        if (!current?.enabled || current.oauth_config !== text || current.endpoint !== row.endpoint) throw new ServiceError("MCP_OAUTH_EXPIRED",409);
        await requireUse(this.store,actor,current.enterprise_id,"mcp",current.id);
        const name=memberMcpToken(row.id,actor.id);
        await this.store.run("DELETE FROM settings WHERE key=?",name);
        await this.save(name,data);
      });
      return c.text("MCP 授权完成。请返回 iPolloWork 的组织空间并刷新。");
    });
  }
}
