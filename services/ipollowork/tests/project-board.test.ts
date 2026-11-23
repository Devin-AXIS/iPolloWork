import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {deliverBoardReminders} from '../src/project-board-reminders.ts';
import { createService } from "../src/app.js";
import type { BoardNotice, ProjectTask, TaskDraft } from "../src/project-board-contract.js";
import { testConfig } from "./database.js";

test("project tasks notify current recipients and serialize dependency transitions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ipw-board-"));
  const origin = "http://localhost:4785";
  const service = await createService(await testConfig({ DATA_DIR: directory, SERVICE_ORIGIN: origin }));
  try {
    async function account(name: string) {
      const body = { email: name + "@board.test", password: "Test-board-account-2026" };
      const { user } = await service.auth.api.signUpEmail({ body: { ...body, name } });
      const { token } = await service.auth.api.signInEmail({ body });
      return { id: user.id, token };
    }
    const [owner, assignee, participant, outsider] = await Promise.all([
      account("owner"), account("assignee"), account("participant"), account("outsider"),
    ]);
    const enterprise = randomUUID(), project = randomUUID(), otherProject = randomUUID();
    await service.store.run("INSERT INTO enterprises VALUES(?,?,?,?)", enterprise, "Team", owner.id, Date.now());
    for (const member of [owner, assignee, participant]) {
      await service.store.run("INSERT INTO members VALUES(?,?,?,NULL,?)", enterprise, member.id,
        member === owner ? "owner" : "member", Date.now());
    }
    for (const id of [project, otherProject]) {
      await service.store.run("INSERT INTO projects(id,owner_id,enterprise_id,title,created_at) VALUES(?,?,?,?,?)",
        id, owner.id, enterprise, "Project", Date.now());
    }
    const board = "/api/v1/projects/" + project + "/board";
    const notifications = "/api/v1/project-board/notices";
    let call = 0;
    function send(path: string, token = owner.token, update?: unknown) {
      return service.app.request(origin + path, {
        method: update ? "PATCH" : "GET",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "x-ipollo-peer-ip": "192.0.2." + ++call },
        ...(update ? { body: JSON.stringify(update) } : {}),
      });
    }
    const draft = (title: string, changes: Partial<TaskDraft> = {}): TaskDraft => ({
      title, description: "Scope", status: "todo", priority: "high", startAt: 1800000000000,
      dueAt: 1800000060000, assigneeId: null, participantIds: [], predecessorIds: [], sessionId: null, ...changes,
    });
    function write(id: string, task: TaskDraft, revision = 0) { return send(board, owner.token, { id, revision, task }); }
    async function getResult(response: Response): Promise<ProjectTask> {
      const body = await response.json() as { task: ProjectTask };
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.task;
    }
    async function notices(token: string) {
      const response = await send(notifications, token);
      assert.equal(response.status, 200);
      return ((await response.json()) as { notices: BoardNotice[] }).notices;
    }
    const avatar = "https://avatar.example/assignee.png";
    await service.store.run('UPDATE "user" SET image=? WHERE id=?', avatar, assignee.id);
    await service.store.run('UPDATE "user" SET image=? WHERE id=?', "x".repeat(1025), participant.id);
    const directoryResult = await send(board + "?members=1");
    assert.equal(directoryResult.status, 200);
    const directory = await directoryResult.json() as { organizationName: string; canInvite: boolean; members: { user_id: string; email: string; avatar: string | null }[] };
    assert.equal(directory.organizationName, "Team");
    assert.equal(directory.canInvite, true);
    assert.deepEqual(new Set(directory.members.map(member => member.user_id)), new Set([owner.id, assignee.id, participant.id]));
    assert(directory.members.every(member => member.email.endsWith("@board.test")));
    assert.equal(directory.members.find(member => member.user_id === assignee.id)?.avatar, avatar);
    assert.equal(directory.members.find(member => member.user_id === participant.id)?.avatar, null);
    const memberDirectory = await send(board + "?members=1", assignee.token);
    assert.equal((await memberDirectory.json() as { canInvite: boolean }).canInvite, false);
    assert.equal((await send(board + "?members=1", outsider.token)).status, 403);

    const sessionId = randomUUID();
    const audience = JSON.stringify({ kind: "members", enterpriseId: enterprise, userIds: [assignee.id] });
    const share = randomUUID();
    await service.store.run(`INSERT INTO live_shares(id,owner_id,project_id,source_session,mode,native_id,title,created_at,audience_json)
      VALUES(?,?,?,?,'view',?,'Review',?,?)`, share, owner.id, project, sessionId, randomUUID(), Date.now(), audience);
    const withRecipients = async (path: string, token = owner.token) => {
      const response = await send(path, token);
      assert.equal(response.status, 200);
      const { members } = await response.json() as { members: { user_id: string; canViewConversation?: boolean }[] };
      return members.filter(member => member.canViewConversation).map(member => member.user_id);
    };
    const current = board + "?members=1&sessionId=" + sessionId;
    assert.deepEqual(await withRecipients(current), [assignee.id]);
    assert.deepEqual(await withRecipients(current, participant.token), []);
    assert.deepEqual(await withRecipients(board + "?members=1&sessionId=" + randomUUID()), []);
    assert.deepEqual(await withRecipients(current.replace(project, otherProject)), []);
    await service.store.run("UPDATE live_shares SET expires_at=? WHERE id=?", Date.now() - 1, share);
    assert.deepEqual(await withRecipients(current), []);
    await service.store.run("UPDATE live_shares SET expires_at=NULL,revoked_at=? WHERE id=?", Date.now(), share);
    assert.deepEqual(await withRecipients(current), []);

    const first = randomUUID(), second = randomUUID(), dependent = randomUUID();
    await getResult(await write(first, draft("First")));
    await getResult(await write(second, draft("Second")));
    const agent = { id: randomUUID(), name: "Release specialist", ownerId: owner.id };
    const delegated = randomUUID();
    const assignedToAgent = draft("AI-led", { assigneeAgent: agent, participantIds: [participant.id] });
    const created = await getResult(await write(delegated, assignedToAgent));
    assert.deepEqual(created.assigneeAgent, agent);
    assert.equal((await write(randomUUID(), { ...assignedToAgent, assigneeAgent: { ...agent, ownerId: outsider.id } })).status, 403);
    assert.equal((await write(randomUUID(), { ...assignedToAgent, assigneeId: assignee.id })).status, 400);

    const plan = draft("Dependent", { assigneeId: assignee.id, participantIds: [participant.id], predecessorIds: [first, second] });
    assert.equal((await getResult(await write(dependent, plan))).blocked, true);
    assert.equal((await write(randomUUID(), { ...plan, assigneeId: outsider.id })).status, 403);
    assert.equal((await send("/api/v1/projects/" + otherProject + "/board", owner.token, {
      id: randomUUID(), revision: 0, task: { ...plan, assigneeId: null, participantIds: [] },
    })).status, 404);
    assert.equal((await send(board, outsider.token)).status, 403);
    assert.deepEqual((await notices(assignee.token)).map(notice => notice.kind), ["assigned"]);
    assert.equal((await notices(participant.token)).filter(notice => notice.kind === "participating").length, 2);
    assert.deepEqual(await notices(outsider.token), []);
    assert.equal((await send(board, owner.token, { id: dependent, revision: 1, status: "doing" })).status, 409);
    assert.equal((await write(first, draft("Cycle", { predecessorIds: [dependent] }), 1)).status, 409);
    await getResult(await send(board, owner.token, { id: first, revision: 1, status: "done" }));
    assert.equal((await notices(assignee.token)).length, 1);
    const completions = await Promise.all([1, 1].map(revision => send(board, owner.token, { id: second, revision, status: "done" })));
    assert.deepEqual(completions.map(response => response.status).sort(), [200, 409]);
    assert.equal((await getResult(await send(board + "?task=" + dependent, assignee.token))).blocked, false);
    const received = await notices(assignee.token);
    const ready = received.filter(notice => notice.kind === "ready");
    assert.equal(ready.length, 1);
    assert.equal((await notices(participant.token)).filter(notice => notice.kind === "ready").length, 1);
    const agentTaskNotice = (await notices(participant.token)).find(notice => notice.taskId === delegated)!;
    assert.equal((await send(notifications + "/" + agentTaskNotice.id + "?action=status",
      participant.token, { revision: 1, status: "doing" })).status, 200);
    assert.deepEqual((await getResult(await send(board + "?task=" + delegated))).assigneeAgent, agent);
    await send(notifications + "/" + ready[0]!.id, outsider.token, {});
    assert.equal((await notices(assignee.token)).find(notice => notice.id === ready[0]!.id)?.read, false);
    await send(notifications + "/" + ready[0]!.id, assignee.token, {});
    assert.equal((await notices(assignee.token)).find(notice => notice.id === ready[0]!.id)?.read, true);
    const receipt = notifications + "/" + ready[0]!.id;
    assert.equal((await send(receipt, outsider.token)).status, 404);
    assert.equal((await send(receipt, assignee.token)).status, 200);
    assert.equal((await send(receipt + "?action=status", assignee.token, { revision: 1, status: "doing" })).status, 200);
    assert.equal((await getResult(await send(board + "?task=" + dependent))).status, "doing");
    assert.equal((await send(board, owner.token, { id: first, revision: 2, status: "todo" })).status, 409);
    await service.store.run("UPDATE members SET status='suspended' WHERE enterprise_id=? AND user_id=?", enterprise, assignee.id);
    assert.deepEqual(await notices(assignee.token), []);
    // Lifecycle operations keep recoverable records and authorize every revision.
    const archivedId=randomUUID();
    await getResult(await write(archivedId,draft('Archive target')));
    assert.equal((await getResult(await send(board,owner.token,{id:archivedId,revision:1,action:'archive'}))).archived,true);
    assert(!(await (await send(board)).json() as {tasks:ProjectTask[]}).tasks.some(task=>task.id===archivedId));
    assert((await (await send(board+'?scope=archived')).json() as {tasks:ProjectTask[]}).tasks.some(task=>task.id===archivedId));
    const recycled=await getResult(await send(board,owner.token,{id:archivedId,revision:2,action:'delete'}));
    assert(recycled.deletedAt);
    assert.equal((await send(board,outsider.token,{id:archivedId,revision:3,action:'restore'})).status,403);
    assert((await (await send(board+'?scope=trash')).json() as {tasks:ProjectTask[]}).tasks.some(task=>task.id===archivedId));
    await getResult(await send(board,owner.token,{id:archivedId,revision:3,action:'restore'}));
    await getResult(await send(board,owner.token,{id:archivedId,revision:4,action:'unarchive'}));
    assert.equal((await send(board,owner.token,{id:archivedId,revision:1,action:'delete'})).status,409);
    assert.equal((await send(board,owner.token,{id:first,revision:2,action:'delete'})).status,409);

    // Full-search/count queries do not depend on which 100 cards the client has loaded.
    const many=Array.from({length:105},(_,index)=>({id:index===104?'ffffffff-ffff-4fff-8fff-ffffffffffff':randomUUID(),title:index===104?'Hidden needle':'Paged '+index,status:index%2?'done':'todo'}));
    await service.store.run(`INSERT INTO project_board_tasks(project_id,id,title,description,status,priority,people_org_id)
      SELECT ?,id,title,'',status,'normal',? FROM jsonb_to_recordset(?::jsonb) AS x(id text,title text,status text)`,project,enterprise,JSON.stringify(many));
    const searched=await (await send(board+'?query=needle')).json() as {tasks:ProjectTask[];totals:{total:number;done:number};version:number};
    assert.equal(searched.version,2);assert.deepEqual(searched.totals,{total:1,done:0});assert.equal(searched.tasks[0]!.title,'Hidden needle');
    const all=await (await send(board)).json() as {tasks:ProjectTask[];totals:{total:number;done:number};next:string};
    assert.equal(all.tasks.length,100);assert(all.totals.total>105);assert(all.next);
    assert(!(await (await send(board+'?query='+encodeURIComponent('%'))).json() as {tasks:ProjectTask[]}).tasks.length);

    // Deadline delivery is durable, permission-scoped and idempotent under concurrent workers.
    const dueId=randomUUID();
    await getResult(await write(dueId,draft('Due reminder',{startAt:null,dueAt:Date.now()-1000,assigneeId:owner.id,participantIds:[participant.id]})));
    await Promise.all([deliverBoardReminders(service.store),deliverBoardReminders(service.store)]);
    assert.equal((await notices(owner.token)).filter(item=>item.taskId===dueId&&item.kind==='due').length,1);
    assert.equal((await notices(participant.token)).filter(item=>item.taskId===dueId&&item.kind==='due').length,1);
    assert.equal((await notices(outsider.token)).length,0);
    await getResult(await send(board,owner.token,{id:dueId,revision:1,action:'archive'}));
    assert(!(await notices(owner.token)).some(item=>item.taskId===dueId));
    assert.equal((await send(receipt, assignee.token)).status, 404);
    assert.equal((await write(randomUUID(), { ...plan, predecessorIds: [] })).status, 403);
    const activeRoster = await (await send(board + "?members=1")).json() as typeof directory;
    assert(!activeRoster.members.some(member => member.user_id === assignee.id));
    await service.store.run("DELETE FROM members WHERE enterprise_id=? AND user_id=?", enterprise, assignee.id);
    assert.deepEqual(await notices(assignee.token), []);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
