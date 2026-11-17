import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";
import { mountEnterpriseMcp } from "../src/enterprise-mcp.js";
import { ServiceError } from "../src/errors.js";
import type { App } from "../src/http.js";

test("organization invitations, publication review, and member notices share existing membership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-org-publications-"));
  const config = await testConfig({ DATA_DIR:dir, SERVICE_ORIGIN:"http://localhost:4785" });
  const service = await createService(config);
  let peer = 0;
  const account = async (name: string) => {
    const email = name + "@example.test";
    const signed = await service.auth.api.signUpEmail({ body:{ email, name, password:"Test-password-2026!" } });
    assert.ok(signed.token);
    return { id:signed.user.id, token:signed.token, email };
  };
  const request = async (token: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
    const response = await service.app.request(config.origin + "/api/v1/" + path, {
      method,
      headers:{ Authorization:"Bearer " + token, Origin:config.origin, "Content-Type":"application/json", "x-ipollo-peer-ip":"192.0.2." + ++peer },
      body:body === undefined ? undefined : JSON.stringify(body),
    });
    return { status:response.status, data:await response.json() };
  };
  try {
    const owner = await account("owner"), member = await account("member"), stranger = await account("stranger");
    const org = await request(owner.token,"enterprises",{name:"Existing team"});
    const base = "enterprises/" + org.data.id;
    const invite = await request(owner.token,base + "/invitations",{email:member.email});
    assert.equal(invite.status,201);
    assert.equal(invite.data.serviceAddress,config.origin);
    assert.equal(invite.data.url,config.origin + "/invite/" + invite.data.code);
    const acceptance = "invitations/" + invite.data.code + "/accept";
    assert.equal((await request(stranger.token,acceptance,{})).status,403);
    assert.equal((await request(member.token,acceptance,{})).data.enterpriseId,org.data.id);
    assert.deepEqual((await request(member.token,"enterprises")).data.items.map((row:{id:string})=>row.id),[org.data.id]);

    const parent = await request(owner.token,base + "/departments",{name:"Engineering"});
    const child = await request(owner.token,base + "/departments",{name:"Platform",parentId:parent.data.id});
    const cycle = await request(owner.token,base + "/departments/" + parent.data.id,{name:"Engineering",parentId:child.data.id},"PATCH");
    assert.equal(cycle.data.code,"DEPARTMENT_CYCLE");

    const plugins = base + "/publications/plugin", templates = base + "/publications/template";
    const plugin = { title:"Team plugin", packageName:"@team/notes", description:"Shared notes", version:"1.2.3" };
    assert.equal((await request(stranger.token,plugins)).status,403);
    assert.equal((await request(member.token,plugins,{...plugin,version:"latest"})).status,400);
    const added = await request(member.token,plugins,plugin);
    assert.equal(added.status,201);
    const item = plugins + "/" + added.data.id;
    const release = item + "/versions/" + plugin.version;
    assert.equal((await request(member.token,release)).status,404);
    assert.equal((await request(member.token,release,{decision:"approve"},"PUT")).status,403);
    assert.equal((await request(owner.token,release,{decision:"publish"},"PUT")).data.code,"PUBLICATION_REVIEW_REQUIRED");
    assert.equal((await request(owner.token,release,{decision:"approve",note:"Approved for the team"},"PUT")).status,200);
    assert.equal((await request(owner.token,release,{decision:"publish"},"PUT")).status,200);
    assert.deepEqual((await request(member.token,release)).data,{spec:"@team/notes@1.2.3"});
    assert.equal((await request(owner.token,base + "/grants",{
      kind:"plugin",assetId:added.data.id,audience:{all:false,departments:[child.data.id],members:[]},
    },"PUT")).status,200);
    assert.equal((await request(member.token,release)).status,403);

    const template = await request(owner.token,templates,{title:"Quarterly update",version:"1.0.0",html:"<h1>Quarterly update</h1>"});
    assert.equal(template.status,201);
    const templateRelease = templates + "/" + template.data.id + "/versions/1.0.0";
    assert.equal((await request(member.token,templates)).data.items.length,0);
    assert.equal((await request(owner.token,templateRelease,{decision:"approve"},"PUT")).status,200);
    assert.equal((await request(owner.token,templateRelease,{decision:"publish"},"PUT")).status,200);
    assert.deepEqual((await request(member.token,templateRelease)).data,{html:"<h1>Quarterly update</h1>"});

    const skills = base + "/publications/skill";
    const skill = await request(member.token,skills,{title:"Work notes",description:"Explain project notes",version:"1.0.0",markdown:"Use the project notes."});
    assert.equal(skill.status,201);
    const skillVersion = skills + "/" + skill.data.id + "/versions/1.0.0";
    assert.equal((await request(member.token,"me/enterprise-skills")).data.items.length,0);
    assert.equal((await request(owner.token,skillVersion,{decision:"approve"},"PUT")).status,200);
    assert.equal((await request(owner.token,skillVersion,{decision:"publish"},"PUT")).status,200);
    assert.equal((await request(member.token,"me/enterprise-skills")).data.items[0].content,"Use the project notes.");

    const changed = await request(owner.token,base + "/members/" + member.id,{role:"member",departmentId:child.data.id,employeeNumber:"0007"},"PATCH");
    assert.equal(changed.status,200);
    assert.equal((await request(owner.token,base)).data.members.find((row:{user_id:string})=>row.user_id === member.id).employee_number,"0007");
    assert.deepEqual((await request(member.token,release)).data,{spec:"@team/notes@1.2.3"});
    assert.equal((await request(owner.token,base + "/grants",{kind:"plugin",assetId:added.data.id,
      audience:{all:false,departments:[parent.data.id],members:[],includeSubdepartments:true},
    },"PUT")).status,200);
    assert.equal((await request(member.token,release)).status,200,"Member inherits an explicit department-tree grant");
    const notices = "me/organization-notices";
    const notice = (await request(member.token,notices)).data.items[0];
    assert.equal(notice.kind,"department");
    assert.equal(notice.value,"Platform");
    assert.equal((await request(stranger.token,notices)).data.items.length,0);
    await request(stranger.token,notices,{ids:[notice.id]},"PUT");
    assert.equal((await request(member.token,notices)).data.items[0].read_at,null);
    assert.equal((await request(member.token,notices,{ids:[notice.id]},"PUT")).status,200);
    assert.notEqual((await request(member.token,notices)).data.items[0].read_at,null);
    assert.equal((await request(member.token,base + "/activity")).status,403);
    assert.equal((await request(member.token,base + "/join-codes",{})).status,403);
    assert.equal((await request(owner.token,base + "/join-codes",{role:"admin"})).status,400);
    const issued = await request(owner.token,base + "/join-codes",{departmentId:child.data.id,days:2});
    assert.equal(issued.status,201);
    assert.match(issued.data.code,/^ipw_[A-Za-z0-9_-]{43}$/);
    assert.equal(issued.data.serviceAddress,config.origin);
    assert.equal(issued.data.url,undefined);
    const permanent = await request(owner.token,base + "/join-codes",{displayName:"Permanent fixture"});
    assert.equal(permanent.status,201);
    assert.equal(permanent.data.expiresAt,null);
    const publicInfo = await service.app.request(config.origin + "/api/invitations/" + permanent.data.code);
    assert.equal(publicInfo.status,200);
    assert.equal((await publicInfo.json()).expiresAt,null);
    const expiryPath = base + "/join-codes/" + permanent.data.id;
    assert.equal((await request(member.token,expiryPath,{days:2},"PATCH")).status,403);
    assert.ok((await request(owner.token,expiryPath,{days:2},"PATCH")).data.expiresAt > Date.now());
    assert.equal((await request(owner.token,expiryPath,{days:null},"PATCH")).data.expiresAt,null);
    const permanentMember = await account("permanent-code-member");
    assert.equal((await request(permanentMember.token,"invitations/" + permanent.data.code + "/accept",{})).data.enterpriseId,org.data.id);
    assert.equal((await request(owner.token,expiryPath,{days:2},"PATCH")).status,409);
    assert.equal((await request(owner.token,base)).data.members.find((row:{user_id:string})=>row.user_id===permanentMember.id).name,"Permanent fixture");
    const join = "invitations/" + issued.data.code + "/accept";
    const codeMember = await account("code-member");
    assert.equal((await request(codeMember.token,join,{})).data.enterpriseId,org.data.id);
    assert.equal((await request(codeMember.token,join,{})).data.duplicate,true);
    assert.equal((await request(member.token,join,{})).status,409);
    const joined = (await request(owner.token,base)).data.members.find((row:{user_id:string})=>row.user_id===codeMember.id);
    assert.equal(joined.role,"member");
    assert.equal(joined.department_id,child.data.id);
    const batchCode = await request(owner.token,base + "/join-codes/batch",{
      csv:"名称,工号,邮箱,部门名称\nNew colleague,0146,old-address@example.test,Platform",
    });
    assert.equal(batchCode.status,200);
    assert.equal(batchCode.data.items[0].email,undefined);
    assert.equal(batchCode.data.items[0].url,undefined);
    const batchPending = (await request(owner.token,base)).data.invitations.find((row:{id:string})=>row.id===batchCode.data.items[0].id);
    assert.equal(batchPending.expires_at,null);
    assert.equal((await request(owner.token,base + "/join-codes/batch",{
      csv:"名称,工号\nDuplicate,0146",
    })).status,409);
    const invitee = await account("new-colleague");
    assert.equal((await request(invitee.token,"invitations/" + batchCode.data.items[0].code + "/accept",{})).data.enterpriseId,org.data.id);
    assert.ok((await request(owner.token,base + "/activity")).data.items.some((row:{action:string})=>row.action === "publication.publish"));
    assert.equal((await request(owner.token,base,{description:"An existing team",tabOrder:["plugins","templates"]},"PATCH")).status,200);
    assert.equal((await request(member.token,base)).data.enterprise.tab_order,'["plugins","templates"]');
    assert.equal((await request(owner.token,item,undefined,"DELETE")).status,200);
    assert.equal((await request(member.token,release)).status,404);

    const mcp = await request(owner.token,base + "/mcp",{title:"Shared tool",endpoint:"https://example.com/mcp",key:"private-key"});
    assert.equal(mcp.status,201);
    const mcpUpdate = {title:"Updated tool",description:"",endpoint:"https://example.org/connect",enabled:false};
    assert.equal((await request(member.token,base + "/mcp/" + mcp.data.id,mcpUpdate,"PATCH")).status,403);
    assert.equal((await request(owner.token,base + "/mcp/" + mcp.data.id,mcpUpdate,"PATCH")).status,200);
    assert.equal((await request(member.token,base + "/mcp")).data.items.length,0);
    assert.equal((await request(owner.token,"me/enterprise-mcp")).data.items.length,0);
    assert.equal(await service.store.one("SELECT key FROM settings WHERE key=?","enterprise-mcp/" + mcp.data.id),undefined);
    const oauth = await request(owner.token,base + "/mcp",{
      title:"Personal authorization",endpoint:"https://mcp.example.com/tools",
      oauth:{authorizationUrl:"https://auth.example.com/authorize",tokenUrl:"https://auth.example.com/token",clientId:"work-public-client"},
    });
    assert.equal(oauth.status,201);
    const oauthId = oauth.data.id;
    assert.equal((await request(member.token,"me/enterprise-mcp")).data.items.length,0);
    const startRoute = "/api/v1/me/enterprise-mcp/" + oauthId + "/oauth";
    const relay:App = new Hono();
    relay.use("*",async (c,next)=>{
      const person=c.req.header("x-test-user")==="stranger" ? stranger : member;
      c.set("actor",{id:person.id,email:person.email,name:"Fixture user",role:"user",emailVerified:true});
      await next();
    });
    relay.onError((error,c)=>error instanceof ServiceError ? c.json({code:error.code},error.status) : c.json({code:"UNKNOWN"},500));
    let providerRequests=0;
    mountEnterpriseMcp(relay,service.store,service.settings,config.secret,async(url,method,headers,body)=>{
      const resp=new IncomingMessage(new Socket());
      resp.statusCode=200;
      resp.headers={"content-type":"application/json"};
      if (url.host==="auth.example.com") {
        ++providerRequests;
        assert.equal(method,"POST");
        assert.equal(headers.authorization,undefined);
        const payload=new URLSearchParams(body?.toString());
        assert.equal(payload.get("code"),"test-code");
        assert.match(payload.get("code_verifier") ?? "",/^[A-Za-z0-9_-]{43}$/);
        resp.push(JSON.stringify({token_type:"Bearer",access_token:"provider-only-token",expires_in:600}));
      } else {
        assert.equal(url.host,"mcp.example.com");
        assert.equal(headers.authorization,"Bearer provider-only-token");
        resp.push('{"jsonrpc":"2.0","result":{},"id":1}');
      }
      resp.push(null);
      return resp;
    },config.origin);
    assert.equal((await relay.request(startRoute,{method:"POST",headers:{"x-test-user":"stranger"}})).status,403);
    const flow=await relay.request(startRoute,{method:"POST"});
    assert.equal(flow.status,200);
    const url=new URL((await flow.json()).authorizationUrl);
    const callback=new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state",url.searchParams.get("state")!);
    callback.searchParams.set("code","test-code");
    assert.equal((await relay.request(callback)).status,200);
    assert.equal((await relay.request(callback)).status,409);
    assert.equal(providerRequests,1);
    assert.equal((await request(member.token,"me/enterprise-mcp")).data.items[0].id,oauthId);
    assert.doesNotMatch(JSON.stringify((await request(member.token,base+"/mcp")).data),/provider-only-token/);
    const mcpProxy="/api/v1/me/enterprise-mcp/"+oauthId+"/connect";
    assert.equal((await relay.request(mcpProxy)).status,200);
    assert.equal((await relay.request(startRoute,{method:"DELETE"})).status,200);
    assert.equal((await relay.request(mcpProxy)).status,401);

    const roster=await request(owner.token,base+"/invitations/batch",{csv:'名称,工号,部门名称,角色\r\n"QA, User",0099,Platform,普通成员\r\n'});
    assert.equal(roster.status,200);
    assert.equal(roster.data.items[0].email,null);
    const rosterAccept="invitations/"+roster.data.items[0].code+"/accept";
    assert.equal((await request(stranger.token,rosterAccept,{})).data.enterpriseId,org.data.id);
    assert.equal((await request(member.token,rosterAccept,{})).status,409);
    const imported=(await request(owner.token,base)).data.members.find((row:{user_id:string})=>row.user_id===stranger.id);
    assert.equal(imported.name,"QA, User");
    assert.equal(imported.employee_number,"0099");
    const memberPath = base + "/members/" + member.id;
    const details = {role:"member",departmentId:child.data.id};
    assert.equal((await request(member.token,memberPath,{...details,status:"suspended"},"PATCH")).status,403);
    assert.equal((await request(owner.token,memberPath,{...details,status:"suspended"},"PATCH")).status,200);
    assert.equal((await request(owner.token,base)).data.members.find((row:{user_id:string})=>row.user_id===member.id).status,"suspended");
    assert.equal((await request(member.token,base)).status,403);
    assert.deepEqual((await request(member.token,"enterprises")).data.items,[]);
    assert.equal((await request(member.token,templateRelease)).status,403);
    assert.equal((await request(member.token,acceptance,{})).data.code,"MEMBER_SUSPENDED");
    assert.equal((await request(owner.token,memberPath,details,"PATCH")).status,200);
    const statusNotices = async (token:string) => (await request(token,notices + "?include=status")).data.items
      .filter((row:{kind:string})=>row.kind === "status").map((row:{value:string})=>row.value);
    assert.deepEqual(await statusNotices(member.token),["suspended"]);
    assert.deepEqual(await statusNotices(stranger.token),[]);
    assert.ok((await request(member.token,notices)).data.items.every((row:{kind:string})=>row.kind!=="status"));
    assert.equal((await request(owner.token,memberPath,{...details,status:"active"},"PATCH")).status,200);
    assert.deepEqual((await statusNotices(member.token)).sort(),["active","suspended"]);
    assert.equal((await request(member.token,templateRelease)).status,200);
    await request(owner.token,base + "/members/" + member.id,undefined,"DELETE");
    assert.equal((await request(member.token,templateRelease)).status,403);
    assert.ok((await request(member.token,notices)).data.items.some((row:{kind:string})=>row.kind === "removed"));
  } finally {
    await service.close();
    await rm(dir,{ recursive:true, force:true });
  }
});
