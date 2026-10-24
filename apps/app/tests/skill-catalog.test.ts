import { describe, expect, test } from "bun:test";
import { listPublicSkills, downloadPublicSkill } from "../src/app/lib/skill-catalog";

const item = { id: "public-proof", type: "skill", name: "research-skill", title: "调研技能", description: "Research", category: "research", authorName: "Fixture", updatedAt: "2026-10-19T00:00:00.000Z", latestVersion: { version: "1.0.0", digest: "0".repeat(64), minimumAppVersion: "0.50.18" } };
describe("public skill service contract", () => {
  test("uses the cloud skill endpoint and keeps pagination bounded", async () => {
    let target = "";
    const result = await listPublicSkills({ search: "调研", cursor: "next" }, async (input, init) => {
      target = String(input); expect(init?.redirect).toBe("error");
      return Response.json({ items: [item], nextCursor: null });
    });
    const url = new URL(target); expect(url.pathname).toBe("/api/v1/skills"); expect(url.searchParams.get("limit")).toBe("50"); expect(url.searchParams.get("search")).toBe("调研"); expect(result.items[0].type).toBe("skill");
  });
  test("an undeployed cloud endpoint gives an actionable message instead of fetching GitHub", async () => {
    let calls = 0;
    await expect(listPublicSkills({}, async () => { calls += 1; return new Response(null, { status: 404 }); })).rejects.toThrow("尚未开放技能市场接口"); expect(calls).toBe(1);
  });
  test("rejects plugin catalog entries and mismatched package digests", async () => {
    await expect(listPublicSkills({}, async () => Response.json({ items: [{ ...item, type: "extension" }], nextCursor: null }))).rejects.toThrow("返回格式不符合约定");
    const { publicSkillSchema } = await import("@ipollowork/types/skills");
    await expect(downloadPublicSkill(publicSkillSchema.parse(item), async () => new Response("not the requested package", { headers: { "X-iPollo-Artifact-SHA256": "0".repeat(64) } }))).rejects.toThrow("摘要校验失败");
  });
  test("accepts a binary response only when actual, header and catalog hashes match", async () => {
    const bytes = new TextEncoder().encode("test archive bytes");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
    const { publicSkillSchema } = await import("@ipollowork/types/skills");
    const result = await downloadPublicSkill(publicSkillSchema.parse({ ...item, latestVersion: { ...item.latestVersion, digest } }), async (input, init) => { expect(String(input)).toContain("/api/v1/skills/public-proof/versions/1.0.0/download"); expect(init?.redirect).toBe("error"); return new Response(bytes, { headers: { "X-iPollo-Artifact-SHA256": digest } }); });
    expect(result.file.name).toBe("research-skill-1.0.0.ipollowork-skill"); expect(result.source.digest).toBe(digest);
  });
});
