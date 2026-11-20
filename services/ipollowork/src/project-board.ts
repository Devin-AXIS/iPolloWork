import { z } from "zod";
import { agentKey, assignmentAgents, assignmentPeople, taskStatusSchema, taskWriteSchema, type ProjectTask, type TaskDraft, type TaskWrite, type TaskStatusWrite } from "./project-board-contract.js";
import { isEnterpriseManager, projectAccess, projectRole, uid } from "./domain.js";
import type { Store, Row } from "./database.js";
import { ServiceError } from "./errors.js";
import type { Actor } from "./auth.js";
import type { App } from "./http.js";
import { bodyLimit } from "hono/body-limit";
import { readShareAudience, type AudienceShare } from "./share-audience.js";

const route = "/api/v1/projects/:id/board";
const inbox = "/api/v1/project-board/notices";
const array = "ARRAY(SELECT jsonb_array_elements_text(?::jsonb))";
const blocked = `EXISTS(SELECT 1 FROM unnest(t.predecessors) b(id)
  LEFT JOIN project_board_tasks x ON x.project_id=t.project_id AND x.id=b.id
  WHERE x.status IS DISTINCT FROM 'done')`;
const columns = `t.id,t.revision,t.title,t.description,t.status,t.priority,t.start_at,t.due_at,
  CASE WHEN t.people_org_id=p.enterprise_id THEN t.assignee_id END AS assignee_id,
  CASE WHEN t.people_org_id=p.enterprise_id THEN to_json(t.participants)::text ELSE '[]' END AS participants,
  CASE WHEN t.people_org_id=p.enterprise_id THEN t.assignee_agent::text END AS assignee_agent,
  CASE WHEN t.people_org_id=p.enterprise_id THEN t.participant_agents::text ELSE '[]' END AS participant_agents,
  to_json(t.predecessors)::text AS predecessors,t.session_id,${blocked} AS blocked`;
const select = `SELECT ${columns} FROM project_board_tasks t JOIN projects p ON p.id=t.project_id`;
function taskOf(row: Row): ProjectTask {
  return {
    id: String(row.id), revision: Number(row.revision), title: String(row.title), description: String(row.description),
    status: row.status as ProjectTask["status"], priority: row.priority as ProjectTask["priority"],
    startAt: row.start_at as number | null, dueAt: row.due_at as number | null, assigneeId: row.assignee_id as string | null,
    assigneeAgent: row.assignee_agent === null ? null : JSON.parse(String(row.assignee_agent)),
    participantAgents: JSON.parse(String(row.participant_agents)),
    participantIds: JSON.parse(String(row.participants)), predecessorIds: JSON.parse(String(row.predecessors)),
    sessionId: row.session_id as string | null, blocked: row.blocked === true,
  };
}
async function task(store: Store, project: string, id: string) {
  const row = await store.one(select + " WHERE t.project_id=? AND t.id=?", project, id);
  return row && taskOf(row);
}
const eligible = `m.status='active' AND (p.access_mode='enterprise' OR p.owner_id=m.user_id OR m.role IN ('owner','admin') OR
 EXISTS(SELECT 1 FROM project_grants g WHERE g.project_id=p.id AND
 ((g.kind='member' AND g.subject_id=m.user_id) OR (g.kind='department' AND g.subject_id=m.department_id))))`;
async function eligiblePeople(store: Store, project: string, people: Set<string>) {
  if (!people.size) return new Set<string>();
  const rows = await store.all(`SELECT m.user_id FROM projects p JOIN members m ON m.enterprise_id=p.enterprise_id
    JOIN "user" u ON u.id=m.user_id WHERE p.id=? AND m.user_id=ANY(${array}) AND COALESCE(u.banned,false)=false
    AND ${eligible}`, project, JSON.stringify([...people]));
  return new Set(rows.map(row => String(row.user_id)));
}
async function conversationRecipients(store: Store, projectId: string, enterpriseId: string, ownerId: string, sessionId: string) {
  const recipients = new Set<string>();
  const shares = await store.all<Row & AudienceShare>(`SELECT owner_id,project_id,audience_json,mode FROM live_shares
    WHERE project_id=? AND owner_id=? AND source_session=? AND native_id IS NOT NULL
    AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)`, projectId, ownerId, sessionId, Date.now());
  for (const share of shares) {
    try {
      const audience = readShareAudience(share);
      if (audience.kind === "members" && audience.enterpriseId === enterpriseId)
        for (const id of audience.userIds) recipients.add(id);
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== "LIVESHARE_POLICY_INVALID") throw error;
    }
  }
  return recipients;
}
async function verifyGraph(store: Store, project: string, id: string, next: TaskDraft, previous?: ProjectTask) {
  if (next.predecessorIds.length) {
    const references = JSON.stringify(next.predecessorIds);
    const graph = await store.one(`WITH RECURSIVE graph(id) AS (
      SELECT unnest(${array})
      UNION SELECT unnest(t.predecessors) FROM project_board_tasks t JOIN graph g ON g.id=t.id WHERE t.project_id=?
    )
    SELECT EXISTS(SELECT 1 FROM graph WHERE id=?) AS cycle,
      (SELECT COUNT(*) FROM project_board_tasks WHERE project_id=? AND id=ANY(${array})) AS found,
      EXISTS(SELECT 1 FROM project_board_tasks WHERE project_id=? AND id=ANY(${array}) AND status<>'done') AS blocked`,
    references, project, id, project, references, project, references);
    if (graph?.cycle) throw new ServiceError("BOARD_DEPENDENCY_CYCLE", 409);
    if (graph?.found !== next.predecessorIds.length) throw new ServiceError("BOARD_PREDECESSOR_NOT_FOUND", 404);
    if (graph.blocked && next.status !== "todo") throw new ServiceError("BOARD_TASK_BLOCKED", 409);
  }
  if (previous?.status === "done" && next.status !== "done" && await store.one(
    `SELECT 1 FROM project_board_tasks WHERE project_id=? AND predecessors @> ARRAY[?]::text[] AND status<>'todo' LIMIT 1`,
    project, id,
  )) throw new ServiceError("BOARD_DEPENDENT_STARTED", 409);
}
type PendingNotice = { id: string; task_id: string; recipient_id: string; kind: "assigned" | "participating" | "ready" };
async function insertNotices(store: Store, project: string, organization: string, notices: PendingNotice[]) {
  if (!notices.length) return;
  await store.run(`INSERT INTO project_board_notices(id,project_id,task_id,enterprise_id,recipient_id,kind,created_at)
    SELECT n.id,?,n.task_id,?,n.recipient_id,n.kind,? FROM jsonb_to_recordset(?::jsonb)
      AS n(id text,task_id text,recipient_id text,kind text)`,
    project, organization, Date.now(), JSON.stringify(notices));
}

/** Project membership, task revisions, dependency transitions and inbox receipts share the same transaction. */
export function mountProjectBoard(app: App, store: Store) {
  app.use(route, bodyLimit({ maxSize: 64 * 1024, onError: c => c.json({ code: "BOARD_REQUEST_TOO_LARGE" }, 413) }));
  app.get(route, async c => {
    const project = await projectAccess(store,c.get("actor"),c.req.param("id"));
    if (c.req.query("members") === "1") {
      const members = await store.all(`SELECT m.user_id,u.name,u.email,
        CASE WHEN octet_length(u.image)<=1024 THEN u.image END AS avatar
        FROM projects p JOIN members m ON m.enterprise_id=p.enterprise_id
        JOIN "user" u ON u.id=m.user_id WHERE p.id=? AND COALESCE(u.banned,false)=false
        AND ${eligible} ORDER BY u.name,m.user_id LIMIT 500`, project.id);
      const actor = c.get("actor");
      const organization = project.enterprise_id ? await store.one("SELECT name FROM enterprises WHERE id=?", project.enterprise_id) : null;
      const canInvite = project.enterprise_id ? await isEnterpriseManager(store, actor, project.enterprise_id) : false;
      const sessionId = z.string().min(1).max(128).optional().parse(c.req.query("sessionId"));
      const recipients = sessionId && project.enterprise_id && await projectRole(store, actor, project) !== "view"
        ? await conversationRecipients(store, project.id, project.enterprise_id, actor.id, sessionId) : undefined;
      return c.json({
        members: recipients ? members.map(member => ({ ...member, canViewConversation: recipients.has(String(member.user_id)) })) : members,
        viewerId: actor.id, organizationName: organization?.name ?? null, canInvite,
      });
    }
    const id = z.uuid().optional().parse(c.req.query("task"));
    if (id) {
      const result = await task(store, project.id, id);
      if (!result) throw new ServiceError("BOARD_TASK_NOT_FOUND", 404);
      return c.json({ task: result });
    }
    const after = z.uuid().optional().parse(c.req.query("after"));
    const rows = await store.all(select + " WHERE t.project_id=? AND t.id>? ORDER BY t.id LIMIT 101",project.id,after ?? "");
    const tasks = rows.slice(0,100).map(taskOf);
    return c.json({ tasks, next:rows.length>100 ? tasks.at(-1)!.id : null });
  });
  async function update(actor: Actor, projectId: string, input: TaskWrite | TaskStatusWrite, noticeOrganization?: string) {
    return store.transaction(async () => {
      await store.run("SELECT id FROM projects WHERE id=? FOR UPDATE",projectId);
      const project = await projectAccess(store,actor,projectId);
      const previous = await task(store,projectId,input.id);
      const role = await projectRole(store,actor,project);
      if (noticeOrganization && (noticeOrganization !== project.enterprise_id || !previous ||
          !assignmentPeople(previous).has(actor.id))) throw new ServiceError("BOARD_WRITE_FORBIDDEN",403);
      if (!project.enterprise_id || !role || (role === "view" &&
          ("task" in input || !previous || !assignmentPeople(previous).has(actor.id))))
        throw new ServiceError("BOARD_WRITE_FORBIDDEN",403);
      if ((previous?.revision ?? 0) !== input.revision) throw new ServiceError("BOARD_CONFLICT",409);
      if (!("task" in input) && !previous) throw new ServiceError("BOARD_TASK_NOT_FOUND",404);
      const next: TaskDraft = "task" in input ? input.task : { ...previous!, status:input.status };
      const oldAgents = new Map((previous ? assignmentAgents(previous) : []).map(agent => [agentKey(agent), agent]));
      for (const agent of assignmentAgents(next)) {
        if (agent.ownerId !== actor.id && oldAgents.get(agentKey(agent))?.name !== agent.name)
          throw new ServiceError("BOARD_AGENT_UNAVAILABLE",403);
        if (!agent.ownerId) throw new ServiceError("BOARD_AGENT_UNAVAILABLE",403);
      }
      const people = assignmentPeople(next);
      const before = previous ? assignmentPeople(previous) : new Set<string>();
      const eligible = await eligiblePeople(store,projectId,people);
      // Existing assignments can survive the departure of a member, but no new invalid assignment can be made.
      if ([...people].some(id => !eligible.has(id) && !before.has(id))) throw new ServiceError("BOARD_ASSIGNEE_UNAVAILABLE",403);
      await verifyGraph(store,projectId,input.id,next,previous);
      const values = [next.title,next.description,next.status,next.priority,next.startAt,next.dueAt,
        project.enterprise_id,next.assigneeId,next.assigneeAgent ? JSON.stringify(next.assigneeAgent) : null,
        JSON.stringify(next.participantAgents ?? []),JSON.stringify(next.participantIds),JSON.stringify(next.predecessorIds),next.sessionId] as const;
      if (previous) await store.run(`UPDATE project_board_tasks SET title=?,description=?,status=?,priority=?,start_at=?,due_at=?,
        people_org_id=?,assignee_id=?,assignee_agent=?::jsonb,participant_agents=?::jsonb,participants=${array},predecessors=${array},session_id=?,revision=revision+1
        WHERE project_id=? AND id=?`,...values,projectId,input.id);
      else await store.run(`INSERT INTO project_board_tasks(title,description,status,priority,start_at,due_at,people_org_id,assignee_id,
        assignee_agent,participant_agents,participants,predecessors,session_id,project_id,id) VALUES(?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,${array},${array},?,?,?)`,...values,projectId,input.id);
      const notices: PendingNotice[] = [];
      function notify(taskId: string, recipientId: string, kind: PendingNotice["kind"]) {
        notices.push({ id: uid(), task_id: taskId, recipient_id: recipientId, kind });
      }
      const saved = (await task(store,projectId,input.id))!;
      for (const person of eligible) {
        if (person === next.assigneeId && person !== previous?.assigneeId)
          notify(input.id,person,"assigned");
        else if (!before.has(person))
          notify(input.id,person,"participating");
      }
      if (previous?.blocked && next.status === "todo" && !saved.blocked) {
        for (const person of eligible) notify(input.id,person,"ready");
      }
      if (previous?.status !== "done" && next.status === "done") {
        const ready = await store.all(`SELECT t.id,t.assignee_id,to_json(t.participants)::text AS participants
          FROM project_board_tasks t WHERE t.project_id=? AND t.people_org_id=? AND t.status='todo'
          AND t.predecessors @> ARRAY[?]::text[] AND NOT ${blocked}`, projectId,project.enterprise_id,input.id);
        const deliveries = ready.map(row => ({ id: String(row.id), people: assignmentPeople({
          assigneeId: row.assignee_id as string | null, participantIds: JSON.parse(String(row.participants)),
        }) }));
        const recipients = await eligiblePeople(store, projectId, new Set(deliveries.flatMap(row => [...row.people])));
        for (const row of deliveries) for (const person of row.people) {
          if (recipients.has(person)) notify(row.id, person, "ready");
        }
      }
      await insertNotices(store, projectId, project.enterprise_id, notices);
      return saved;
    });
  }
  app.patch(route, async c => {
    const input = z.union([taskWriteSchema, taskStatusSchema]).parse(await c.req.json());
    return c.json({ task: await update(c.get("actor"), c.req.param("id"), input) });
  });
  app.get(inbox, async c => {
    const actor=c.get("actor").id;
    const notices = await store.all(`SELECT n.id,n.project_id AS "projectId",p.title AS "projectTitle",n.task_id AS "taskId",t.title,
      n.kind,n.created_at AS "createdAt",n.read_at IS NOT NULL AS read FROM project_board_notices n
      JOIN projects p ON p.id=n.project_id AND p.enterprise_id=n.enterprise_id AND p.deleted_at IS NULL
      JOIN project_board_tasks t ON t.project_id=p.id AND t.id=n.task_id
      JOIN members m ON m.enterprise_id=n.enterprise_id AND m.user_id=n.recipient_id
      WHERE n.recipient_id=? AND ${eligible} ORDER BY n.created_at DESC,n.id DESC LIMIT 50`,actor);
    return c.json({ notices });
  });
  async function receivedTask(id: string, actor: Actor) {
    const linked = await store.one(`SELECT n.project_id,n.task_id,n.enterprise_id FROM project_board_notices n
      JOIN projects p ON p.id=n.project_id AND p.enterprise_id=n.enterprise_id
      JOIN members m ON m.enterprise_id=n.enterprise_id AND m.user_id=n.recipient_id
      WHERE n.id=? AND n.recipient_id=? AND p.deleted_at IS NULL AND ${eligible}`, id, actor.id);
    if (!linked) throw new ServiceError("BOARD_NOTICE_NOT_FOUND", 404);
    const projectId = String(linked.project_id);
    const item = await task(store, projectId, String(linked.task_id));
    if (!item) throw new ServiceError("BOARD_TASK_NOT_FOUND", 404);
    return { projectId, item, organization: String(linked.enterprise_id) };
  }
  function recipientTask(item: ProjectTask, actor: Actor) {
    const { title, description, status, priority, startAt, dueAt, blocked, revision } = item;
    return { title, description, status, priority, startAt, dueAt, blocked, revision,
      editable: assignmentPeople(item).has(actor.id) };
  }
  app.use(inbox + "/:id", bodyLimit({ maxSize: 1024, onError: c => c.json({ code: "BOARD_REQUEST_TOO_LARGE" }, 413) }));
  app.get(inbox + "/:id", async c => {
    const actor = c.get("actor");
    const { item } = await receivedTask(z.uuid().parse(c.req.param("id")), actor);
    return c.json({ task: recipientTask(item, actor) });
  });
  app.patch(inbox + "/:id", async c => {
    const actor = c.get("actor");
    const id = z.uuid().parse(c.req.param("id"));
    if (c.req.query("action") === "status") {
      const change = taskStatusSchema.omit({ id: true }).parse(await c.req.json());
      const { projectId, item, organization } = await receivedTask(id, actor);
      return c.json({ task: recipientTask(await update(actor, projectId, { ...change, id:item.id }, organization), actor) });
    }
    await store.run("UPDATE project_board_notices SET read_at=COALESCE(read_at,?) WHERE recipient_id=? AND id=?", Date.now(), actor.id, id);
    return c.json({ok:true});
  });
}
