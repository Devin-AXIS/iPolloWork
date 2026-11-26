/** All active employees, selected departments or employees, or administrators only. */
export interface Audience {
  all: boolean;
  departments: string[];
  members: string[];
  includeSubdepartments?: boolean | undefined;
}

export const audienceScopes = ["admins", "everyone", "departments", "employees"] as const;
export type AudienceScope = (typeof audienceScopes)[number] | "mixed";
export type AudienceDraft = { scope: AudienceScope; audience: Audience };

export function audienceDraft(audience: Audience = { all: false, departments: [], members: [] }): AudienceDraft {
  const scope = audience.all ? "everyone" : audience.departments.length
    ? audience.members.length ? "mixed" : "departments"
    : audience.members.length ? "employees" : "admins";
  return { scope, audience };
}

export function audienceInput({ scope, audience }: AudienceDraft): Audience {
  const departments = scope === "departments" || scope === "mixed" ? audience.departments : [];
  return {
    all: scope === "everyone",
    departments,
    members: scope === "employees" || scope === "mixed" ? audience.members : [],
    ...(departments.length && audience.includeSubdepartments ? { includeSubdepartments: true } : {}),
  };
}

export function audienceReady(value: AudienceDraft): boolean {
  return value.scope === "admins" || value.scope === "everyone" ||
    (value.scope !== "employees" && value.audience.departments.length > 0) ||
    (value.scope !== "departments" && value.audience.members.length > 0);
}
