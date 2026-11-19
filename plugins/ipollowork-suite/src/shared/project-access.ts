import type { EnterpriseDetail, ProjectGrant, ProjectRole } from './enterprise.ts'

export interface ProjectAccess { mode: 'enterprise' | 'selected'; grants: ProjectGrant[] }

/** Expand legacy audiences only when saving the member-only editor. Opening it never changes access. */
export function memberProjectAccess(access: ProjectAccess, members: EnterpriseDetail['members']): ProjectAccess {
  const rank: Record<ProjectRole, number> = { view: 1, participate: 2, maintain: 3 }
  return { mode: 'selected', grants: members.flatMap(member => {
    let role: ProjectRole | undefined = access.mode === 'enterprise' ? 'view' : undefined
    for (const grant of access.grants) {
      if ((grant.kind === 'member' && grant.subjectId === member.userId) ||
          (grant.kind === 'department' && grant.subjectId === member.departmentId)) {
        if (!role || rank[grant.role] > rank[role]) role = grant.role
      }
    }
    return role ? [{ kind: 'member' as const, subjectId: member.userId, role }] : []
  }) }
}
