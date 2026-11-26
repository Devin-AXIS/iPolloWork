import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

    const bystander = await account("bystander");
    const otherInvite = await request(owner.token,base + "/invitations",{email:bystander.email});
    assert.equal((await request(bystander.token,"invitations/" + otherInvite.data.code + "/accept",{})).status,200);
    const shares = base + "/conversation-shares", shareId = randomUUID();
    const snapshot = { requestId:shareId, title:"Shared plan", recipients:[member.id],
      transcript:[{role:"user",content:"Project status?"},{role:"assistant",content:"The file is ready."}] };
    assert.equal((await request(owner.token,shares,{...snapshot,recipients:[stranger.id]})).data.code,"SHARE_RECIPIENT_INVALID");
    assert.equal((await request(owner.token,shares,snapshot)).status,201);
    assert.equal((await request(owner.token,shares,snapshot)).status,201);
    assert.equal((await request(member.token,shares)).data.items.length,1);
    assert.equal((await request(bystander.token,shares)).data.items.length,0);
    assert.equal((await request(bystander.token,shares + "/" + shareId)).status,404);
    assert.equal((await request(stranger.token,shares)).status,403);
    assert.deepEqual((await request(member.token,shares + "/" + shareId)).data.transcript,snapshot.transcript);
    const shareNotices = (await request(member.token,"me/organization-notices?include=all")).data.items;
    assert.equal(shareNotices.filter((row:{kind:string})=>row.kind==="conversation.shared").length,1);
    assert.equal(shareNotices.find((row:{kind:string})=>row.kind==="conversation.shared").target_id, shareId);
    assert.equal((await request(member.token,shares + "/" + shareId,undefined,"DELETE")).status,404);
    assert.equal((await request(owner.token,shares + "/" + shareId,undefined,"DELETE")).status,200);
    assert.equal((await request(member.token,shares + "/" + shareId)).status,404);
    const auditResult = await request(owner.token,base + "/activity?actor=OWNER");
    assert.ok(auditResult.data.items.some((row:{action:string})=>row.action==="conversation.share"));
    assert.ok(auditResult.data.items.every((row:{actor:string})=>row.actor==="owner"));
    assert.equal((await request(member.token,base + "/activity?actor=owner")).status,403);

    const parent = await request(owner.token,base + "/departments",{name:"Engineering"});
    const child = await request(owner.token,base + "/departments",{name:"Platform",parentId:parent.data.id});
    const cycle = await request(owner.token,base + "/departments/" + parent.data.id,{name:"Engineering",parentId:child.data.id},"PATCH");
    assert.equal(cycle.data.code,"DEPARTMENT_CYCLE");

    await service.store.run("UPDATE members SET department_id=? WHERE enterprise_id=? AND user_id=?",child.data.id,org.data.id,member.id);
    const audience = { all:false, departments:[], members:[] };
    const scopedSnapshot = (overrides: Partial<{all:boolean; departments:string[]; members:string[]; includeSubdepartments:boolean}>) =>
      ({ requestId:randomUUID(), title:snapshot.title, transcript:snapshot.transcript, audience:{...audience,...overrides} });
    const adminsOnly = scopedSnapshot({});
    await service.store.run("UPDATE members SET role='admin' WHERE enterprise_id=? AND user_id=?",org.data.id,bystander.id);
    assert.equal((await request(owner.token,shares,adminsOnly)).status,201);
    assert.equal((await request(bystander.token,shares + "/" + adminsOnly.requestId)).status,200);
    assert.equal((await request(member.token,shares + "/" + adminsOnly.requestId)).status,404);
    await service.store.run("UPDATE members SET role='member' WHERE enterprise_id=? AND user_id=?",org.data.id,bystander.id);
    const everyone = scopedSnapshot({all:true});
    assert.equal((await request(member.token,shares,everyone)).status,403);
    assert.equal((await request(owner.token,shares,everyone)).status,201);
    assert.equal((await request(member.token,shares + "/" + everyone.requestId)).status,200);
    assert.equal((await request(bystander.token,shares + "/" + everyone.requestId)).status,200);
    assert.equal((await request(stranger.token,shares + "/" + everyone.requestId)).status,403);
    const department = scopedSnapshot({departments:[parent.data.id],includeSubdepartments:true});
    assert.equal((await request(owner.token,shares,department)).status,201);
    assert.equal((await request(member.token,shares + "/" + department.requestId)).status,200);
    assert.equal((await request(bystander.token,shares + "/" + department.requestId)).status,404);
    const direct = scopedSnapshot({members:[bystander.id]});
    assert.equal((await request(member.token,shares,direct)).status,201);
    assert.equal((await request(bystander.token,shares + "/" + direct.requestId)).status,200);
    assert.equal((await request(owner.token,shares + "/" + direct.requestId)).status,404);
    await service.store.run("UPDATE members SET department_id=NULL WHERE enterprise_id=? AND user_id=?",org.data.id,member.id);

    const plugins = base + "/publications/plugin", templates = base + "/publications/template";
    const plugin = { title:"Team plugin", packageName:"@team/notes", description:"Shared notes", version:"1.2.3" };
    assert.equal((await request(stranger.token,plugins)).status,403);
    assert.equal((await request(member.token,plugins,{...plugin,version:"latest"})).data.code,'PUBLICATION_VERSION_INVALID');
    assert.equal((await request(member.token,plugins,{...plugin,title:'  '})).data.code,'PUBLICATION_TITLE_REQUIRED');
    assert.equal((await request(member.token,plugins,{...plugin,description:'  '})).data.code,'PUBLICATION_DESCRIPTION_REQUIRED');
    const added = await request(member.token,plugins,plugin);
    assert.equal(added.status,201);
    const item = plugins + "/" + added.data.id;
    const release = item + "/versions/" + plugin.version;
    assert.equal((await request(member.token,release)).status,403);
    assert.equal((await request(member.token,release,{decision:"approve"},"PUT")).status,403);
    assert.equal((await request(owner.token,release,{decision:"publish"},"PUT")).data.code,"PUBLICATION_REVIEW_REQUIRED");
    assert.equal((await request(owner.token,release,{decision:"approve",note:"Approved for the team"},"PUT")).status,200);
    assert.ok((await request(member.token,"me/organization-notices?include=all")).data.items.some(
      (row:{kind:string;target_tab:string;target_id:string})=>row.kind==="resource.approved" && row.target_tab==="plugins" && row.target_id===added.data.id,
    ));
    assert.equal((await request(owner.token,release,{decision:"publish"},"PUT")).status,200);
    assert.equal((await request(member.token,release)).status,403);
    const grantMember = async (kind: string, assetId: string) => {
      assert.equal((await request(owner.token,base + "/grants",{
        kind,assetId,audience:{all:false,departments:[],members:[member.id]},
      },"PUT")).status,200);
    };
    await grantMember("plugin", added.data.id);
    assert.deepEqual((await request(member.token,release)).data,{spec:"@team/notes@1.2.3"});
    assert.equal((await request(owner.token,base + "/grants",{
      kind:"plugin",assetId:added.data.id,audience:{all:false,departments:[child.data.id],members:[]},
    },"PUT")).status,200);
    assert.equal((await request(member.token,release)).status,403);

    const templateInput = {title:"Quarterly update",description:"A quarterly presentation",version:"2026-11 初版",html:"<h1>Quarterly update</h1>"};
    for (const version of ['', '..', 'x/y', 'x%2Fy', 'x\ny'])
      assert.equal((await request(owner.token,templates,{...templateInput,version})).data.code,'PUBLICATION_VERSION_LABEL_INVALID');
    const template = await request(owner.token,templates,templateInput);
    assert.equal(template.status,201);
    const templateRelease = templates + "/" + template.data.id + "/versions/" + encodeURIComponent(templateInput.version);
    assert.equal((await request(owner.token,templates,{...templateInput,id:template.data.id})).data.code,'PUBLICATION_VERSION_EXISTS');
    assert.equal((await request(member.token,templates)).data.items.length,0);
    assert.equal((await request(member.token,'me/organization-templates')).data.items.length,0);
    assert.equal((await request(owner.token,templateRelease,{decision:"approve"},"PUT")).status,200);
    const templatePath = templates + "/" + template.data.id;
    const personalAudience = {all:false, departments:[], members:[member.id]};
    const publishToMember = {decision:"publish", audience:personalAudience};
    for (const employee of [member, bystander])
      assert.equal((await request(owner.token,base + "/members/" + employee.id,
        {role:"member", departmentId:parent.data.id},"PATCH")).status,200);
    assert.equal((await request(member.token,templateRelease,publishToMember,"PUT")).status,403);
    assert.equal((await request(owner.token,templateRelease,
      {decision:"publish", audience:{...personalAudience, members:[stranger.id]}},"PUT")).data.code,"MEMBER_NOT_FOUND");
    const unreleased = (await request(owner.token,templatePath)).data;
    assert.equal(unreleased.publishedVersion,null);
    assert.deepEqual(unreleased.audience.members,[]);
    assert.equal((await request(owner.token,templateRelease,publishToMember,"PUT")).status,200);
    assert.deepEqual((await request(member.token,templateRelease)).data,{html:"<h1>Quarterly update</h1>"});
    assert.equal((await request(bystander.token,templateRelease)).status,403);
    assert.equal((await request(bystander.token,'me/organization-templates')).data.items.length,0);
    for (const employee of [member, bystander]) {
      const feed = (await request(employee.token,"me/organization-notices?include=all")).data.items;
      assert.equal(feed.some((row:{kind:string;target_id:string}) =>
        row.kind==="resource.published" && row.target_id===template.data.id), employee === member);
    }
    const grantedTemplates = await request(member.token,'me/organization-templates');
    assert.equal(grantedTemplates.data.items[0].id, template.data.id);
    assert.equal(grantedTemplates.data.items[0].version, templateInput.version);
    assert.equal((await request(stranger.token,'me/organization-templates')).data.items.length,0);

    const revised = { ...templateInput, id: template.data.id, version: "第二版", title: "Revised title", description: "Revised description" };
    const revisedPath = templatePath + "/versions/" + encodeURIComponent(revised.version);
    assert.equal((await request(owner.token, templates, revised)).status, 201);
    assert.equal((await request(member.token, templatePath)).data.title, templateInput.title);
    assert.equal((await request(bystander.token, templatePath)).status, 403);
    const pending = (await request(owner.token, templatePath + "/versions")).data.items.find((row:{version:string}) => row.version === revised.version);
    assert.equal(pending.title, revised.title);
    assert.equal(pending.description, revised.description);
    await request(owner.token, revisedPath, {decision:"approve"}, "PUT");
    await request(owner.token, revisedPath, {decision:"publish"}, "PUT");
    assert.equal((await request(member.token, templatePath)).data.title, revised.title);
    await request(owner.token, templateRelease, {decision:"publish"}, "PUT");
    assert.equal((await request(member.token, templatePath)).data.title, templateInput.title);

    const skills = base + "/publications/skill";
    const skill = await request(member.token,skills,{title:"Work notes",description:"Explain project notes",version:"v2 团队版",markdown:"Use the project notes."});
    assert.equal(skill.status,201);
    const skillVersion = skills + "/" + skill.data.id + "/versions/" + encodeURIComponent('v2 团队版');
    assert.equal((await request(member.token,"me/enterprise-skills")).data.items.length,0);
    assert.equal((await request(owner.token,skillVersion,{decision:"approve"},"PUT")).status,200);
    assert.equal((await request(owner.token,skillVersion,publishToMember,"PUT")).status,200);
    assert.equal((await request(member.token,"me/enterprise-skills")).data.items[0].content,"Use the project notes.");
    assert.equal((await request(bystander.token,"me/enterprise-skills")).data.items.length,0);

    const mcps = base + "/publications/mcp";
    const unassigned = await account("unassigned");
    const unassignedInvite = await request(owner.token,base + "/invitations",{email:unassigned.email});
    assert.equal((await request(unassigned.token,"invitations/" + unassignedInvite.data.code + "/accept",{})).status,200);
    const submission = {title:"Public docs",description:"Shared public documentation tools",version:"共享配置 初版",endpoint:"https://mcp.example.com/mcp"};
    assert.equal((await request(member.token,mcps,{...submission,endpoint:"http://127.0.0.1/mcp"})).status,400);
    assert.equal((await request(member.token,mcps,{...submission,key:"test-key"})).status,400);
    const submittedMcp = await request(member.token,mcps,submission);
    assert.equal(submittedMcp.status,201);
    const mcpItem = mcps + "/" + submittedMcp.data.id;
    const mcpVersion = mcpItem + "/versions/" + encodeURIComponent(submission.version);
    assert.equal((await request(member.token,mcpVersion,{decision:"approve"},"PUT")).status,403);
    assert.equal((await request(owner.token,mcpVersion,{decision:"publish"},"PUT")).data.code,"PUBLICATION_REVIEW_REQUIRED");
    assert.equal((await request(owner.token,mcpVersion,{decision:"approve"},"PUT")).status,200);
    assert.equal((await request(member.token,"me/enterprise-mcp")).data.items.length,0);
    assert.equal((await request(owner.token,mcpVersion,publishToMember,"PUT")).status,200);
    assert.deepEqual((await request(member.token,"me/enterprise-mcp")).data.items.map((row:{id:string})=>row.id),[submittedMcp.data.id]);
    assert.equal((await request(member.token,base + "/mcp")).data.items[0].endpoint,undefined);
    assert.equal((await request(unassigned.token,base + "/mcp")).data.items.length,0);
    assert.equal((await request(unassigned.token,mcpVersion)).status,403);
    assert.equal((await request(stranger.token,"me/enterprise-mcp")).data.items.length,0);
    assert.equal((await request(owner.token,mcpItem,undefined,"DELETE")).status,200);
    assert.equal((await request(member.token,"me/enterprise-mcp")).data.items.length,0);
    assert.equal((await request(owner.token,base + "/mcp/" + submittedMcp.data.id,{...submission,version:undefined,enabled:true},"PATCH")).data.code,"MCP_REVIEW_REQUIRED");

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
    const batchPath = base + "/join-codes/batch";
    const missingDepartment = await request(owner.token,batchPath,{
      csv:'名称,工号,部门名称\r\n"New\r\nname",0147,Platform\r\n\r\nMissing,0148,Development',
    });
    assert.equal(missingDepartment.status,400);
    assert.equal(missingDepartment.data.code,"DEPARTMENT_MISMATCH");
    assert.equal(missingDepartment.data.row,5);
    assert.match(missingDepartment.data.error,/Development/);
    const malformed = await request(owner.token,batchPath,{csv:"名称,工号\n\nMissing,"});
    assert.equal(malformed.data.code,"INVITATION_CSV_INVALID");
    assert.equal(malformed.data.row,3);
    assert.equal((await request(owner.token,batchPath,{csv:"名称,工号\n"})).data.code,"INVITATION_CSV_EMPTY");
    const duplicate = await request(owner.token,batchPath,{csv:"名称,工号\nFirst,A001\nSecond,a001"});
    assert.equal(duplicate.data.code,"INVITATION_DUPLICATE");
    assert.equal(duplicate.data.row,3);
    const rolledBack = await request(owner.token,batchPath,{
      csv:"名称,工号,部门名称\nFirst,0147,Development\nExisting number,0146,Platform",createMissingDepartments:true,
    });
    assert.equal(rolledBack.status,409);
    assert.equal(rolledBack.data.code,"INVITATION_EMPLOYEE_NUMBER_IN_USE");
    assert.equal(rolledBack.data.row,3);
    const afterRollback = (await request(owner.token,base)).data;
    assert.ok(!afterRollback.departments.some((row:{name:string})=>row.name === "Development"));
    assert.ok(!afterRollback.invitations.some((row:{employee_number:string})=>row.employee_number === "0147"));
    const createdDepartments = await request(owner.token,batchPath,{
      csv:"\uFEFF名称,工号,部门名称\r\nFirst,0147,Development\r\nSecond,0148,Development",createMissingDepartments:true,
    });
    assert.equal(createdDepartments.status,200);
    assert.deepEqual(createdDepartments.data.items.map((row:{employeeNumber:string})=>row.employeeNumber),["0147","0148"]);
    const departments = (await request(owner.token,base)).data.departments.filter((row:{name:string})=>row.name === "Development");
    assert.equal(departments.length,1);
    assert.equal(batchCode.data.items[0].email,undefined);
    assert.equal(batchCode.data.items[0].url,undefined);
    const batchPending = (await request(owner.token,base)).data.invitations.find((row:{id:string})=>row.id===batchCode.data.items[0].id);
    assert.equal(batchPending.expires_at,null);
    assert.equal((await request(owner.token,base + "/join-codes/batch",{
      csv:"名称,工号\nDuplicate,0146",
    })).status,409);
    const invitee = await account("new-colleague");
    assert.equal((await request(invitee.token,"invitations/" + batchCode.data.items[0].code + "/accept",{})).data.enterpriseId,org.data.id);
    assert.equal((await request(owner.token,base)).data.members.find((row:{user_id:string})=>row.user_id===invitee.id).employee_number,"0146");
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
