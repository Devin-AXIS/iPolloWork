import { test, expect } from "bun:test";
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renameArtifact, rewriteArtifactReferences } from "./artifact-rename.js";
import { recordSessionArtifact, listSessionArtifacts } from "./session-artifacts.js";
import { disposeTemplateStore } from "./templates.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

test("renames independent output, updates references and rejects collisions", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ipollowork-rename-test-")));
  const workspace: WorkspaceInfo = { id: "w", name: "Test", path: root, preset: "starter", workspaceType: "local" };
  const config: ServerConfig = { host:"127.0.0.1",port:0,token:"test",hostToken:"test",configPath:join(root,"server.json"),approval:{mode:"auto",timeoutMs:0},corsOrigins:[],workspaces:[workspace],authorizedRoots:[root],readOnly:false,startedAt:Date.now(),tokenSource:"generated",hostTokenSource:"generated",logFormat:"pretty",logRequests:false };
  try {
    await writeFile(join(root, "old.png"), "image");
    await writeFile(join(root, "page.html"), '<img src="./old.png"><p>old.png is a name</p>');
    const generation = { id: "image-result", kind: "image", model: "Test", completedAt: 100 } satisfies NonNullable<import("@ipollowork/types/workspace").SessionArtifact["generation"]>;
    await recordSessionArtifact(config, workspace, "session", "old.png", undefined, generation);
    expect((await renameArtifact(config, workspace, { sessionId: "session", path: "old.png", name: "new.png" })).path).toBe("new.png");
    expect(await readFile(join(root, "page.html"), "utf8")).toBe('<img src="./new.png"><p>old.png is a name</p>');
    expect((await listSessionArtifacts(config, "w", "session")).items).toEqual([expect.objectContaining({ path: "new.png", previousPaths: ["old.png"], generation })]);
    await writeFile(join(root, "occupied.png"), "keep");
    await expect(renameArtifact(config, workspace, { sessionId: "session", path: "new.png", name: "occupied.png" })).rejects.toMatchObject({code:"file_exists"});
    expect(await readFile(join(root,"occupied.png"),"utf8")).toBe("keep");
    await expect(renameArtifact(config, workspace, { sessionId: "session", path: "new.png", name: "../escape.png" })).rejects.toMatchObject({code:"invalid_name"});
    await expect(renameArtifact({...config,readOnly:true}, workspace, { sessionId: "session", path: "new.png", name: "readonly.png" })).rejects.toMatchObject({code:"read_only"});
    await mkdir(join(root,"video","session"),{recursive:true});
    const entry=join(root,"video","session","index.html");
    await writeFile(entry,"<html>keep</html>");
    for(const path of [entry,"video/session/index.html"])await expect(renameArtifact(config,workspace,{sessionId:"session",path,name:"renamed.html"})).rejects.toMatchObject({code:"studio_entry_rename_pending"});
    expect(await readFile(entry,"utf8")).toBe("<html>keep</html>");
  } finally { await disposeTemplateStore(config); await rm(root,{recursive:true,force:true}); }
});

test("reference rewriting preserves remote URLs and updates relative references", () => {
  const root=join(tmpdir(),"reference-test"), file=join(root,"pages","a.html"), from=join(root,"image.png"), to=join(root,"new.png");
  expect(rewriteArtifactReferences('<img src="../image.png?x=1"><img src="https://example.com/image.png">',file,from,to,root)).toBe('<img src="../new.png?x=1"><img src="https://example.com/image.png">');
  expect(rewriteArtifactReferences('<a href="../image.png?x=1#detail">',file,from,to,root)).toBe('<a href="../new.png?x=1#detail">');
});
