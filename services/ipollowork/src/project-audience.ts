import { audienceDraft, audienceInput, type AudienceDraft } from "./audience-scope.js";

type ProjectRole = "view" | "participate" | "maintain";
type ProjectGrant = { kind: "member" | "department"; subjectId: string; role: ProjectRole };
export type ProjectAccess = { mode: "enterprise" | "selected"; grants: ProjectGrant[] };

export function projectAudience(access: ProjectAccess): AudienceDraft {
  return audienceDraft({
    all: access.mode === "enterprise",
    departments: access.grants.filter(grant => grant.kind === "department").map(grant => grant.subjectId),
    members: access.grants.filter(grant => grant.kind === "member").map(grant => grant.subjectId),
  });
}

export function projectScopeAccess(
  draft: AudienceDraft, role: ProjectRole | "", previous: ProjectGrant[] = [],
): ProjectAccess {
  const audience = audienceInput(draft);
  const roles = new Map(previous.map(grant => [grant.kind + ":" + grant.subjectId, grant.role]));
  const grant = (kind: ProjectGrant["kind"], subjectId: string): ProjectGrant => ({
    kind, subjectId, role: role || roles.get(kind + ":" + subjectId) || "view",
  });
  return {
    mode: audience.all ? "enterprise" : "selected",
    grants: [
      ...audience.departments.map(id => grant("department", id)),
      ...audience.members.map(id => grant("member", id)),
    ],
  };
}
