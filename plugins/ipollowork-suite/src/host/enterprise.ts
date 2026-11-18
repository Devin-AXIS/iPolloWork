import { enterpriseAnalyticsSchema } from "../shared/enterprise-analytics.ts";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readJson, type AccountService } from "./account.ts";
import { SuiteError } from "./errors.ts";
import { linkProject } from "./project-context.ts";
import { pinnedPlugin } from "./enterprise-plugin.ts";
import { organizationTabs } from "../shared/enterprise.ts";
import type {
  EnterpriseAssets,
  EnterpriseModel,
  ModelProbe,
} from "../shared/enterprise.ts";
import type {
  Enterprise,
  EnterpriseCatalog,
  EnterpriseDetail,
  EnterpriseProject,
  SharePreview,
  SharedConversationDetail,
  ProjectWork,
  ProjectCollaboration,
  WorkDetail,
  ProjectUpdate,
} from "../shared/enterprise.ts";

import { serviceCategories } from "../shared/service-categories.ts";
import { conversationCopyId, importConversationCopy, type CopyPersistence, type CopyWorkspace } from "./session-copies.ts";
const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(1).max(120);
const logo = z.string().max(48_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
const row = z.record(z.string(), z.unknown());
const audience = z
  .object({
    all: z.boolean(),
    departments: z.array(id).max(200),
    members: z.array(id).max(500),
    includeSubdepartments: z.boolean().optional(),
  })
  .strict();
const description = z.string().trim().max(2000);
const tabs = z.array(z.enum(organizationTabs)).max(organizationTabs.length);
const publicationKind = z.enum(["plugin", "template", "skill", "mcp"]);
const publicationVersion = z.string().min(1).max(64).regex(/^[0-9A-Za-z.-]+$/);
const mcpOAuth = z.object({
  authorizationUrl:z.url().max(2048), tokenUrl:z.url().max(2048), clientId:z.string().min(1).max(256), scope:z.string().max(512),
}).strict();
const publicMcpList = z.object({ items:z.array(z.object({
  id:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), name, description:z.string().max(500), oauth:z.boolean(),
  url:z.url().max(2048).refine(value=>{
    const url=new URL(value);
    return url.protocol==="https:" && !url.username && !url.password && !url.search && !url.hash;
  }),
})).max(100) });
const publicationList = z.object({
  canManage: z.boolean(),
  items: z.array(z.object({
    id, title: name, description, packageName: z.string().max(214).optional(),
    publishedVersion: publicationVersion.nullable(), canSubmit: z.boolean(), audience: audience.optional(),
  })).max(200),
});
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
  logo: logo.safeParse(r.logo).data ?? null,
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
  sessionPersistence?: CopyPersistence;
  workspaceRegistry: {
    get?(id: string): CopyWorkspace | undefined;
    create?(path: string, title?: string): Promise<{ id: string }>;
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
  private importing = new Map<string, Promise<{ sessionId: string }>>();
  constructor(
    private account: AccountService,
    private native: EnterpriseNative,
    private origin: string,
  ) {}
  private cloud(path: string, data?: unknown, method?: string) {
    return this.account.request("/api/v1/" + path, data, method);
  }
  private async signedIn() {
    const user = await this.account.user();
    if (!user) throw new SuiteError("IPW_SIGN_IN_REQUIRED", 401);
    return user.id;
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
    const accountGeneration = this.account.generation;
    const userId = await this.signedIn();
    const [organizations, projects] = await Promise.all([
      this.cloud("enterprises"),
      this.cloud("projects"),
    ]);
    if (accountGeneration !== this.account.generation)
      throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
    const enterprises = list.parse(organizations).items.map(organization);
    return {
      serviceOrigin: this.origin,
      userId,
      enterprises,
      work: [],
      sharedProjects: list.parse(projects).items.map((r) => ({
        executionMode: r.execution_mode === "cloud" ? "cloud" : "local",
        id: string(r.id),
        title: string(r.title),
        enterpriseId: nullableString(r.enterprise_id),
        enterpriseName: nullableString(r.enterprise_name),
      })),
      projects: this.localProjects(userId, enterprises, projects),
      shares: [],
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
      description: nullableString(result.enterprise.description) ?? "",
      tabOrder: typeof result.enterprise.tab_order === "string"
        ? tabs.parse(JSON.parse(result.enterprise.tab_order)) : [],
      members: result.members.map((r) => ({
        userId: string(r.user_id),
        name: string(r.name),
        email: string(r.email),
        role: string(r.role),
        status: r.status === "suspended" ? "suspended" : "active",
        departmentId: nullableString(r.department_id),
        employeeNumber: nullableString(r.employee_number),
        displayName: nullableString(r.display_name),
      })),
      departments: result.departments.map((r) => ({
        id: string(r.id),
        name: string(r.name),
        parentId: nullableString(r.parent_id),
      })),
      invitations: result.invitations.map((r) => ({
        projectId: nullableString(r.project_id),
        projectRole: r.project_role as "view" | "participate" | "maintain" | null,
        departmentId: nullableString(r.department_id),
        id: string(r.id),
        email: nullableString(r.email),
        inviteeName: nullableString(r.invitee_name),
        employeeNumber: nullableString(r.employee_number),
        role: string(r.role),
        expiresAt: r.expires_at == null ? null : number(r.expires_at),
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
    return { project, ...await this.sessionTranscript(sessionId) };
  }

  /** The same bounded, human/model-only snapshot is used for each enterprise backend. */
  async sessionTranscript(sessionId: string): Promise<Pick<SharePreview, "transcript" | "revision">> {
    if (!this.native.workspaceRegistry.list().some(workspace => workspace.sessionIds.includes(sessionId)))
      throw new SuiteError("IPW_PROJECT_NOT_FOUND", 404);
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
  private async organizationCapability(path: string, input?: unknown, method?: string) {
    try {
      return await this.cloud(path, input, method);
    } catch (error) {
      if (error instanceof SuiteError && error.status === 404 && error.code === "IPW_ACCOUNT_UNAVAILABLE")
        throw new SuiteError("IPW_ENTERPRISE_CAPABILITIES_UNAVAILABLE", 503, { cause: error });
      throw error;
    }
  }

  private async publications(base: string, parts: string[], method: string, input: unknown) {
    const kind = publicationKind.parse(parts[0]);
    const root = base + "/publications/" + kind;
    if (parts.length === 1) {
      if (method === "GET") return publicationList.parse(await this.organizationCapability(root));
      if (method === "POST") {
        const common = { id: id.optional(), title: name, description, version: publicationVersion };
        if (kind === "plugin") {
          const data = z.object({ ...common, packageName: z.string().max(214) }).strict().parse(input);
          pinnedPlugin(data.packageName + "@" + data.version);
          return this.organizationCapability(root, data);
        }
        if (kind === "skill")
          return this.organizationCapability(root, z.object({ ...common, markdown:z.string().min(1).max(32_000) }).strict().parse(input));
        if (kind === "mcp")
          return this.organizationCapability(root, z.object({ ...common, endpoint:z.url().max(2048) }).strict().parse(input));
        return this.organizationCapability(root, z.object({ ...common, html: z.string().min(1).max(512 * 1024) }).strict().parse(input));
      }
    }
    if (!parts[1]) throw new SuiteError("IPW_NOT_FOUND", 404);
    const item = root + "/" + id.parse(parts[1]);
    if (parts.length === 2 && method === "DELETE") return this.organizationCapability(item, undefined, method);
    if (parts[2] === "versions" && parts.length === 3 && method === "GET") {
      const { items } = z.object({ items: z.array(z.object({
        version: publicationVersion, status: z.enum(["pending", "rejected", "approved"]),
        note: z.string(), created_at: z.number(),
      })).max(200) }).parse(await this.organizationCapability(item + "/versions"));
      return { items: items.map(row => ({ version: row.version, status: row.status, note: row.note, createdAt: row.created_at })) };
    }
    if (parts[2] === "versions" && parts.length === 4) {
      const version = publicationVersion.parse(parts[3]), path = item + "/versions/" + version;
      if (method === "PUT")
        return this.organizationCapability(path, z.object({
          decision: z.enum(["approve", "reject", "publish"]), note: z.string().max(1000).optional(),
        }).strict().parse(input), method);
      if (method === "GET") {
        const result = await this.organizationCapability(path);
        if (kind === "template") return z.object({ html: z.string().max(512 * 1024) }).parse(result);
        if (kind === "skill") return z.object({ markdown:z.string().max(32_000) }).parse(result);
        if (kind === "mcp") return z.object({ endpoint:z.url().max(2048) }).parse(result);
        const { spec } = z.object({ spec: z.string().max(300) }).parse(result);
        const reference = pinnedPlugin(spec);
        if (reference.version !== version) throw new SuiteError("IPW_INVALID_RESPONSE", 502);
        return { spec };
      }
    }
    throw new SuiteError("IPW_NOT_FOUND", 404);
  }

  async request(
    method: string,
    path: string,
    input?: unknown,
  ): Promise<unknown> {
    const parts = path.split("/").filter(Boolean);
    if (path === "/conversation-share-preview" && method === "POST") {
      await this.signedIn();
      const { sessionId } = z.object({ sessionId: id }).strict().parse(input);
      const { transcript, revision } = await this.sessionTranscript(sessionId);
      if (!transcript.some(message => message.role === "user")) throw new SuiteError("IPW_SHARE_EMPTY", 409);
      return { revision, messageCount: transcript.length };
    }
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
    if (method === "GET" && path === "/public-mcp") {
      await this.signedIn();
      try {
        const result = await fetch("https://i.ipollo.ai/api/v1/mcp/catalog", {
          redirect:"error", headers:{accept:"application/json"}, signal:AbortSignal.timeout(8_000),
        });
        if (!result.ok) {
          await result.body?.cancel();
          throw new SuiteError("IPW_ENTERPRISE_MCP_UNAVAILABLE",503);
        }
        return publicMcpList.parse(await readJson(result, 128 * 1024));
      } catch (cause) {
        throw new SuiteError("IPW_PUBLIC_MCP_UNAVAILABLE",503,{cause});
      }
    }
    if (path === "/notices") {
      if (method === "GET") {
        const { items } = z.object({ items: z.array(z.object({
          id, kind: z.enum(["role", "department", "removed", "status", "resource.approved", "resource.rejected",
            "resource.published", "project.submitted", "project.accepted", "conversation.shared"]), value: z.string().nullable(),
          name, created_at: z.number(), read_at: z.number().nullable(),
          enterprise_id:id.optional(), target_tab:tabs.element.nullable().optional(), target_id:id.nullable().optional(),
        })).max(100) }).parse(await this.organizationCapability("me/organization-notices?include=all"));
        return { items: items.map(row => ({ id:row.id, kind:row.kind, value:row.value, name:row.name,
          createdAt:row.created_at, readAt:row.read_at, enterpriseId:row.enterprise_id, tab:row.target_tab, targetId:row.target_id })) };
      }
      if (method === "PUT") return this.organizationCapability("me/organization-notices",
        z.object({ids:z.array(z.uuid()).max(100)}).strict().parse(input), method);
    }
    if (method === "POST" && path === "/organizations")
      return this.cloud("enterprises", z.object({ name }).parse(input));
    if (method === "POST" && path === "/join") {
      const { invitation, serviceAddress } = z
        .object({ invitation: z.string().trim().min(1).max(2048), serviceAddress: z.url().max(2048).optional() }).strict()
        .parse(input);
      if (serviceAddress) {
        const service = new URL(serviceAddress);
        if (service.origin !== this.origin || service.pathname !== "/" || service.username || service.password || service.search || service.hash)
          throw new SuiteError("IPW_INVITATION_SERVICE_MISMATCH", 400);
      }
      let token = invitation;
      if (invitation.includes("://")) {
        const url = z.url().parse(invitation);
        const link = new URL(url);
        if (link.origin !== this.origin || !link.pathname.startsWith("/invite/") || link.username || link.password)
          throw new SuiteError("IPW_INVALID_INVITATION", 400);
        token = link.pathname.slice("/invite/".length);
      }
      if (!/^[A-Za-z0-9_-]{40,100}$/.test(token))
        throw new SuiteError("IPW_INVALID_INVITATION", 400);
      return this.cloud("invitations/" + token + "/accept", {});
    }
    if (method === "POST" && path === "/assign") return this.assign(input);
    if (parts[0] === "organizations" && parts[1]) {
      const base = "enterprises/" + id.parse(parts[1]);
      if (parts[2] === "messages") {
        const route = base + "/conversation-shares";
        if (parts.length === 3 && method === "GET") {
          const userId = await this.signedIn();
          const { items } = z.object({items:z.array(z.object({
            id, title: name, owner_id:id, owner_name:z.string(), created_at:z.number(),
          })).max(200)}).parse(await this.organizationCapability(route));
          return { userId, items:items.map(share => ({ id:share.id, title:share.title,
            ownerId:share.owner_id, ownerName:share.owner_name, createdAt:share.created_at })) };
        }
        if (parts.length === 3 && method === "POST") {
          await this.signedIn();
          const data = z.object({ requestId:z.uuid(), sessionId:id, title:name, recipients:z.array(id).min(1).max(100),
            revision:z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(input);
          const current = await this.sessionTranscript(data.sessionId);
          if (current.revision !== data.revision) throw new SuiteError("IPW_SHARE_CHANGED", 409);
          if (!current.transcript.some(message => message.role === "user")) throw new SuiteError("IPW_SHARE_EMPTY", 409);
          return this.organizationCapability(route, { requestId:data.requestId, title:data.title,
            recipients:data.recipients, transcript:current.transcript });
        }
        if (parts.length === 4 && method === "DELETE") return this.organizationCapability(route + "/" + id.parse(parts[3]), undefined, method);
        if (parts.length === 5 && parts[4] === "copy" && method === "POST") {
          const user = await this.signedIn(), shareId = id.parse(parts[3]);
          const share = z.object({ title:name, transcript:z.array(z.object({
            role:z.enum(["user","assistant"]), content:z.string(),
          })).min(1).max(200) }).parse(await this.organizationCapability(route + "/" + shareId));
          const sessionId = conversationCopyId(user, shareId);
          const workspaces = this.native.workspaceRegistry.list();
          if (workspaces.some(workspace => workspace.sessionIds.includes(sessionId))) return { sessionId };
          const running = this.importing.get(sessionId);
          if (running) return running;
          const preferred = workspaces[0];
          const destination = preferred && this.native.workspaceRegistry.get?.(preferred.id);
          if (!this.native.sessionPersistence || !destination) throw new SuiteError("IPW_SHARE_WORKSPACE_REQUIRED", 409);
          const operation = importConversationCopy(this.native.sessionPersistence, destination, sessionId, share.title, share.transcript);
          this.importing.set(sessionId, operation);
          try { return await operation; } finally { this.importing.delete(sessionId); }
        }
      }
      if (parts[2] === "publications" && parts[3])
        return this.publications(base, parts.slice(3), method, input);
      if ((method === "GET" || method === "POST") && parts[2] === "activity" && parts.length === 3) {
        const search = method === "POST" ? z.object({ actor: z.string().trim().max(120) }).strict().parse(input).actor : "";
        const { items } = z.object({ items: z.array(z.object({
          id: z.union([z.string(), z.number()]), action: z.string(), actor: z.string().nullable(), created_at: z.number(),
        })).max(100) }).parse(await this.organizationCapability(base + "/activity" + (search ? "?actor=" + encodeURIComponent(search) : "")));
        return { items: items.map(row => ({ id: String(row.id), action: row.action, actor: row.actor, createdAt: row.created_at })) };
      }
      if (method === "POST" && parts[2] === "analytics" && parts.length === 3)
        return enterpriseAnalyticsSchema.parse(await this.cloud(base + "/analytics", z.object({
          days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
          groupBy: z.enum(["member", "department", "sku"]),
          page: z.number().int().min(1).max(10000),
          activityPage: z.number().int().min(1).max(10000),
        }).strict().parse(input)));
      if (method === "GET" && parts.length === 2) return this.detail(parts[1]);
      if (method === "PATCH" && parts.length === 2) {
        const data = z.object({ name: name.optional(), description: z.string().trim().max(1000).optional(), tabOrder: tabs.optional(), logo:logo.nullable().optional() }).strict().parse(input);
        try {
          return z.object({ id, name, description: z.string().optional(), tabOrder: tabs.optional(), logo:logo.nullable().optional() }).parse(await this.cloud(base, data, "PATCH"));
        } catch (error) {
          if (error instanceof SuiteError && error.status === 404 && error.code === "IPW_ACCOUNT_UNAVAILABLE")
            throw new SuiteError("IPW_ENTERPRISE_SETTINGS_UNAVAILABLE", 503, { cause: error });
          throw error;
        }
      }
      if (parts[2] === "notifications" && parts.length === 3) {
        if (method === "GET") return this.cloud(base + "/notifications");
        if (method === "PUT") return this.cloud(base + "/notifications", z.object({endpoint:z.string().max(2048),enabled:z.boolean(),rotate:z.boolean().optional()}).strict().parse(input), "PUT");
      }
      if (method === "POST" && parts[2] === "invitations" && parts[3] === "batch" && parts.length === 4) {
        const days = z.number().int().min(1).max(30);
        return this.cloud(base + "/invitations/batch", z.union([
          z.object({people:z.array(z.object({email:z.email(),departmentId:id.nullable(),role:z.enum(["member","admin"])}).strict()).min(1).max(500),days}).strict(),
          z.object({csv:z.string().min(1).max(256 * 1024),days}).strict(),
        ]).parse(input));
      }
      if (method === "POST" && parts[2] === "join-codes" && parts.length === 3) {
        const data = z.object({
          departmentId: id.nullable().optional(), days: z.number().int().min(1).max(30).nullable().optional(),
          displayName: name.optional(),
          projectId: id.optional(), projectRole: z.enum(["view", "participate", "maintain"]).optional(),
        }).strict().parse(input);
        return z.object({
          id, code: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/),
          expiresAt: z.number().nullable(), serviceAddress: z.url(),
        }).parse(await this.organizationCapability(base + "/join-codes", data));
      }
      if (method === "POST" && parts[2] === "join-codes" && parts[3] === "batch" && parts.length === 4)
        return this.organizationCapability(base + "/join-codes/batch", z.object({
          csv: z.string(),
          days: z.number().int().min(1).max(30).nullable().optional(),
          createMissingDepartments: z.boolean().optional(),
        }).strict().parse(input));
      if (method === "PATCH" && parts[2] === "join-codes" && parts.length === 4)
        return this.organizationCapability(base + "/join-codes/" + id.parse(parts[3]), z.object({
          days:z.number().int().min(1).max(30).nullable(),
        }).strict().parse(input), "PATCH");
      if (method === "POST" && parts[2] === "departments" && parts.length === 3)
        return this.cloud(
          base + "/departments",
          z.object({ name, parentId: id.nullable().optional() }).parse(input),
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
            z.object({ name, parentId: id.nullable().optional() }).parse(input),
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
                kind: z.enum(["skill", "service", "mcp", "plugin", "template"]),
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
            items: z.array(z.object({
              id, title: name, description, host: z.string().max(253), audience,
              enabled: z.boolean().optional(), endpoint: z.url().max(2048).optional(),
              reviewed: z.boolean().optional(),
              oauthRequired:z.boolean().optional(), authorized:z.boolean().optional(), oauth:mcpOAuth.optional(),
            })).max(100),
          }).parse(value);
        }
        if (parts.length === 3 && method === "POST")
          return this.cloud(base + "/mcp", z.object({
            title: name,
            description: z.string().trim().max(1000),
            endpoint: z.url().max(2048),
            key: key.optional(),
            oauth:mcpOAuth.optional(),
          }).strict().parse(input));
        if (parts.length === 4 && method === "DELETE")
          return this.cloud(base + "/mcp/" + id.parse(parts[3]), undefined, "DELETE");
        if (parts.length === 4 && method === "PATCH")
          return this.organizationCapability(base + "/mcp/" + id.parse(parts[3]), z.object({
            title: name, description: z.string().trim().max(1000), endpoint: z.url().max(2048),
            key: key.nullable().optional(), enabled: z.boolean(),
            oauth:mcpOAuth.nullable().optional(),
          }).strict().parse(input), method);
        if (parts.length === 5 && parts[4] === "oauth") {
          const path = "me/enterprise-mcp/" + id.parse(parts[3]) + "/oauth";
          if (method === "DELETE") return this.organizationCapability(path,undefined,method);
          if (method === "POST") return z.object({
            authorizationUrl:z.url().max(4096).refine(value=>new URL(value).protocol==="https:"),
          }).parse(await this.organizationCapability(path,{},method));
        }
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
                status: z.enum(["active", "suspended"]).optional(),
                departmentId: id.nullable(),
                employeeNumber: z.string().trim().min(1).max(64).nullable().optional(),
                displayName: name.nullable().optional(),
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
