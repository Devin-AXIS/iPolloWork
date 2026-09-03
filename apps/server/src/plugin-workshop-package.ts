import { createHash } from "node:crypto";

import type { PluginPackageManifest, PluginWorkshopSourceBundle } from "@ipollowork/types/plugins";

import { ApiError } from "./errors.js";
import { parsePluginPackageManifest } from "./plugin-package-manifest.js";

const MANIFEST_FILE = "ipollowork.plugin.json";
const MAX_LOCALIZED_RESOURCE_BYTES = 4 * 1024 * 1024;
const MAX_LOCALIZED_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_PREPARED_PACKAGE_BYTES = 10 * 1024 * 1024;
const STATIC_CDN_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "unpkg.com",
]);
const SCRIPT_TAG_RE = /<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>\s*<\/script\s*>/gi;
const INLINE_SCRIPT_TAG_RE = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/gi;
const REMOTE_STRING_LITERAL_RE = /(["'])(https:\/\/[^"'\\\s<>]+)\1/g;
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const REMOTE_CSS_RE = /(?:@import\s+(?:url\()?\s*["']?https?:\/\/|url\(\s*["']?https?:\/\/)/i;

type StaticResourceKind = "script" | "stylesheet";

type DownloadedResource = {
  bytes: Buffer;
  contentType: string;
};

export type PluginWorkshopPackagePreparationOptions = {
  fetchResource?: (url: string, init: RequestInit) => Promise<Response>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function draftUsesNetworkCsp(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.resources)) return false;
  return value.resources.some((resource) => {
    if (!isRecord(resource) || !isRecord(resource.ui) || !isRecord(resource.ui.csp)) return false;
    const csp = resource.ui.csp;
    return ["connectDomains", "resourceDomains", "frameDomains", "baseUriDomains"]
      .some((key) => Array.isArray(csp[key]) && csp[key].length > 0);
  });
}

/**
 * Workshop drafts may temporarily omit the network permission while still declaring CDN CSP.
 * Treat that single cross-field error as authoring state so export can remove the CDN dependency.
 */
export function parsePluginWorkshopDraftManifest(value: unknown): PluginPackageManifest {
  try {
    return parsePluginPackageManifest(value);
  } catch (error) {
    if (!isRecord(value) || !draftUsesNetworkCsp(value) || !Array.isArray(value.permissions ?? [])) throw error;
    const permissions = Array.isArray(value.permissions) ? value.permissions : [];
    if (permissions.some((permission) => isRecord(permission) && permission.id === "network")) throw error;
    return parsePluginPackageManifest({
      ...value,
      permissions: [...permissions, {
        id: "network",
        reason: "Temporary Plugin Workshop build permission for declared remote UI resources.",
      }],
    });
  }
}

function decodeBundleFile(file: PluginWorkshopSourceBundle["files"][number]): Buffer {
  return Buffer.from(file.contentBase64, "base64");
}

function htmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function hasHtmlAttribute(tag: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|/?>)`, "i").test(tag);
}

function decodedHtmlUrl(value: string): string {
  return value.replaceAll("&amp;", "&");
}

function parsedHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(decodedHtmlUrl(value));
  } catch {
    throw new ApiError(400, "plugin_workshop_remote_resource_invalid", `Remote resource URL is invalid: ${value}`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ApiError(400, "plugin_workshop_remote_resource_invalid", `Only credential-free HTTPS resources can be localized: ${value}`);
  }
  if (!STATIC_CDN_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ApiError(
      400,
      "plugin_workshop_remote_resource_host_unsupported",
      `Automatic localization supports static resources from ${[...STATIC_CDN_HOSTS].join(", ")}; move ${url.hostname} assets into the plugin source`,
    );
  }
  return url;
}

function cspSourceAllowsUrl(source: string, url: URL): boolean {
  const normalized = source.toLowerCase();
  if (normalized === url.origin.toLowerCase()) return true;
  if (!normalized.startsWith("https://*.")) return false;
  const suffix = normalized.slice("https://*.".length);
  return url.port === "" && url.hostname.toLowerCase().endsWith(`.${suffix}`);
}

function assertDeclaredResourceUrl(url: URL, resourceDomains: string[]): void {
  if (resourceDomains.some((source) => cspSourceAllowsUrl(source, url))) return;
  throw new ApiError(
    400,
    "plugin_workshop_remote_resource_not_declared",
    `Remote resource ${url.href} must be declared in the UI resourceDomains before it can be localized`,
  );
}

async function readBoundedResponse(response: Response, url: string): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOCALIZED_RESOURCE_BYTES) {
    throw new ApiError(413, "plugin_workshop_remote_resource_too_large", `Remote resource exceeds 4 MB: ${url}`);
  }
  if (!response.body) {
    throw new ApiError(502, "plugin_workshop_remote_resource_empty", `Remote resource returned no body: ${url}`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_LOCALIZED_RESOURCE_BYTES) {
        throw new ApiError(413, "plugin_workshop_remote_resource_too_large", `Remote resource exceeds 4 MB: ${url}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

function assertExpectedContentType(kind: StaticResourceKind, contentType: string, url: string): void {
  const normalized = contentType.toLowerCase();
  const common = !normalized || normalized.includes("text/plain") || normalized.includes("application/octet-stream");
  const matchesKind = kind === "script"
    ? normalized.includes("javascript") || normalized.includes("ecmascript")
    : normalized.includes("text/css");
  if (common || matchesKind) {
    return;
  }
  const expected = kind === "script" ? "JavaScript" : "CSS";
  throw new ApiError(400, "plugin_workshop_remote_resource_type_invalid", `Expected ${expected} from ${url}, received ${contentType}`);
}

function assertSubresourceIntegrity(bytes: Buffer, integrity: string | null, url: string): void {
  if (!integrity) return;
  const supported = integrity.trim().split(/\s+/).flatMap((token) => {
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(token);
    return match ? [{ algorithm: match[1], digest: match[2] }] : [];
  });
  if (!supported.length || !supported.some((entry) => createHash(entry.algorithm).update(bytes).digest("base64") === entry.digest)) {
    throw new ApiError(400, "plugin_workshop_remote_resource_integrity_failed", `Subresource integrity verification failed for ${url}`);
  }
}

function inlineRemoteScriptReferences(html: string): { firstTagIndex: number; urls: URL[] } {
  const urls = new Map<string, URL>();
  let firstTagIndex = -1;
  for (const tagMatch of html.matchAll(INLINE_SCRIPT_TAG_RE)) {
    const tag = tagMatch[0];
    const openingTag = tag.slice(0, tag.indexOf(">") + 1);
    const type = htmlAttribute(openingTag, "type")?.toLowerCase();
    const references = [...tag.matchAll(REMOTE_STRING_LITERAL_RE)].flatMap((match) => {
      const rawUrl = match[2];
      if (!rawUrl) return [];
      let url: URL;
      try {
        url = new URL(decodedHtmlUrl(rawUrl));
      } catch {
        return [];
      }
      if (url.protocol !== "https:" || !/\.m?js$/i.test(url.pathname)) return [];
      return [parsedHttpsUrl(rawUrl)];
    });
    if (!references.length) continue;
    if (type && type !== "text/javascript" && type !== "application/javascript") {
      throw new ApiError(
        400,
        "plugin_workshop_remote_script_unsupported",
        "Remote scripts referenced by module or data script blocks must be bundled into the Plugin Workshop source before exporting",
      );
    }
    if (firstTagIndex < 0) firstTagIndex = tagMatch.index ?? 0;
    references.forEach((url) => urls.set(url.href, url));
  }
  return { firstTagIndex, urls: [...urls.values()] };
}

function localizedScriptTag(url: URL, bytes: Buffer): string {
  const script = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/<\/script/gi, "<\\/script");
  return `<script>/* Localized by iPolloWork from ${url.href} */\n${script}\n</script>`;
}

async function replaceAsync(
  value: string,
  pattern: RegExp,
  replacer: (match: string) => Promise<string>,
): Promise<string> {
  const matches = [...value.matchAll(pattern)];
  if (!matches.length) return value;
  const replacements = await Promise.all(matches.map((match) => replacer(match[0])));
  let cursor = 0;
  let output = "";
  matches.forEach((match, index) => {
    const position = match.index ?? 0;
    output += value.slice(cursor, position) + replacements[index];
    cursor = position + match[0].length;
  });
  return output + value.slice(cursor);
}

function assertNoUnsupportedRemoteMarkup(html: string, path: string): void {
  const withoutInlineCode = html
    .replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  const remoteAttribute = /\b(?:src|srcset|poster|data)\s*=\s*(?:"[^"]*https?:\/\/[^\"]*"|'[^']*https?:\/\/[^']*'|[^\s>]*https?:\/\/[^\s>]*)/i;
  const inlineCss = [
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((match) => match[1] ?? ""),
    ...[...html.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((match) => match[1] ?? match[2] ?? ""),
  ].join("\n");
  if (remoteAttribute.test(withoutInlineCode) || REMOTE_CSS_RE.test(inlineCss)) {
    throw new ApiError(
      400,
      "plugin_workshop_remote_resource_unsupported",
      `UI ${path} still contains a remote image, media, font, CSS import, or other resource; add that asset to the plugin source before exporting`,
    );
  }
  const remoteLink = [...withoutInlineCode.matchAll(LINK_TAG_RE)].some((match) => {
    const href = htmlAttribute(match[0], "href");
    return Boolean(href && /^https?:\/\//i.test(decodedHtmlUrl(href)));
  });
  if (remoteLink) {
    throw new ApiError(400, "plugin_workshop_remote_resource_unsupported", `UI ${path} contains a remote non-stylesheet link resource that cannot be localized automatically`);
  }
}

function removeNetworkPermissionLocalization(manifest: PluginPackageManifest): PluginPackageManifest["localization"] {
  if (!manifest.localization) return undefined;
  const translations = Object.fromEntries(Object.entries(manifest.localization.translations).map(([locale, translation]) => {
    if (!translation.permissions?.network) return [locale, translation];
    const { network: _network, ...permissions } = translation.permissions;
    const { permissions: _permissions, ...rest } = translation;
    return [locale, Object.keys(permissions).length ? { ...rest, permissions } : rest];
  }));
  return { ...manifest.localization, translations };
}

function packageHasNetworkCsp(manifest: PluginPackageManifest): boolean {
  return manifest.resources.some((resource) => resource.type === "ui" && [
    resource.ui?.csp?.connectDomains,
    resource.ui?.csp?.resourceDomains,
    resource.ui?.csp?.frameDomains,
    resource.ui?.csp?.baseUriDomains,
  ].some((domains) => Boolean(domains?.length)));
}

export async function preparePluginWorkshopSourceBundle(
  source: PluginWorkshopSourceBundle,
  options: PluginWorkshopPackagePreparationOptions = {},
): Promise<PluginWorkshopSourceBundle> {
  const manifestFile = source.files.find((file) => file.path === MANIFEST_FILE);
  if (!manifestFile) throw new ApiError(400, "plugin_package_manifest_missing", `${MANIFEST_FILE} is required`);
  const manifest = parsePluginWorkshopDraftManifest(JSON.parse(decodeBundleFile(manifestFile).toString("utf8")) as unknown);
  const fetchResource = options.fetchResource ?? fetch;
  const downloads = new Map<string, Promise<DownloadedResource>>();
  const localizedUrls: string[] = [];
  let localizedTotalBytes = 0;
  let removedResourceDomains = false;

  const download = (url: URL, kind: StaticResourceKind): Promise<DownloadedResource> => {
    const existing = downloads.get(url.href);
    if (existing) return existing;
    const pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetchResource(url.href, { redirect: "follow", signal: controller.signal });
        if (!response.ok) throw new ApiError(502, "plugin_workshop_remote_resource_failed", `Could not download ${url.href}: HTTP ${response.status}`);
        const finalUrl = parsedHttpsUrl(response.url || url.href);
        if (finalUrl.origin !== url.origin) {
          throw new ApiError(400, "plugin_workshop_remote_resource_redirect_blocked", `Remote resource redirected to another origin: ${url.href}`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        assertExpectedContentType(kind, contentType, url.href);
        const bytes = await readBoundedResponse(response, url.href);
        localizedTotalBytes += bytes.byteLength;
        if (localizedTotalBytes > MAX_LOCALIZED_TOTAL_BYTES) {
          throw new ApiError(413, "plugin_workshop_localized_resources_too_large", "Localized resources exceed the 8 MB build limit");
        }
        localizedUrls.push(url.href);
        return { bytes, contentType };
      } finally {
        clearTimeout(timer);
      }
    })();
    downloads.set(url.href, pending);
    return pending;
  };

  const filesByPath = new Map(source.files.map((file) => [file.path, file]));
  const resources = await Promise.all(manifest.resources.map(async (resource) => {
    if (resource.type !== "ui" || !resource.path || !resource.ui) return resource;
    const sourceFile = filesByPath.get(resource.path);
    if (!sourceFile) return resource;
    const resourceDomains = resource.ui.csp?.resourceDomains ?? [];
    let html = decodeBundleFile(sourceFile).toString("utf8");

    const inlineReferences = inlineRemoteScriptReferences(html);
    if (inlineReferences.urls.length) {
      const dependencies = await Promise.all(inlineReferences.urls.map(async (url) => {
        assertDeclaredResourceUrl(url, resourceDomains);
        return { url, downloaded: await download(url, "script") };
      }));
      const emittedHashes = new Set<string>();
      const dependencyTags = dependencies.flatMap(({ url, downloaded }) => {
        const hash = createHash("sha256").update(downloaded.bytes).digest("hex");
        if (emittedHashes.has(hash)) return [];
        emittedHashes.add(hash);
        return [localizedScriptTag(url, downloaded.bytes)];
      });
      html = `${html.slice(0, inlineReferences.firstTagIndex)}${dependencyTags.join("\n")}\n${html.slice(inlineReferences.firstTagIndex)}`;
    }

    html = await replaceAsync(html, SCRIPT_TAG_RE, async (tag) => {
      const rawUrl = htmlAttribute(tag, "src");
      if (!rawUrl || !/^https:\/\//i.test(decodedHtmlUrl(rawUrl))) return tag;
      if (hasHtmlAttribute(tag, "async") || hasHtmlAttribute(tag, "defer") || htmlAttribute(tag, "type")?.toLowerCase() === "module") {
        throw new ApiError(400, "plugin_workshop_remote_script_unsupported", `Async, deferred, and module scripts must be bundled into ${resource.path} before exporting`);
      }
      const url = parsedHttpsUrl(rawUrl);
      assertDeclaredResourceUrl(url, resourceDomains);
      const downloaded = await download(url, "script");
      assertSubresourceIntegrity(downloaded.bytes, htmlAttribute(tag, "integrity"), url.href);
      return localizedScriptTag(url, downloaded.bytes);
    });

    html = await replaceAsync(html, LINK_TAG_RE, async (tag) => {
      const rel = htmlAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
      const rawUrl = htmlAttribute(tag, "href");
      if (!rel.includes("stylesheet") || !rawUrl || !/^https:\/\//i.test(decodedHtmlUrl(rawUrl))) return tag;
      const url = parsedHttpsUrl(rawUrl);
      assertDeclaredResourceUrl(url, resourceDomains);
      const downloaded = await download(url, "stylesheet");
      assertSubresourceIntegrity(downloaded.bytes, htmlAttribute(tag, "integrity"), url.href);
      const stylesheet = new TextDecoder("utf-8", { fatal: true }).decode(downloaded.bytes);
      if (REMOTE_CSS_RE.test(stylesheet)) {
        throw new ApiError(400, "plugin_workshop_remote_stylesheet_nested_resource", `Stylesheet ${url.href} contains another remote import or asset`);
      }
      const media = htmlAttribute(tag, "media");
      return `<style${media ? ` media=${JSON.stringify(media)}` : ""}>/* Localized by iPolloWork from ${url.href} */\n${stylesheet.replace(/<\/style/gi, "<\\/style")}\n</style>`;
    });

    assertNoUnsupportedRemoteMarkup(html, resource.path);
    filesByPath.set(resource.path, { path: resource.path, contentBase64: Buffer.from(html, "utf8").toString("base64") });

    const csp = resource.ui.csp;
    if (!csp?.resourceDomains?.length) return resource;
    removedResourceDomains = true;
    const { resourceDomains: _resourceDomains, ...remainingCsp } = csp;
    const ui = { ...resource.ui, ...(Object.keys(remainingCsp).length ? { csp: remainingCsp } : {}) };
    if (!Object.keys(remainingCsp).length) delete ui.csp;
    return { ...resource, ui };
  }));

  const manifestWithResources: PluginPackageManifest = { ...manifest, resources };
  const canRemoveNetworkPermission = removedResourceDomains && !packageHasNetworkCsp(manifestWithResources);
  const permissions = canRemoveNetworkPermission
    ? manifest.permissions?.filter((permission) => permission.id !== "network")
    : manifest.permissions;
  const removedNetworkPermission = Boolean(canRemoveNetworkPermission && manifest.permissions?.some((permission) => permission.id === "network"));
  const { permissions: _permissions, localization: _localization, ...manifestBase } = manifestWithResources;
  const localization = canRemoveNetworkPermission ? removeNetworkPermissionLocalization(manifest) : manifest.localization;
  const preparedManifest = parsePluginPackageManifest({
    ...manifestBase,
    ...(permissions?.length ? { permissions } : {}),
    ...(localization ? { localization } : {}),
  });

  if ((localizedUrls.length || removedResourceDomains) && (manifest.package?.checksum || manifest.package?.signature)) {
    throw new ApiError(400, "plugin_workshop_signed_package_cannot_be_rewritten", "Signed or checksummed packages cannot be rewritten; add local assets and update the package signature instead");
  }
  filesByPath.set(MANIFEST_FILE, {
    path: MANIFEST_FILE,
    contentBase64: Buffer.from(`${JSON.stringify(preparedManifest, null, 2)}\n`, "utf8").toString("base64"),
  });
  const files = source.files.map((file) => filesByPath.get(file.path) ?? file);
  const totalBytes = files.reduce((total, file) => total + decodeBundleFile(file).byteLength, 0);
  if (totalBytes > MAX_PREPARED_PACKAGE_BYTES) {
    throw new ApiError(413, "plugin_workshop_prepared_package_too_large", "Prepared plugin package exceeds the 10 MB limit");
  }
  return {
    ...source,
    files,
    preparation: {
      localizedUrls: [...new Set(localizedUrls)],
      removedNetworkPermission,
    },
  };
}
