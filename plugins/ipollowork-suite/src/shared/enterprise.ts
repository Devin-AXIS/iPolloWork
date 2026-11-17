export const organizationTabs = ["analytics", "projects", "members", "departments", "templates", "plugins", "skills", "mcp", "models", "messages", "activity", "settings"] as const;
export type EnterpriseTab = typeof organizationTabs[number];

/** Account-scoped enterprise records; local paths never leave the DSH Host. */
export interface Enterprise {
  id: string;
  name: string;
  role: string;
  memberCount: number;
  logo?: string | null;
}
export interface EnterpriseMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  status?: 'active' | 'suspended';
  departmentId: string | null;
  employeeNumber?: string | null;
  displayName?: string | null;
}
export interface Department {
  id: string;
  name: string;
  parentId?: string | null;
}
export interface Invitation {
  projectId?: string | null;
  projectRole?: "view" | "participate" | "maintain" | null;
  departmentId?: string | null;
  id: string;
  email: string | null;
  inviteeName?: string | null;
  employeeNumber?: string | null;
  role: string;
  expiresAt: number | null;
  accepted: boolean;
  revoked: boolean;
}
export interface EnterpriseDetail {
  enterprise: Enterprise;
  canManage: boolean;
  members: EnterpriseMember[];
  departments: Department[];
  invitations: Invitation[];
  description?: string;
  tabOrder?: EnterpriseTab[];
}

export type PublicationKind = "plugin" | "template" | "skill";
export interface OrganizationPublication {
  id: string;
  title: string;
  description: string;
  packageName?: string;
  publishedVersion: string | null;
  canSubmit: boolean;
  audience?: Audience;
}
export interface PublicationVersion {
  version: string;
  status: "pending" | "approved" | "rejected";
  note: string;
  createdAt: number;
}
export interface OrganizationActivity {
  id: string;
  action: string;
  actor: string | null;
  createdAt: number;
}
export interface EnterpriseProject {
  id: string;
  title: string;
  path: string;
  sessionIds: readonly string[];
  cloudId: string | null;
  enterpriseId: string | null;
  enterpriseName: string | null;
}
export interface SharedConversation {
  id: string;
  title: string;
  projectId: string;
  projectTitle: string;
  enterpriseId: string | null;
  enterpriseName: string | null;
  ownerId: string;
  createdAt: number;
}
export interface SharedMessage {
  role: "user" | "assistant";
  content: string;
}
export interface SharedConversationDetail {
  projectId: string;
  id: string;
  title: string;
  ownerId: string;
  canComment: boolean;
  transcript: SharedMessage[];
  comments: { id: string; name: string; content: string; createdAt: number }[];
}
export interface EnterpriseCatalog {
  serviceOrigin: string;
  work: ProjectWork[];
  sharedProjects: SharedProject[];
  enterprises: Enterprise[];
  projects: EnterpriseProject[];
  shares: SharedConversation[];
  userId: string;
}
export interface SharePreview {
  project: EnterpriseProject;
  transcript: SharedMessage[];
  revision: string;
}

/** One member's continuation; native identities are returned only to that member. */
export interface ProjectWork {
  id: string;
  projectId: string;
  projectTitle: string;
  enterpriseId: string | null;
  enterpriseName: string | null;
  sourceShareId: string;
  ownerId: string;
  ownerName: string;
  title: string;
  version: number;
  resultTitle: string | null;
  updatedAt: number;
  nativeSessionId?: string;
  nativeWorkspaceId?: string;
  canPublish: boolean;
}
export interface ProjectUpdate {
  id: string;
  workId: string;
  version: number;
  title: string;
  authorName: string;
  createdAt: number;
}
export interface SharedProject {
  executionMode?: "local" | "cloud";
  id: string;
  title: string;
  enterpriseId: string | null;
  enterpriseName: string | null;
}
export interface ProjectCollaboration {
  project: { id: string; title: string; enterpriseId: string | null };
  works: ProjectWork[];
  updates: ProjectUpdate[];
}
export interface WorkDetail {
  work: ProjectWork;
  content: string;
  versions: ProjectUpdate[];
}

export type ProjectRole = "view" | "participate" | "maintain";
export interface ProjectGrant {
  kind: "member" | "department";
  subjectId: string;
  role: ProjectRole;
}
export interface ProjectFile {
  path: string;
  resourceId: string;
}
export interface ProjectChange {
  id: string;
  author_id: string;
  author_name: string;
  kind: "files" | "memory";
  title: string;
  content: string;
  base_version: number;
  status: "pending" | "accepted" | "withdrawn";
  created_at: number;
}
export interface ProjectSpace {
  project: {
    id: string;
    title: string;
    enterpriseId: string | null;
    role: ProjectRole;
    accessMode: "enterprise" | "selected";
    publishedAt?: number | null;
    canDelete?: boolean;
  };
  memory: { text: string; version: number };
  files: ProjectFile[];
  fileVersion: number;
  changes: ProjectChange[];
}
/** Who may use an enterprise asset: every member, or the listed departments and members. Managers always may. */
export interface Audience {
  all: boolean;
  departments: string[];
  members: string[];
  includeSubdepartments?: boolean | undefined;
}
/** `name` is the skill's name in each permitted member's DSH. */
export interface EnterpriseSkill {
  id: string;
  title: string;
  description: string;
  name: string;
  bytes: number;
  updatedAt: number;
  audience: Audience;
}
export interface EnterpriseAssets {
  canManage: boolean;
  skills: EnterpriseSkill[];
}
export interface EnterpriseMcp {
  id: string;
  title: string;
  description: string;
  host: string;
  enabled?: boolean;
  endpoint?: string;
  oauthRequired?: boolean;
  authorized?: boolean;
  oauth?: { authorizationUrl:string; tokenUrl:string; clientId:string; scope:string };
  audience: Audience;
}
import type { ServiceCategory } from "./service-categories.ts";
export interface EnterpriseModelEntry {
  category?: ServiceCategory | undefined;
  id: string;
  name: string;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
}
/** An enterprise-owned model connection; the key never leaves the account service. */
export interface EnterpriseModel {
  credentialMode?: "shared" | "member" | undefined;
  category?: ServiceCategory | undefined;
  vendor?: string | undefined;
  routes?:
    | { method: "GET" | "POST"; path: string; points: number; base?: "service" | "origin" | undefined; origin?: string | undefined; jobField?:string|undefined; jobResultField?:string|undefined }[]
    | undefined;
  id: string;
  title: string;
  baseUrl: string;
  models: EnterpriseModelEntry[];
  enabled: boolean;
  configured: boolean;
  headerName: string;
  headerPrefix: string;
  audience: Audience;
}
export interface ModelProbe {
  ok: boolean;
  status: number;
  latency: number;
  reason?: "auth" | "unreachable" | "timeout" | "upstream" | undefined;
  models: string[];
}
