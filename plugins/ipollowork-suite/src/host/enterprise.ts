import { enterpriseAnalyticsSchema } from "../shared/enterprise-analytics.ts";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { AccountService } from "./account.ts";
import { SuiteError } from "./errors.ts";
import { linkProject, readProjectLink } from "./project-context.ts";
import { matchesProjectAccount, ProjectAccountMismatch } from "./project-account.ts";
import type {
  EnterpriseAssets,
  PackageDetail,
  EnterpriseModel,
  ModelProbe,
} from "../shared/enterprise.ts";
import type {
  Enterprise,
  EnterpriseCatalog,
  EnterpriseDetail,
  EnterpriseProject,
  ProjectRoster,
  ProjectBoardCall,
  SharePreview,
  SharedConversationDetail,
  ProjectWork,
  ProjectCollaboration,
  WorkDetail,
  ProjectUpdate,
} from "../shared/enterprise.ts";

import { serviceCategories } from "../shared/service-categories.ts";
const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(1).max(120);
const row = z.record(z.string(), z.unknown());
const audience = z
  .object({
    all: z.boolean(),
    departments: z.array(id).max(200),
    members: z.array(id).max(500),
  })
  .strict();
const description = z.string().trim().max(2000);
const modelEntry = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    category: z.enum(serviceCategories).optional(),
    contextWindow: z.number().int().min(1024).optional(),
    maxTokens: z.number().int().min(1).optional(),
  })
  .strict();
const httpUrl = z
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//.test(value));
const headerName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9-]*$/)
  .max(100);
const headerPrefix = z
  .string()
  .max(50)
  .refine((value) => !/[\r\n]/.test(value));
const key = z
  .string()
  .max(8192)
  .refine((value) => !/[\r\n]/.test(value));
const assetsResponse = z.object({
  canManage: z.boolean(),
  packages: z
    .array(
      z.object({
        id,
        title: z.string(),
        description: z.string(),
        fileCount: z.number(),
        bytes: z.number(),
        updatedAt: z.number(),
        audience,
      }),
    )
    .max(200),
  skills: z
    .array(
      z.object({
        id,
        title: z.string(),
        description: z.string(),
        name: z.string(),
        bytes: z.number(),
        updatedAt: z.number(),
        audience,
      }),
    )
    .max(200),
});
const packageResponse = z.object({
  package: z.object({
    id,
    title: z.string(),
    description: z.string(),
    audience,
  }),
  files: z
    .array(
      z.object({
        id,
        name: z.string(),
        bytes: z.number(),
        mime: z.string(),
        addedAt: z.number(),
        addedBy: z.string(),
      }),
    )
    .max(500),
});
const modelsResponse = z.object({
  items: z
    .array(
      z.object({
        id,
        title: z.string(),
        baseUrl: z.string(),
        models: z.array(modelEntry),
        category: z.enum(serviceCategories).default("language"),
        vendor: z.string().default("custom"),
        routes: z
          .array(
            z.object({
              method: z.enum(["GET", "POST"]),
              path: z.string(),
              points: z.number(), base: z.enum(["service", "origin"]).optional(), origin: z.url().optional(), jobField:z.string().optional(), jobResultField:z.string().optional(),
            }),
          )
          .optional(),
        enabled: z.boolean(),
        configured: z.boolean(),
        credentialMode: z.enum(["shared", "member"]).default("shared"),
        headerName: z.string(),
        headerPrefix: z.string(),
        audience,
      }),
    )
    .max(200),
});
const probeResponse = z.object({
  ok: z.boolean(),
  status: z.number(),
  latency: z.number(),
  reason: z.enum(["auth", "unreachable", "timeout", "upstream"]).optional(),
  models: z.array(z.string()).max(200),
});
const list = z.object({ items: z.array(row).max(500) });
const nullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : z.string().parse(value);
const string = (value: unknown): string => z.string().parse(value);
const number = (value: unknown): number => z.number().parse(value);
const organization = (r: Record<string, unknown>): Enterprise => ({
  id: string(r.id),
  name: string(r.name),
  role: typeof r.role === "string" ? r.role : "admin",
  memberCount: typeof r.member_count === "number" ? r.member_count : 0,
});
function projectWork(r: Record<string, unknown>): ProjectWork {
  return {
    id: string(r.id),
    projectId: string(r.project_id),
    projectTitle: string(r.project_title),
    enterpriseId: nullableString(r.enterprise_id),
    enterpriseName: nullableString(r.enterprise_name),
    sourceShareId: string(r.source_share_id),
    ownerId: string(r.owner_id),
    ownerName: string(r.owner_name),
    title: string(r.title),
    version: number(r.version),
    resultTitle: nullableString(r.result_title),
    updatedAt: number(r.updated_at),
    canPublish: z.boolean().parse(r.canPublish),
    ...(r.native_session_id
      ? { nativeSessionId: string(r.native_session_id) }
      : {}),
    ...(r.native_workspace_id
      ? { nativeWorkspaceId: string(r.native_workspace_id) }
      : {}),
  };
}
function projectUpdate(r: Record<string, unknown>): ProjectUpdate {
  return {
    id: string(r.id),
    workId: string(r.work_id),
    version: number(r.version),
    title: string(r.title),
    authorName: string(r.author_name),
    createdAt: number(r.created_at),
  };
}
export interface EnterpriseNative {
  workspaceRegistry: {
    readonly archivedSessionIds?: readonly string[];
    list(): {
      id: string;
      title: string;
      path: string;
      sessionIds: readonly string[];
    }[];
  };
  sessionQuery: {
    readSurface(
      sessionId: string,
    ): Promise<{ events: readonly { type: string; data: unknown }[] }>;
  };
}

/** Uses native workspace identities and shares only an explicitly reviewed text snapshot. */
export class EnterpriseService {
  constructor(
    private account: AccountService,
    private native: EnterpriseNative,
    private origin: string,
  ) {}
  private cloud(path: string, data?: unknown, method?: string) {
    return this.account.request("/api/v1/" + path, data, method);
  }
  private async signedIn() {
    const state = await this.account.state();
    if (state.status !== "signed-in")
      throw new SuiteError("IPW_SIGN_IN_REQUIRED", 401);
    return state.user.id;
  }
  /** Join native workspaces with the caller's own cloud project records. */
  private localProjects(
    userId: string,
    enterprises: Enterprise[],
    projects: unknown,
  ): EnterpriseProject[] {
    const ownProjects = list
      .parse(projects)
      .items.filter((p) => p.owner_id === userId);
    return this.native.workspaceRegistry.list().map((p) => {
      const record = ownProjects.find((item) => item.native_id === p.id);
      const enterpriseId = record ? nullableString(record.enterprise_id) : null;
      return {
        id: p.id,
        title: p.title,
        path: p.path,
        sessionIds: [...p.sessionIds],
        cloudId: record ? string(record.id) : null,
        enterpriseId,
        enterpriseName:
          enterprises.find((e) => e.id === enterpriseId)?.name ?? null,
      };
    });
  }
  async catalog(): Promise<EnterpriseCatalog> {
    const userId = await this.signedIn();
    const [organizations, projects, shares, workRows, projectRows] =
      await Promise.all([
        this.cloud("enterprises"),
        this.cloud("projects"),
        Promise.resolve({ items: [] }),
        Promise.resolve({ items: [] }),
        this.cloud("projects"),
      ]);
    const enterprises = list.parse(organizations).items.map(organization);
    return {
      serviceOrigin: this.origin,
      userId,
      enterprises,
      work: list.parse(workRows).items.map(projectWork),
      sharedProjects: list.parse(projectRows).items.map((r) => ({
        executionMode: r.execution_mode === "cloud" ? "cloud" : "local",
        id: string(r.id),
        title: string(r.title),
        enterpriseId: nullableString(r.enterprise_id),
        enterpriseName: nullableString(r.enterprise_name),
      })),
      projects: this.localProjects(userId, enterprises, projects),
      shares: list.parse(shares).items.map((r) => ({
        id: string(r.id),
        title: string(r.title),
        projectId: string(r.project_id),
        projectTitle: string(r.project_title),
        enterpriseId: nullableString(r.enterprise_id),
        enterpriseName: nullableString(r.enterprise_name),
        ownerId: string(r.owner_id),
        createdAt: number(r.created_at),
      })),
    };
  }
  private async boardProject(workspaceId: string, signal: AbortSignal) {
    const workspace = this.native.workspaceRegistry.list().find(item => item.id === workspaceId);
    if (!workspace || this.account.cloudOnly) return null;
    const generation = this.account.generation;
    const link = await readProjectLink(workspace.path, signal);
    if (link && !matchesProjectAccount(link.origin, this.origin)) throw new ProjectAccountMismatch();
    let projectId = link ? id.parse(link.projectId) : undefined;
    if (!projectId) {
      // Older owned workspaces may have a server record before a local link was written.
      const records = await this.account.request("/api/v1/projects", undefined, "GET", signal).catch(error => {
        if (error instanceof SuiteError && error.status === 401) return { items: [] };
        throw error;
      });
      const record = list.parse(records).items.find(item => item.native_id === workspace.id && item.enterprise_id);
      if (!record) return null;
      projectId = id.parse(record.id);
    }
    const { project } = z.object({ project: z.object({
      enterpriseId: id.nullable(), role: z.enum(["view", "participate", "maintain"]),
    }) }).parse(await this.account.request("/api/v1/projects/" + projectId + "/space", undefined, "GET", signal));
    if (!project.enterpriseId) return null;
    if (generation !== this.account.generation) throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
    return { projectId, enterpriseId: project.enterpriseId, canAssign: project.role !== "view" };
  }
  async projectBoard(call: ProjectBoardCall, signal: AbortSignal): Promise<unknown> {
    const generation = this.account.generation;
    const request = async (path: string, payload?: unknown, method: "GET" | "PATCH" = "GET") => {
      if (generation !== this.account.generation) throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
      const result = await this.account.request(path, payload, method, signal, { maximum: 8 * 1024 * 1024 });
      if (generation !== this.account.generation) throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
      return result;
    };
    if (call.operation === "inbox") return request("/api/v1/project-board/notices");
    if ("noticeId" in call) {
      const path = "/api/v1/project-board/notices/" + id.parse(call.noticeId);
      if (call.operation === "notice-status") return request(path + "?action=status", call.payload, "PATCH");
      return call.operation === "read" ? request(path, {}, "PATCH") : request(path);
    }
    if (this.account.cloudOnly) throw new SuiteError("BOARD_SERVICE_UNAVAILABLE", 503);
    const project = await this.boardProject(call.workspaceId, signal);
    if (generation !== this.account.generation) throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
    if (!project) return null;
    const path = "/api/v1/projects/" + project.projectId + "/board";
    if (call.operation === "write") return request(path, call.payload, "PATCH");
    const query = call.operation === "get" ? "?task=" + id.parse(call.taskId) : call.after ? "?after=" + id.parse(call.after) : "";
    return request(path + query);
  }
  /** Read the roster only after resolving the project and checking current access. */
  async projectRoster(workspaceId: string, signal: AbortSignal, sessionId?: string): Promise<ProjectRoster | null> {
    const generation = this.account.generation;
    if (sessionId && (!this.native.workspaceRegistry.list().some(item => item.id === workspaceId && item.sessionIds.includes(sessionId)) ||
        this.native.workspaceRegistry.archivedSessionIds?.includes(sessionId))) {
      throw new SuiteError("BOARD_SESSION_NOT_FOUND", 404);
    }
    const project = await this.boardProject(workspaceId, signal);
    if (!project) return null;
    const query = new URLSearchParams({ members: "1", ...(sessionId ? { sessionId } : {}) });
    const result = z.object({ members: z.array(z.object({
      user_id: id, name: z.string().max(200), email: z.string().max(320).optional(),
      avatar: z.string().max(1024).nullable().optional(), canViewConversation: z.boolean().optional(),
    })).max(500), viewerId: id, organizationName: z.string().min(1).max(200), canInvite: z.boolean() }).parse(await this.account.request("/api/v1/projects/" + project.projectId + "/board?" + query, undefined, "GET", signal));
    if (generation !== this.account.generation) throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
    return {
      scope: createHash("sha256").update(JSON.stringify([this.origin, project.projectId, project.enterpriseId])).digest("hex"),
      canAssign: project.canAssign,
      viewerId: result.viewerId,
      projectId: project.projectId,
      enterpriseId: project.enterpriseId,
      organizationName: result.organizationName,
      canInvite: result.canInvite,
      members: result.members.map(({ user_id, name, email, avatar, canViewConversation }) => {
        const url = avatar ? URL.parse(avatar) : null;
        const safeAvatar = avatar && ((url?.protocol === "https:" && !url.username && !url.password) ||
          /^data:image\/(?:png|jpeg|webp|gif);base64,[\w+/]+={0,2}$/.test(avatar));
        return { userId: user_id, name, ...(email ? { email } : {}), ...(safeAvatar ? { avatar } : {}),
          ...(canViewConversation ? { canViewConversation } : {}) };
      }),
    };
  }
  async detail(enterpriseId: string): Promise<EnterpriseDetail> {
    const result = z
      .object({
        enterprise: row,
        canManage: z.boolean(),
        members: z.array(row),
        departments: z.array(row),
        invitations: z.array(row),
      })
      .parse(await this.cloud("enterprises/" + enterpriseId));
    return {
      enterprise: organization(result.enterprise),
      canManage: result.canManage,
      members: result.members.map((r) => ({
        userId: string(r.user_id),
        name: string(r.name),
        email: string(r.email),
        role: string(r.role),
        departmentId: nullableString(r.department_id),
      })),
      departments: result.departments.map((r) => ({
        id: string(r.id),
        name: string(r.name),
      })),
      invitations: result.invitations.map((r) => ({
        projectId: nullableString(r.project_id),
        projectRole: r.project_role as "view" | "participate" | "maintain" | null,
        departmentId: nullableString(r.department_id),
        id: string(r.id),
        email: string(r.email),
        role: string(r.role),
        expiresAt: number(r.expires_at),
        accepted: !!r.accepted_by,
        revoked: !!r.revoked_at,
      })),
    };
  }
  async assign(input: unknown) {
    const data = z
      .object({ projectId: id, enterpriseId: id.nullable() })
      .parse(input);
    const catalog = await this.catalog();
    const project = catalog.projects.find((p) => p.id === data.projectId);
    if (!project) throw new SuiteError("IPW_PROJECT_NOT_FOUND", 404);
    if (
      data.enterpriseId &&
      !catalog.enterprises.some((e) => e.id === data.enterpriseId)
    )
      throw new SuiteError("ENTERPRISE_FORBIDDEN", 403);
    const result = project.cloudId
      ? await this.cloud(
          "projects/" + project.cloudId,
          { enterpriseId: data.enterpriseId, title: project.title },
          "PATCH",
        )
      : await this.cloud("projects", {
          title: project.title,
          nativeId: project.id,
          enterpriseId: data.enterpriseId,
        });
    const cloudId = project.cloudId ?? z.object({ id }).parse(result).id;
    await linkProject(project.path, this.origin, cloudId);
    return result;
  }
  async preview(sessionId: string): Promise<SharePreview> {
    const local = this.native.workspaceRegistry
      .list()
      .find((p) => p.sessionIds.includes(sessionId));
    if (!local) throw new SuiteError("IPW_PROJECT_NOT_FOUND", 404);
    const userId = await this.signedIn();
    const [organizations, projects] = await Promise.all([
      this.cloud("enterprises"),
      this.cloud("projects"),
    ]);
    const project = this.localProjects(
      userId,
      list.parse(organizations).items.map(organization),
      projects,
    ).find((p) => p.id === local.id);
    if (!project) throw new SuiteError("IPW_PROJECT_NOT_FOUND", 404);
    const surface = await this.native.sessionQuery.readSurface(sessionId);
    const transcript = surface.events.flatMap((event) => {
      if (event.type !== "user/message" && event.type !== "assistant/message")
        return [];
      const data = row.parse(event.data);
      const message =
        event.type === "user/message" ? data : row.parse(data.message);
      const source = row.safeParse(message.source);
      if (
        !source.success ||
        source.data.kind !== (event.type === "user/message" ? "user" : "model")
      )
        return [];
      const content = z
        .array(row)
        .parse(message.content)
        .filter((block) => block.type === "text")
        .map((block) => string(block.text))
        .join("\n");
      return content
        ? [
            {
              role:
                event.type === "user/message"
                  ? ("user" as const)
                  : ("assistant" as const),
              content,
            },
          ]
        : [];
    });
    if (
      transcript.length > 200 ||
      Buffer.byteLength(JSON.stringify(transcript)) > 500_000
    )
      throw new SuiteError("IPW_SHARE_TOO_LARGE", 413);
    return {
      project,
      transcript,
      revision: createHash("sha256")
        .update(JSON.stringify(transcript))
        .digest("hex"),
    };
  }
  async shared(shareId: string): Promise<SharedConversationDetail> {
    const result = z
      .object({
        id,
        project_id: id,
        title: name,
        owner_id: id,
        canComment: z.boolean(),
        transcript: z.array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          }),
        ),
        comments: z.array(row),
      })
      .parse(await this.cloud("shares/" + shareId));
    return {
      projectId: string(result.project_id),
      id: result.id,
      title: result.title,
      ownerId: result.owner_id,
      canComment: result.canComment,
      transcript: result.transcript,
      comments: result.comments.map((r) => ({
        id: string(r.id),
        name: string(r.name),
        content: string(r.content),
        createdAt: number(r.created_at),
      })),
    };
  }
  async request(
    method: string,
    path: string,
    input?: unknown,
  ): Promise<unknown> {
    const parts = path.split("/").filter(Boolean);
    if (method === "DELETE" && parts[0] === "projects" && parts.length === 2)
      return this.cloud("projects/" + id.parse(parts[1]), undefined, "DELETE");
    if (
      parts[0] === "projects" &&
      parts[1] &&
      [
        "space",
        "access",
        "changes",
        "memory",
        "artifacts",
        "archive-policy",
        "memory-versions",
        "overview",
        "storage",
        "publish",
      ].includes(parts[2] ?? "")
    ) {
      const target =
        "projects/" +
        id.parse(parts[1]) +
        "/" +
        parts
          .slice(2)
          .map((segment) => id.parse(segment))
          .join("/");
      return this.cloud(target, input, method);
    }
    if (
      method === "POST" &&
      parts[0] === "projects" &&
      parts[1] &&
      parts[2] === "link"
    ) {
      const data = z.object({ workspaceId: id }).parse(input);
      const workspace = this.native.workspaceRegistry
        .list()
        .find((p) => p.id === data.workspaceId);
      if (!workspace) throw new SuiteError("IPW_PROJECT_NOT_FOUND", 404);
      await this.cloud("projects/" + id.parse(parts[1]) + "/space");
      await linkProject(workspace.path, this.origin, parts[1]);
      return { ok: true };
    }
    if (method === "GET" && parts.length === 0) return this.catalog();
    if (method === "POST" && path === "/organizations")
      return this.cloud("enterprises", z.object({ name }).parse(input));
    if (method === "POST" && path === "/join") {
      const { invitation } = z
        .object({ invitation: z.string().trim().min(1).max(2048) })
        .parse(input);
      let token = invitation;
      if (invitation.includes("://")) {
        const url = new URL(invitation);
        if (url.origin !== this.origin || !url.pathname.startsWith("/invite/"))
          throw new SuiteError("IPW_INVALID_INVITATION", 400);
        token = url.pathname.slice("/invite/".length);
      }
      if (!/^[A-Za-z0-9_-]{40,100}$/.test(token))
        throw new SuiteError("IPW_INVALID_INVITATION", 400);
      return this.cloud("invitations/" + token + "/accept", {});
    }
    if (method === "POST" && path === "/assign") return this.assign(input);
    if (parts[0] === "organizations" && parts[1]) {
      const base = "enterprises/" + id.parse(parts[1]);
      if (method === "POST" && parts[2] === "analytics" && parts.length === 3)
        return enterpriseAnalyticsSchema.parse(await this.cloud(base + "/analytics", z.object({
          days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
          groupBy: z.enum(["member", "department", "sku"]),
          page: z.number().int().min(1).max(10000),
          activityPage: z.number().int().min(1).max(10000),
        }).strict().parse(input)));
      if (method === "GET" && parts.length === 2) return this.detail(parts[1]);
      if (parts[2] === "notifications" && parts.length === 3) {
        if (method === "GET") return this.cloud(base + "/notifications");
        if (method === "PUT") return this.cloud(base + "/notifications", z.object({endpoint:z.string().max(2048),enabled:z.boolean(),rotate:z.boolean().optional()}).strict().parse(input), "PUT");
      }
      if (method === "POST" && parts[2] === "invitations" && parts[3] === "batch" && parts.length === 4)
        return this.cloud(base + "/invitations/batch", z.object({people:z.array(z.object({email:z.email(),departmentId:id.nullable(),role:z.enum(["member","admin"])}).strict()).min(1).max(500),days:z.number().int().min(1).max(30)}).strict().parse(input));
      if (method === "POST" && parts[2] === "departments" && parts.length === 3)
        return this.cloud(
          base + "/departments",
          z.object({ name }).parse(input),
        );
      if (method === "POST" && parts[2] === "invitations" && parts.length === 3)
        return this.cloud(
          base + "/invitations",
          z
            .object({
              email: z.email(),
              role: z.enum(["admin", "member"]),
              departmentId: id.nullable(),
              projectId: id.optional(),
              projectRole: z.enum(["view", "participate", "maintain"]).optional(),
            })
            .parse(input),
        );
      if (
        method === "DELETE" &&
        parts[2] === "invitations" &&
        parts.length === 4
      )
        return this.cloud(
          base + "/invitations/" + id.parse(parts[3]),
          undefined,
          "DELETE",
        );
      if (parts[2] === "departments" && parts.length === 4) {
        if (method === "PATCH")
          return this.cloud(
            base + "/departments/" + id.parse(parts[3]),
            z.object({ name }).parse(input),
            "PATCH",
          );
        if (method === "DELETE")
          return this.cloud(
            base + "/departments/" + id.parse(parts[3]),
            undefined,
            "DELETE",
          );
      }
      if (method === "GET" && parts[2] === "assets" && parts.length === 3)
        return assetsResponse.parse(
          await this.cloud(base + "/assets"),
        ) satisfies EnterpriseAssets;
      if (method === "PUT" && parts[2] === "grants" && parts.length === 3)
        return this.cloud(
          base + "/grants",
          z
            .object({
              kind: z.enum(["package", "skill", "service", "mcp"]),
              assetId: id,
              audience,
            })
            .parse(input),
          "PUT",
        );
      if (parts[2] === "mcp") {
        if (parts.length === 3 && method === "GET") {
          const value = await this.cloud(base + "/mcp").catch((error: unknown) => {
            // Older account services return an unstructured 404 for this route.
            if (error instanceof SuiteError && error.status === 404 && error.code === "IPW_ACCOUNT_UNAVAILABLE")
              throw new SuiteError("IPW_ENTERPRISE_MCP_UNAVAILABLE", 503, { cause: error });
            throw error;
          });
          return z.object({
            canManage: z.boolean(),
            items: z.array(z.object({ id, title: name, description, host: z.string().max(253), audience })).max(100),
          }).parse(value);
        }
        if (parts.length === 3 && method === "POST")
          return this.cloud(base + "/mcp", z.object({
            title: name,
            description: z.string().trim().max(1000),
            endpoint: z.url().max(2048),
            key: key.optional(),
          }).strict().parse(input));
        if (parts.length === 4 && method === "DELETE")
          return this.cloud(base + "/mcp/" + id.parse(parts[3]), undefined, "DELETE");
      }
      if (parts[2] === "packages") {
        if (method === "POST" && parts.length === 3)
          return this.cloud(
            base + "/packages",
            z
              .object({
                title: name,
                description: description.optional(),
                audience: audience.optional(),
              })
              .parse(input),
          );
        const target = parts[3] ? base + "/packages/" + id.parse(parts[3]) : "";
        if (method === "GET" && parts.length === 4)
          return packageResponse.parse(
            await this.cloud(target),
          ) satisfies PackageDetail;
        if (method === "PATCH" && parts.length === 4)
          return this.cloud(
            target,
            z
              .object({
                title: name.optional(),
                description: description.optional(),
              })
              .parse(input),
            "PATCH",
          );
        if (method === "DELETE" && parts.length === 4)
          return this.cloud(target, undefined, "DELETE");
        if (method === "DELETE" && parts.length === 6 && parts[4] === "files")
          return this.cloud(
            target + "/files/" + id.parse(parts[5]),
            undefined,
            "DELETE",
          );
      }
      if (parts[2] === "skills") {
        if (method === "POST" && parts.length === 3)
          return this.cloud(
            base + "/skills",
            z
              .object({
                title: name,
                description: z.string().trim().min(1).max(1000),
                content: z.string().trim().min(1).max(200_000),
                audience: audience.optional(),
              })
              .parse(input),
          );
        if (method === "DELETE" && parts.length === 4)
          return this.cloud(
            base + "/skills/" + id.parse(parts[3]),
            undefined,
            "DELETE",
          );
      }
      if (parts[2] === "services") {
        if (method === "PUT" && parts.length === 5 && parts[4] === "credential")
          return this.cloud(base + "/services/" + id.parse(parts[3]) + "/credential", z.object({ key: z.string().max(8192).refine(v => !/[\r\n]/.test(v)) }).strict().parse(input), "PUT");
        if (method === "GET" && parts.length === 3)
          return modelsResponse.parse(await this.cloud(base + "/services"))
            .items satisfies EnterpriseModel[];
        if (method === "PUT" && parts.length === 3)
          return this.cloud(
            base + "/services",
            z
              .object({
                id: id.optional(),
                title: name,
                baseUrl: httpUrl,
                credentialMode: z.enum(["shared", "member"]).optional(),
                key: key.optional(),
                headerName: headerName.optional(),
                headerPrefix: headerPrefix.optional(),
                models: z.array(modelEntry).max(200),
                category: z.enum(serviceCategories).optional(),
                vendor: z.string().optional(),
                routes: z
                  .array(
                    z.object({
                      method: z.enum(["GET", "POST"]),
                      path: z.string(),
                      points: z.number(), base: z.enum(["service", "origin"]).optional(), origin: z.url().optional(), jobField:z.string().optional(), jobResultField:z.string().optional(),
                    }),
                  )
                  .optional(),
                enabled: z.boolean().optional(),
                audience: audience.optional(),
              })
              .strict()
              .parse(input),
            "PUT",
          );
        if (method === "POST" && parts.length === 4 && parts[3] === "probe")
          return probeResponse.parse(
            await this.cloud(
              base + "/services/probe",
              z
                .object({
                  serviceId: id.optional(),
                  baseUrl: httpUrl,
                  key: key.optional(),
                  headerName: headerName.optional(),
                  headerPrefix: headerPrefix.optional(),
                  model: z.string().min(1).max(200).optional(),
                })
                .strict()
                .parse(input),
            ),
          ) satisfies ModelProbe;
        if (method === "DELETE" && parts.length === 4)
          return this.cloud(
            base + "/services/" + id.parse(parts[3]),
            undefined,
            "DELETE",
          );
      }
      if (parts[2] === "members" && parts.length === 4) {
        if (method === "PATCH")
          return this.cloud(
            base + "/members/" + id.parse(parts[3]),
            z
              .object({
                role: z.enum(["admin", "member"]),
                departmentId: id.nullable(),
              })
              .parse(input),
            "PATCH",
          );
        if (method === "DELETE")
          return this.cloud(
            base + "/members/" + id.parse(parts[3]),
            undefined,
            "DELETE",
          );
      }
    }
    if (
      method === "GET" &&
      parts[0] === "projects" &&
      parts[1] &&
      parts[2] === "collaboration" &&
      parts.length === 3
    ) {
      const result = z
        .object({
          project: z.object({ id, title: name, enterpriseId: id.nullable() }),
          works: z.array(row),
          updates: z.array(row),
        })
        .parse(
          await this.cloud("projects/" + id.parse(parts[1]) + "/collaboration"),
        );
      return {
        project: result.project,
        works: result.works.map(projectWork),
        updates: result.updates.map(projectUpdate),
      } satisfies ProjectCollaboration;
    }
    if (method === "POST" && path === "/work") {
      throw new SuiteError("PROJECT_SPACE_REQUIRED", 410);
    }
    if (parts[0] === "work" && parts[1]) {
      const base = "work/" + id.parse(parts[1]);
      if (method === "GET" && parts.length === 2) {
        const result = z
          .object({ work: row, content: z.string(), versions: z.array(row) })
          .parse(await this.cloud(base));
        return {
          work: projectWork(result.work),
          content: result.content,
          versions: result.versions.map(projectUpdate),
        } satisfies WorkDetail;
      }
      if (method === "GET" && parts[2] === "revisions" && parts.length === 4)
        return this.cloud(
          base +
            "/revisions/" +
            z.coerce.number().int().positive().parse(parts[3]),
        );
      if (method === "POST" && parts[2] === "revisions" && parts.length === 3)
        return this.cloud(
          base + "/revisions",
          z
            .object({
              title: name,
              content: z.string().trim().min(1).max(100000),
              expectedVersion: z.number().int().nonnegative(),
            })
            .parse(input),
        );
    }
    if (method === "GET" && parts[0] === "preview" && parts.length === 2)
      return this.preview(id.parse(parts[1]));
    if (method === "POST" && path === "/shares") {
      throw new SuiteError("NATIVE_SHARING_REQUIRED", 410);
    }
    if (parts[0] === "shares" && parts[1]) {
      const shareId = id.parse(parts[1]);
      if (method === "GET" && parts.length === 2) return this.shared(shareId);
      if (method === "DELETE" && parts.length === 2)
        return this.cloud("shares/" + shareId, undefined, "DELETE");
      if (method === "POST" && parts[2] === "comments" && parts.length === 3)
        return this.cloud(
          "shares/" + shareId + "/comments",
          z
            .object({ content: z.string().trim().min(1).max(10000) })
            .parse(input),
        );
    }
    throw new SuiteError("IPW_NOT_FOUND", 404);
  }
}
