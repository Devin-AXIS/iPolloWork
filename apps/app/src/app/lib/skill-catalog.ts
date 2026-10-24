import { publicSkillCatalogSchema, type PublicSkill } from "@ipollowork/types/skills";
export type { PublicSkill } from "@ipollowork/types/skills";
import { MAX_SKILL_PACKAGE_BYTES } from "@ipollowork/types/skills";
import { readDenSettings } from "./den";
import { desktopFetchViaMain, desktopFetchBinaryViaMain } from "./desktop";
import { isDesktopRuntime } from "./runtime-env";

const fetchCatalog = (url: string, options: RequestInit, binary = false, fetcher?: typeof fetch) => {
  const request: RequestInit = { ...options, signal: AbortSignal.timeout(binary ? 120000 : 15000), redirect: "error" };
  if (fetcher) return fetcher(url, request);
  return isDesktopRuntime() ? binary ? desktopFetchBinaryViaMain(url, request, 120000) : desktopFetchViaMain(url, request, 15000) : fetch(url, request);
};
async function boundedSkillResponse(response: Response, maximum: number): Promise<ArrayBuffer> {
  if (Number(response.headers.get("content-length")) > maximum) throw new Error("技能内容超过大小限制。");
  const reader = response.body?.getReader(); if (!reader) throw new Error("技能服务返回了空内容。");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > maximum) { await reader.cancel(); throw new Error("技能内容超过大小限制。"); } chunks.push(next.value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes.buffer;
}

function publicAccess() {
  const settings = readDenSettings();
  return { origin: settings.baseUrl.replace(/\/$/u, ""), headers: settings.authToken ? { Authorization: `Bearer ${settings.authToken}` } : undefined };
}
export async function listPublicSkills(input: { search?: string; cursor?: string | null } = {}, fetcher?: typeof fetch) {
  const { origin, headers } = publicAccess(); const query = new URLSearchParams({ limit: "50" });
  if (input.search?.trim()) query.set("search", input.search.trim().slice(0, 160)); if (input.cursor) query.set("cursor", input.cursor);
  const response = await fetchCatalog(`${origin}/api/v1/skills?${query}`, { headers }, false, fetcher);
  if ([404, 405, 501].includes(response.status)) throw new Error("公开云端尚未开放技能市场接口，接口规范已准备好。");
  if (!response.ok) throw new Error(response.status === 401 ? "请登录后查看公开技能。" : "公开技能暂时无法加载，请稍后重试。");
  const parsed = publicSkillCatalogSchema.safeParse(JSON.parse(new TextDecoder().decode(await boundedSkillResponse(response, 2 * 1024 * 1024))));
  if (!parsed.success) throw new Error("云端技能接口返回格式不符合约定，请联系云端服务管理员。");
  return parsed.data;
}
export async function downloadPublicSkill(item: PublicSkill, fetcher?: typeof fetch) {
  const { origin, headers } = publicAccess();
  const response = await fetchCatalog(`${origin}/api/v1/skills/${encodeURIComponent(item.id)}/versions/${encodeURIComponent(item.latestVersion.version)}/download`, { headers }, true, fetcher);
  if (!response.ok) throw new Error(response.status === 401 ? "请先登录后下载技能。" : "技能已下架或当前版本无法下载，请刷新后重试。");
  if (Number(response.headers.get("content-length")) > MAX_SKILL_PACKAGE_BYTES) throw new Error("技能包不能超过 50 MB。");
  const bytes = await boundedSkillResponse(response, MAX_SKILL_PACKAGE_BYTES); if (bytes.byteLength > MAX_SKILL_PACKAGE_BYTES) throw new Error("技能包不能超过 50 MB。");
  const digest = await skillFileDigest(bytes);
  if (digest !== item.latestVersion.digest || response.headers.get("X-iPollo-Artifact-SHA256") !== digest) throw new Error("技能包摘要校验失败，未安装。");
  return { file: new File([bytes], `${item.name}-${item.latestVersion.version}.ipollowork-skill`, { type: "application/vnd.ipollowork.skill+zip" }), source: { origin, resourceId: item.id, digest } };
}
export async function skillFileDigest(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
}
