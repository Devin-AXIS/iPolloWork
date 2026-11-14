/** Account-scoped enterprise records; local paths never leave the DSH Host. */
export interface Enterprise { id: string; name: string; role: string; memberCount: number }
export interface EnterpriseMember { userId: string; name: string; email: string; role: string; departmentId: string | null }
export interface Department { id: string; name: string }
export interface Invitation { id: string; email: string; role: string; expiresAt: number; accepted: boolean; revoked: boolean }
export interface EnterpriseDetail { enterprise: Enterprise; canManage: boolean; members: EnterpriseMember[]; departments: Department[]; invitations: Invitation[] }
export interface EnterpriseProject { id: string; title: string; path: string; sessionIds: readonly string[]; cloudId: string | null; enterpriseId: string | null; enterpriseName: string | null }
export interface SharedConversation { id: string; title: string; projectId: string; projectTitle: string; enterpriseId: string | null; enterpriseName: string | null; ownerId: string; createdAt: number }
export interface SharedMessage { role: 'user' | 'assistant'; content: string }
export interface SharedConversationDetail { projectId:string;id: string; title: string; ownerId: string; canComment: boolean; transcript: SharedMessage[]; comments: { id: string; name: string; content: string; createdAt: number }[] }
export interface EnterpriseCatalog { serviceOrigin:string;work:ProjectWork[];sharedProjects:SharedProject[];enterprises: Enterprise[]; projects: EnterpriseProject[]; shares: SharedConversation[]; userId: string }
export interface SharePreview { project: EnterpriseProject; transcript: SharedMessage[]; revision: string }

/** One member's continuation; native identities are returned only to that member. */
export interface ProjectWork {
  id:string;projectId:string;projectTitle:string;enterpriseId:string|null;enterpriseName:string|null;sourceShareId:string;
  ownerId:string;ownerName:string;title:string;version:number;resultTitle:string|null;updatedAt:number;
  nativeSessionId?:string;nativeWorkspaceId?:string;canPublish:boolean;
}
export interface ProjectUpdate { id:string;workId:string;version:number;title:string;authorName:string;createdAt:number }
export interface SharedProject { id:string;title:string;enterpriseId:string|null;enterpriseName:string|null }
export interface ProjectCollaboration { project:{id:string;title:string;enterpriseId:string|null};works:ProjectWork[];updates:ProjectUpdate[] }
export interface WorkDetail { work:ProjectWork;content:string;versions:ProjectUpdate[] }

export type ProjectRole = 'view' | 'participate' | 'maintain'
export interface ProjectGrant { kind:'member'|'department';subjectId:string;role:ProjectRole }
export interface ProjectFile { path:string;resourceId:string }
export interface ProjectChange { id:string;author_id:string;author_name:string;kind:'files'|'memory';title:string;content:string;base_version:number;status:'pending'|'accepted'|'withdrawn';created_at:number }
export interface ProjectSpace {
  project:{id:string;title:string;enterpriseId:string|null;role:ProjectRole;accessMode:'enterprise'|'selected'}
  memory:{text:string;version:number};files:ProjectFile[];fileVersion:number;changes:ProjectChange[]
}
