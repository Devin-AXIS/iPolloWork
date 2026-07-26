import { createDenClient, readDenSettings } from "./den";

export async function saveInstalledSkillToiPolloWorkOrg(input: {
  skillText: string;
  shared?: "org" | "public" | null;
}): Promise<{ skillId: string; orgId: string; orgName: string }> {
  const settings = readDenSettings();
  const token = settings.authToken?.trim() ?? "";
  if (!token) {
    throw new Error("Sign in to iPolloWork Cloud in Settings to share with your team.");
  }

  const cloudClient = createDenClient({ baseUrl: settings.baseUrl, token });
  const created = await cloudClient.createOrgSkill("", {
    skillText: input.skillText,
    shared: input.shared === undefined ? null : input.shared,
  });

  return { skillId: created.id, orgId: "personal", orgName: "公共市场" };
}
