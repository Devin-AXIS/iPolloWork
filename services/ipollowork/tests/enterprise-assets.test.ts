import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { Hono } from "hono";
import { createService } from "../src/app.js";
import { testConfig as loadConfig } from "./database.js";
import { ExecutionService } from "../src/execution.js";
import type { Actor } from "../src/auth.js";
import { isSharedMcpEndpoint, mountEnterpriseMcp } from "../src/enterprise-mcp.js";
import { ServiceError } from "../src/errors.js";
import type { App } from "../src/http.js";

const code = (expected: string) => (error: unknown) =>
  (error as { code?: string }).code === expected;

test("organization assets enforce member and department grants, and project owners can remove projects", async t => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-assets-"));
  const config = await loadConfig({
    DATA_DIR: dir,
    SERVICE_ORIGIN: "http://localhost:4785",
  });
  const service = await createService(config);
  let n = 0;
  const http = async <T = Record<string, unknown>>(
    path: string,
    token: string,
    body?: unknown,
    method?: string,
  ) => {
    const response = await service.app.request(config.origin + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "x-ipollo-peer-ip": "192.0.2." + (++n % 200),
        Authorization: "Bearer " + token,
        Origin: config.origin,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const type = response.headers.get("content-type") ?? "";
    return {
      status: response.status,
      data: (type.includes("json")
        ? await response.json()
        : await response.text()) as T,
    };
  };
  const account = async (email: string) => {
    const signup = await http<{ user: { id: string } }>(
      "/api/auth/sign-up/email",
      "",
      {
        email,
        name: email.split("@")[0],
        password: "Valid-testing-password-2026",
      },
    );
    await service.store.run(
      'UPDATE "user" SET "emailVerified"=true WHERE id=?',
      signup.data.user.id,
    );
    const signed = await http<{ token: string }>(
      "/api/auth/sign-in/email",
      "",
      { email, password: "Valid-testing-password-2026" },
    );
    return { id: signup.data.user.id, token: signed.data.token, email };
  };
  try {
    const owner = await account("owner@assets.test"),
      design = await account("design@assets.test"),
      sales = await account("sales@assets.test");
    const enterprise = (
      await http<{ id: string }>("/api/v1/enterprises", owner.token, {
        name: "Assets",
      })
    ).data.id;
    const dep = async (name: string) =>
      (
        await http<{ id: string }>(
          `/api/v1/enterprises/${enterprise}/departments`,
          owner.token,
          { name },
        )
      ).data.id;
    const designDep = await dep("设计部"),
      salesDep = await dep("销售部");
    for (const [member, department] of [
      [design, designDep],
      [sales, salesDep],
    ] as const) {
      await service.store.run(
        "INSERT INTO members VALUES(?,?,?,?,?)",
        enterprise,
        member.id,
        "member",
        department,
        Date.now(),
      );
    }
    const base = `/api/v1/enterprises/${enterprise}`;
    assert.equal((await http(base, design.token, { name: "Unauthorized rename" }, "PATCH")).status, 403);
    assert.equal((await http(base, owner.token, { name: "   " }, "PATCH")).status, 400);
    assert.deepEqual((await http(base, owner.token, { name: "  Assets team  " }, "PATCH")).data,
      { id: enterprise, name: "Assets team" });
    assert.equal((await http<{ enterprise: { name: string } }>(base, design.token)).data.enterprise.name, "Assets team");
    assert.equal((await service.store.all("SELECT target FROM audit WHERE action=? AND target=?", "enterprise.update", enterprise)).length, 1);

    const activeSessionExpiresAt = new Date(Date.now() + 27 * 86_400_000);
    await service.store.run('UPDATE "session" SET "expiresAt"=? WHERE "userId"=?', activeSessionExpiresAt, design.id);
    assert.equal((await http(base, design.token)).status, 200);
    assert.ok(await service.store.one('SELECT id FROM "session" WHERE "userId"=? AND "expiresAt">?', design.id, activeSessionExpiresAt));
    const websites = base + "/websites";
    const portal = { id: randomUUID(), label: "Design portal", url: "https://portal.example.test", departmentId: designDep, role: "member" };
    const target = websites + "/" + portal.id;
    assert.equal((await http(websites + "/manage", design.token)).status, 403);
    assert.equal((await http(websites + "/manage", sales.token, { revision: 0, items: [portal] }, "PUT")).status, 403);
    assert.equal((await http(websites + "/manage", owner.token, { revision: 0, items: [{ ...portal, url: "javascript:alert(1)" }] }, "PUT")).status, 400);
    assert.equal((await http(websites + "/manage", owner.token, { revision: 0, items: [{ ...portal, departmentId: randomUUID() }] }, "PUT")).status, 400);
    assert.equal((await http(websites + "/manage", owner.token, { revision: 0, items: [portal] }, "PUT")).status, 200);
    assert.equal((await http(websites + "/manage", owner.token, { revision: 0, items: [] }, "PUT")).status, 409);
    assert.deepEqual((await http(websites, design.token)).data, { items: [{ id: portal.id, label: portal.label }] });
    assert.deepEqual((await http(target, design.token)).data, { url: portal.url + "/" });
    assert.deepEqual((await http(websites, sales.token)).data, { items: [] });
    assert.equal((await http(target, sales.token)).status, 404);
    await service.store.run("UPDATE members SET role='admin' WHERE enterprise_id=? AND user_id=?", enterprise, design.id);
    assert.equal((await http(target, design.token)).status, 404);
    await service.store.run("UPDATE members SET role='member' WHERE enterprise_id=? AND user_id=?", enterprise, design.id);
    assert.equal((await http(websites + "/manage", owner.token, { revision: 1, items: [] }, "PUT")).status, 200);
    assert.equal((await http(target, design.token)).status, 404);

    const retiredDepartment = await dep("临时部门");
    const retiredPortal = { ...portal, id: randomUUID(), departmentId: retiredDepartment };
    assert.equal((await http(websites + "/manage", owner.token, { revision: 2, items: [retiredPortal] }, "PUT")).status, 200);
    assert.equal((await http(base + "/departments/" + retiredDepartment, owner.token, undefined, "DELETE")).status, 200);
    assert.equal((await http(websites + "/manage", owner.token, { revision: 3, items: [retiredPortal, portal] }, "PUT")).status, 200);
    assert.deepEqual((await http(websites, design.token)).data, { items: [{ id: portal.id, label: portal.label }] });

    const secured = { title:"Selected project", enterpriseId:enterprise, nativeId:"selected-test",
      access:{mode:"selected",grants:[{kind:"member",subjectId:design.id,role:"participate"}]} };
    const securedProject = await http<{id:string}>("/api/v1/projects/with-access",owner.token,secured);
    assert.equal(securedProject.status,201);
    const securedPath = "/api/v1/projects/" + securedProject.data.id;
    assert.equal((await http(securedPath + "/space", design.token)).status,200);
    assert.equal((await http(securedPath + "/space", sales.token)).status,403);
    assert.equal((await http("/api/v1/projects/with-access",owner.token,secured)).status,200);
    assert.equal((await http("/api/v1/projects/with-access",owner.token,{...secured,access:{mode:"selected",grants:[]}})).status,409);
    assert.equal((await http("/api/v1/projects/with-access",owner.token,{...secured,nativeId:"uncommitted",
      access:{mode:"selected",grants:[{kind:"member",subjectId:randomUUID(),role:"view"}]}})).status,400);
    assert.equal(await service.store.one("SELECT id FROM projects WHERE native_id='uncommitted'"), undefined);

    await service.store.run(`WITH synthetic AS (
      INSERT INTO "user"(id,name,email,"emailVerified")
      SELECT 'asset-roster-'||i,'Roster '||i,'roster-'||i||'@assets.test',true FROM generate_series(1,501) i RETURNING id
      ) INSERT INTO members(enterprise_id,user_id,role,created_at) SELECT ?,id,'member',? FROM synthetic`, enterprise, Date.now()+1000);
    const directory = await http<{items:{user_id:string}[];more:boolean}>(base+"/members",owner.token);
    assert.equal(directory.data.items.length,50);
    assert.equal(directory.data.more,true);
    const found = await http<{items:{user_id:string;project_role:string|null}[]}>(base+"/members?query=roster-501%40&projectId="+securedProject.data.id,owner.token);
    assert.deepEqual(found.data.items.map(row=>[row.user_id,row.project_role]),[["asset-roster-501",null]]);
    assert.equal((await http(securedPath+"/access",owner.token,{mode:"enterprise",grants:secured.access.grants},"PUT")).status,200);
    assert.equal((await http(securedPath+"/access",owner.token,[{subjectId:sales.id,role:null}],"PATCH")).status,200);
    assert.equal((await http(securedPath + "/space", sales.token)).status,403);
    assert.equal((await http(securedPath + "/space", design.token)).status,200);
    assert.equal((await http<{items:{user_id:string;project_role:string|null}[]}>(base+"/members?query=roster-501%40&projectId="+securedProject.data.id,owner.token))
      .data.items[0]?.project_role,"view");
    await service.store.run(`INSERT INTO audit(actor_id,action,target,created_at,enterprise_id)
      SELECT ?,'project.update',?,?,? FROM generate_series(1,102)`,owner.id,securedProject.data.id,Date.now(),enterprise);
    const auditPage = await http<{items:{id:string;action:string}[];next:string}>(base+"/activity",owner.token);
    assert.equal(auditPage.data.items.length,100);
    const older = await http<{items:{id:string;action:string}[]}>(base+"/activity?before="+auditPage.data.next,owner.token);
    assert.ok(older.data.items.some(row=>row.action==="project.access"));
    assert.ok(older.data.items.every(row=>!auditPage.data.items.some(newer=>newer.id===row.id)));

    await service.store.run("DELETE FROM members WHERE enterprise_id=? AND user_id LIKE ?",enterprise,"asset-roster-%");
    await service.store.run('DELETE FROM "user" WHERE id LIKE ?', "asset-roster-%");

    const pack = (
      await http<{ id: string }>(base + "/packages", owner.token, {
        title: "品牌素材",
        audience: { all: false, departments: [designDep], members: [] },
      })
    ).data.id;
    const form = new FormData();
    form.set(
      "file",
      new File(["logo-bytes"], "logo.svg", { type: "image/svg+xml" }),
    );
    const file = (
      await http<{ id: string }>(
        base + `/packages/${pack}/files`,
        owner.token,
        form,
      )
    ).data.id;
    assert.equal(
      (await http(base + `/packages/${pack}/files`, design.token, form)).status,
      403,
      "members cannot add files",
    );
    assert.equal((await http(base + `/packages/${pack}`, design.token, {title:'Changed'}, 'PATCH')).status,403);
    assert.equal((await http(base + `/packages/${pack}`, design.token, undefined, 'DELETE')).status,403);
    assert.equal((await http(base + `/packages/${pack}`, owner.token,
      {title:'品牌素材更新',description:'可下载的组织附件'}, 'PATCH')).status,200);
    const detail = await http<{package:{title:string;description:string};files:{id:string;name:string;bytes:number}[]}>(base + `/packages/${pack}`,owner.token);
    assert.equal(detail.data.package.title,'品牌素材更新');
    assert.equal(detail.data.package.description,'可下载的组织附件');
    assert.deepEqual(detail.data.files.map(item=>[item.id,item.name,item.bytes]),[[file,'logo.svg',10]]);
    const oversized = new FormData();
    oversized.set('file',new File([new Uint8Array(24*1024*1024+1)],'too-large.bin'));
    assert.equal((await http(base + `/packages/${pack}/files`,owner.token,oversized)).status,413);
    assert.equal((await http<{files:unknown[]}>(base + `/packages/${pack}`,owner.token)).data.files.length,1);
    const temporary = new FormData();
    temporary.set('file',new File(['remove-me'],'temporary.txt',{type:'text/plain'}));
    const temporaryFile = await http<{id:string}>(base + `/packages/${pack}/files`,owner.token,temporary);
    const temporaryPath = base + `/packages/${pack}/files/${temporaryFile.data.id}`;
    assert.equal((await http(temporaryPath,design.token,undefined,'DELETE')).status,403);
    assert.equal((await http(temporaryPath,owner.token,undefined,'DELETE')).status,200);
    assert.equal((await http(temporaryPath+'/download',owner.token)).status,404);

    const listed = async (token: string) =>
      (
        await http<{
          packages: { id: string }[];
          skills: { id: string; name: string }[];
        }>(base + "/assets", token)
      ).data;
    assert.deepEqual(
      (await listed(design.token)).packages.map((p) => p.id),
      [pack],
    );
    assert.deepEqual((await listed(sales.token)).packages, []);
    assert.equal(
      (
        await http(
          base + `/packages/${pack}/files/${file}/download`,
          design.token,
        )
      ).data,
      "logo-bytes",
    );
    assert.equal(
      (
        await http(
          base + `/packages/${pack}/files/${file}/download`,
          sales.token,
        )
      ).status,
      403,
    );
    assert.equal(
      (await http(base + `/packages/${pack}`, sales.token)).status,
      403,
    );

    // Signing an OSS download only uses local fixture credentials and never contacts OSS.
    const original = await service.store.one("SELECT storage_key FROM resources WHERE id=?", file);
    const signedKey = "oss/organization/" + enterprise + "/" + file;
    const packageDownload = base + `/packages/${pack}/files/${file}/download`;
    try {
      await service.settings.set("oss", { region: "oss-cn-hangzhou", bucket: "ipw-download-fixture",
        accessKeyId: "fixture-access-key", accessKeySecret: "fixture-secret" });
      await service.store.run("UPDATE storage_objects SET storage_key=? WHERE storage_key=?", signedKey, original!.storage_key);
      await service.store.run("UPDATE resources SET storage_key=? WHERE id=?", signedKey, file);
      const browserDownload = (token: string) => service.app.request(config.origin + packageDownload + "?redirect=1", {
        headers: { Authorization: "Bearer " + token, Origin: config.origin },
      });
      for (const token of [owner.token, design.token]) {
        const result = await browserDownload(token);
        assert.equal(result.status, 303);
        const location = new URL(result.headers.get("Location")!);
        assert.equal(location.hostname, "ipw-download-fixture.oss-cn-hangzhou.aliyuncs.com");
        assert.match(location.searchParams.get("response-content-disposition") ?? "", /logo\.svg/);
      }
      assert.equal((await browserDownload(sales.token)).status, 403);
      await service.store.run("UPDATE members SET role='admin' WHERE enterprise_id=? AND user_id=?", enterprise, sales.id);
      try {
        assert.equal((await browserDownload(sales.token)).status, 303);
      } finally {
        await service.store.run("UPDATE members SET role='member' WHERE enterprise_id=? AND user_id=?", enterprise, sales.id);
      }
      const desktopDownload = await http<{ url: string }>(packageDownload, design.token);
      assert.equal(desktopDownload.status, 200);
      assert.equal(new URL(desktopDownload.data.url).protocol, "https:");
    } finally {
      await service.store.run("UPDATE resources SET storage_key=? WHERE id=?", original!.storage_key, file);
      await service.store.run("UPDATE storage_objects SET storage_key=? WHERE storage_key=?", original!.storage_key, signedKey);
      await service.store.run("DELETE FROM settings WHERE key='oss'");
    }

    // A recipient's granted package must not disappear behind 200 newer private packages.
    await service.store.run(`INSERT INTO file_packages(id,enterprise_id,title,description,created_by,created_at,updated_at)
      SELECT 'hidden-package-'||i,?,'Private '||i,'',?,?,CAST(? AS BIGINT)+i FROM generate_series(1,200) i`,
      enterprise, owner.id, Date.now(), Date.now() + 1000);
    assert.deepEqual((await listed(design.token)).packages.map(item => item.id), [pack]);
    assert.deepEqual((await listed(sales.token)).packages, []);
    const observed = mock.method(service.store, 'all');
    try {
      const start = performance.now();
      const listing = await http<{ packages: unknown[] }>(base + "/assets", owner.token);
      assert.equal(listing.status, 200, JSON.stringify(listing.data));
      assert.equal(listing.data.packages.length, 200);
      const elapsed = Math.round(performance.now() - start);
      const grantReads = observed.mock.calls.filter(({ arguments: [sql] }) => /SELECT .*audience_kind.*FROM enterprise_grants/.test(sql));
      assert.equal(grantReads.length, 1);
      t.diagnostic(`200 file packages loaded in ${elapsed} ms with one audience query`);
    } finally { observed.mock.restore(); }

    const grant = await http<{ audience: { members: string[] } }>(
      base + "/grants",
      owner.token,
      {
        kind: "package",
        assetId: pack,
        audience: { all: false, departments: [designDep], members: [sales.id] },
      },
      "PUT",
    );
    assert.deepEqual(grant.data.audience.members, [sales.id]);
    assert.equal(
      (
        await http(
          base + `/packages/${pack}/files/${file}/download`,
          sales.token,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await http(
          base + "/grants",
          design.token,
          { kind: "package", assetId: pack, audience: { all: true } },
          "PUT",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await http(
          base + "/grants",
          owner.token,
          {
            kind: "package",
            assetId: pack,
            audience: { all: false, departments: [randomUUID()] },
          },
          "PUT",
        )
      ).status,
      400,
    );

    const skill = (
      await http<{ id: string; name: string }>(base + "/skills", owner.token, {
        title: "Brand voice",
        description: "Write in the brand voice",
        content: "# Brand voice\nUse short sentences.",
        audience: { all: false, departments: [salesDep], members: [] },
      })
    ).data;
    assert.equal(skill.name, "brand-voice");
    const mine = async (token: string) =>
      (
        await http<{
          items: { name: string; content: string; enterpriseName: string }[];
        }>("/api/v1/me/enterprise-skills", token)
      ).data.items;
    assert.deepEqual(
      (await mine(sales.token)).map((s) => [s.name, s.enterpriseName]),
      [["brand-voice", "Assets team"]],
    );
    assert.match((await mine(sales.token))[0]!.content, /short sentences/);
    assert.deepEqual(await mine(design.token), []);
    assert.equal(
      (await mine(owner.token)).length,
      1,
      "managers can use every skill",
    );

    const mcpInput = {
      title: "Shared MCP", endpoint: "https://mcp.example.com/tools", key: "test-bearer-credential",
      audience: { all: false, departments: [salesDep], members: [] },
    };
    assert.equal((await http(base + "/mcp", design.token, mcpInput)).status, 403);
    const mcp = await http<{ id: string }>(base + "/mcp", owner.token, mcpInput);
    assert.equal(mcp.status, 201);
    const mcpCatalog = "/api/v1/me/enterprise-mcp";
    assert.deepEqual((await http(mcpCatalog, design.token)).data.items, []);
    assert.match(JSON.stringify((await http(mcpCatalog, sales.token)).data), /Shared MCP/);
    assert.doesNotMatch(JSON.stringify((await http(base + "/mcp", sales.token)).data), /test-bearer-credential|\/tools/);
    assert.doesNotMatch(JSON.stringify(await service.store.one("SELECT value FROM settings WHERE key=?", "enterprise-mcp/" + mcp.data.id)),
      /test-bearer-credential/);

    const relay: App = new Hono();
    relay.use("*", (c, next) => {
      const user = c.req.header("x-test-user") === "sales" ? sales : design;
      c.set("actor", { id: user.id, email: user.email, name: user.email, role: "user" });
      return next();
    });
    relay.onError((error, c) => error instanceof ServiceError
      ? c.json({ code: error.code }, error.status) : c.json({ code: "UNEXPECTED" }, 500));
    let forwarded = 0;
    let upstreamStatus = 200;
    mountEnterpriseMcp(relay, service.store, service.settings, config.secret, async (url, method, headers) => {
      assert.equal(url.href, mcpInput.endpoint);
      assert.equal(method, "POST");
      assert.equal(headers.authorization, "Bearer test-bearer-credential");
      assert.equal(headers.cookie, undefined);
      assert.equal(headers["mcp-method"], "tools/list");
      assert.equal(headers["mcp-name"], "fixture-mcp");
      if (headers["mcp-session-id"]) assert.equal(headers["mcp-session-id"], "upstream-session");
      forwarded++;
      const response = new IncomingMessage(new Socket());
      response.statusCode = upstreamStatus;
      response.headers = { "content-type": "application/json", "mcp-session-id": "upstream-session" };
      response.push(upstreamStatus === 200 ? '{"jsonrpc":"2.0","id":1,"result":{}}' : '{"error":"upstream-private-details-test-bearer-credential"}');
      response.push(null);
      return response;
    });
    const connect = (user: string, session?: string) => relay.request(mcpCatalog + "/" + mcp.data.id + "/connect", {
      method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      headers: { "x-test-user": user, Cookie: "ignored", "mcp-method": "tools/list", "mcp-name": "fixture-mcp", ...(session ? { "mcp-session-id": session } : {}) },
    });
    const authorized = await connect("sales");
    const mcpSession = authorized.headers.get("mcp-session-id");
    assert.equal(authorized.status, 200);
    assert.ok(mcpSession && mcpSession !== "upstream-session");
    await authorized.text();
    assert.equal((await connect("design")).status, 403);
    assert.equal((await http(base + "/grants", owner.token, {
      kind: "mcp", assetId: mcp.data.id, audience: { all: true },
    }, "PUT")).status, 200);
    assert.equal((await connect("design", mcpSession)).status, 400);
    assert.equal(await (await connect("sales", mcpSession)).text(), '{"jsonrpc":"2.0","id":1,"result":{}}');
    assert.equal(forwarded, 2);
    for (const status of [400, 401, 403, 404, 405, 406, 409, 415, 422, 429, 500]) {
      upstreamStatus = status;
      const rejected = await connect("sales");
      assert.equal(rejected.status, status === 500 ? 503 : status);
      const text = await rejected.text();
      assert.doesNotMatch(text, /upstream-private-details|test-bearer-credential/);
      if (status === 401) assert.match(text, /MCP_UPSTREAM_UNAUTHORIZED/);
      if (status === 403) assert.match(text, /MCP_UPSTREAM_FORBIDDEN/);
      if (status === 429) assert.match(text, /MCP_UPSTREAM_RATE_LIMITED/);
    }
    const beforeRemoval = forwarded;
    assert.equal((await http(base + "/mcp/" + mcp.data.id, owner.token, undefined, "DELETE")).status, 200);
    assert.equal((await connect("sales", mcpSession)).status, 404);
    assert.equal(forwarded, beforeRemoval);

    const project = await http<{ id: string }>("/api/v1/projects", owner.token, {
      title: "Delete fixture project", enterpriseId: enterprise, nativeId: "fixture-workspace",
    });
    const projectPath = "/api/v1/projects/" + project.data.id;
    await service.store.run("INSERT INTO project_grants VALUES(?,?,?,?)", project.data.id, "member", design.id, "maintain");
    assert.equal((await http(projectPath, design.token, undefined, "DELETE")).status, 403);
    assert.equal((await http(projectPath, owner.token, undefined, "DELETE")).status, 200);
    assert.equal((await http(projectPath + "/space", owner.token)).status, 404);
    assert.equal((await service.store.one("SELECT native_id FROM projects WHERE id=?", project.data.id))?.native_id, null);
    assert.doesNotMatch(JSON.stringify((await http("/api/v1/projects", owner.token)).data), /Delete fixture project/);

    // Deleting a department unassigns its members and removes its grants.
    assert.equal(
      (
        await http(
          base + `/departments/${designDep}`,
          owner.token,
          undefined,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await service.store.one(
          "SELECT department_id FROM members WHERE user_id=?",
          design.id,
        )
      )?.department_id,
      null,
    );
    assert.deepEqual((await listed(design.token)).packages, []);
    assert.equal(
      (
        await http(
          base + `/departments/${salesDep}`,
          owner.token,
          { name: "大客户部" },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await http(
          base + `/members/${sales.id}`,
          owner.token,
          undefined,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await service.store.one(
          "SELECT COUNT(*) AS n FROM enterprise_grants WHERE audience_id=?",
          sales.id,
        )
      )?.n,
      0,
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("shared MCP destinations reject local hosts, embedded credentials and unsafe schemes", () => {
  assert.equal(isSharedMcpEndpoint("https://mcp.example.com/tools"), true);
  for (const endpoint of [
    "http://mcp.example.com", "https://127.0.0.1", "https://[::1]", "https://0x7f000001",
    "https://user:password@mcp.example.com", "https://mcp.example.com:8080",
    "https://mcp.internal", "https://mcp.example.com/?token=private", "https://mcp.example.com/#{secret}",
  ]) assert.equal(isSharedMcpEndpoint(endpoint), false, endpoint);
});

test("enterprise models use the enterprise key, follow grants, never charge points and stay out of official administration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-ent-models-"));
  const service = await createService(
    await loadConfig({
      DATA_DIR: dir,
      SERVICE_ORIGIN: "https://work.example.test",
    }),
  );
  try {
    const user = async (email: string, role = "user"): Promise<Actor> => {
      const signup = await service.auth.api.signUpEmail({
        body: {
          email,
          name: email.split("@")[0]!,
          password: "Valid-password-2026",
        },
      });
      return {
        id: signup.user.id,
        email,
        name: signup.user.name,
        role,
        emailVerified: true,
      };
    };
    const owner = await user("owner@models.test"),
      granted = await user("granted@models.test"),
      other = await user("other@models.test"),
      admin = await user("admin@models.test", "admin");
    const enterprise = randomUUID(),
      dep = randomUUID();
    await service.store.run(
      "INSERT INTO enterprises VALUES(?,?,?,?)",
      enterprise,
      "Models",
      owner.id,
      Date.now(),
    );
    await service.store.run(
      "INSERT INTO departments VALUES(?,?,?)",
      dep,
      enterprise,
      "研发部",
    );
    await service.store.run(
      "INSERT INTO members VALUES(?,?,?,?,?)",
      enterprise,
      owner.id,
      "owner",
      null,
      Date.now(),
    );
    await service.store.run(
      "INSERT INTO members VALUES(?,?,?,?,?)",
      enterprise,
      granted.id,
      "member",
      dep,
      Date.now(),
    );
    await service.store.run(
      "INSERT INTO members VALUES(?,?,?,?,?)",
      enterprise,
      other.id,
      "member",
      null,
      Date.now(),
    );
    const seen: { url: string; auth: string | null }[] = [];
    const gateway = new ExecutionService(
      service.store,
      service.settings,
      async (url, options) => {
        seen.push({
          url: String(url),
          auth: new Headers(options?.headers).get("authorization"),
        });
        return Response.json({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 12, completion_tokens: 7 } });
      },
    );
    await assert.rejects(
      async () =>
        await gateway.enterpriseSave(owner, enterprise, {
          title: "Local",
          baseUrl: "https://10.0.0.5/v1",
          key: "k",
          models: [],
        }),
      code("SERVICE_UPSTREAM_FORBIDDEN"),
    );
    await assert.rejects(
      async () =>
        await gateway.enterpriseSave(granted, enterprise, {
          title: "X",
          baseUrl: "https://llm.example.test/v1",
          key: "k",
          models: [],
        }),
      code("ENTERPRISE_FORBIDDEN"),
    );
    const { id } = await gateway.enterpriseSave(owner, enterprise, {
      title: "企业 DeepSeek",
      baseUrl: "https://llm.example.test/v1",
      key: "enterprise-secret",
      models: [
        {
          id: "deepseek-chat",
          name: "DeepSeek Chat",
          contextWindow: 65536,
          maxTokens: 4096,
        },
      ],
      audience: { all: false, departments: [dep], members: [] },
    });
    const projectId=randomUUID();
    await service.store.run("INSERT INTO projects(id,owner_id,enterprise_id,title,created_at,execution_mode) VALUES(?,?,?,?,?,'cloud')",projectId,owner.id,null,'Personal cloud',Date.now());
    assert.equal((await gateway.catalog(owner,projectId)).items.filter(item=>item.enterprise).length,0);
    await assert.rejects(gateway.invoke(owner,id,{requestId:randomUUID(),path:'/chat/completions',method:'POST',body:Buffer.from(JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:'hi'}]})).toString('base64')},projectId),{code:'CLOUD_MODEL_FORBIDDEN'});
    const catalog = async (actor: Actor) =>
      (await gateway.catalog(actor)).items.filter((item) => item.enterprise);
    assert.deepEqual(
      (await catalog(granted)).map((item) => [
        item.id,
        item.enterprise?.name,
        item.available,
      ]),
      [[id, "Models", true]],
    );
    assert.deepEqual(await catalog(other), []);
    assert.equal(
      (await gateway.admin(admin)).items.some((item) => item.id === id),
      false,
      "official administration excludes enterprise models",
    );
    await assert.rejects(
      async () =>
        await gateway.save(admin, {
          id,
          title: "Takeover",
          provider: "x",
          baseUrl: "https://evil.example/v1",
          keyId: "x",
          capabilities: ["chat"],
          routes: [{ method: "POST", path: "/chat/completions", points: 1 }],
        }),
      code("SERVICE_OWNED_BY_ENTERPRISE"),
    );
    const request = {
      requestId: randomUUID(),
      method: "POST",
      path: "/chat/completions",
      contentType: "application/json",
      body: Buffer.from('{"model":"deepseek-chat"}').toString("base64"),
    };
    const response = await gateway.invoke(granted, id, request);
    assert.equal(response.status, 200);
    await response.text();
    const usage = await service.store.one("SELECT enterprise_id,department_id,model_id,input_tokens,output_tokens FROM service_calls WHERE id=?", request.requestId);
    assert.deepEqual(usage, { enterprise_id: enterprise, department_id: dep, model_id: "deepseek-chat", input_tokens: 12, output_tokens: 7 });
    // The analytics screen must use the real gateway's persisted provider usage.
    const { mountEnterpriseAnalytics } = await import('../src/enterprise-analytics.js');
    const analytics = new Hono<{Variables:{actor:Actor}}>();
    analytics.use('*',async(c,next)=>{c.set('actor',owner);await next();});
    mountEnterpriseAnalytics(analytics,service.store);
    const statistics = await analytics.request(`http://localhost/api/v1/enterprises/${enterprise}/analytics`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days:30,groupBy:'department'}),
    });
    assert.equal(statistics.status,200);
    const counts = await statistics.json();
    assert.deepEqual(counts.totals,{tasks:1,succeeded:1,failed:0,measured:1,inputTokens:12,outputTokens:7,points:0});
    assert.equal(counts.rows[0].id,dep);
    assert.equal(seen.at(-1)?.auth, "Bearer enterprise-secret");
    assert.equal(
      (
        await service.store.one(
          "SELECT points FROM service_calls WHERE service_id=?",
          id,
        )
      )?.points,
      0,
    );
    await assert.rejects(
      gateway.invoke(other, id, { ...request, requestId: randomUUID() }),
      code("ASSET_FORBIDDEN"),
    );
    assert.equal(
      JSON.stringify(await gateway.enterpriseList(owner, enterprise)).includes(
        "enterprise-secret",
      ),
      false,
    );
    await assert.rejects(
      gateway.enterpriseProbe(owner, enterprise, {
        baseUrl: "https://llm.example.test/v1",
        serviceId: "official-deepseek",
      }),
      code("SERVICE_UNAVAILABLE"),
    );
    assert.equal(
      (
        await gateway.enterpriseProbe(owner, enterprise, {
          baseUrl: "https://llm.example.test/v1",
          serviceId: id,
        })
      ).ok,
      true,
    );
    await gateway.enterpriseRemove(owner, enterprise, id);
    assert.deepEqual(
      await catalog(granted),
      [],
      "a model with receipts is disabled instead of deleted",
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
