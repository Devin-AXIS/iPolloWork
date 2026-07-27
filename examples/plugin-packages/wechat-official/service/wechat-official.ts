import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";

type AuthorizationRuntime = {
  getCredential(methodId: string, accountId?: string): Promise<Readonly<Record<string, string>> | null>;
};

type WeChatRuntime = {
  plugin: Readonly<{ id: string; version: string }>;
  authorization: AuthorizationRuntime;
};

type ApiRequest = {
  method?: "GET" | "POST";
  body?: Record<string, unknown> | FormData;
};

type AccessToken = {
  appId: string;
  value: string;
  expiresAt: number;
};

const DEFAULT_API_BASE = "https://api.weixin.qq.com";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ARTICLES_PER_DRAFT = 8;
const MAX_ARTICLE_CONTENT_LENGTH = 200_000;
const MAX_MENU_JSON_LENGTH = 10_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function field(input: Record<string, unknown>, key: string): unknown {
  return Reflect.get(input, key);
}

function requiredText(input: Record<string, unknown>, key: string, maxLength = 256): string {
  const value = text(field(input, key))?.trim() ?? "";
  if (!value) throw new Error(`${key} is required`);
  if (value.length > maxLength) throw new Error(`${key} is too long`);
  return value;
}

function optionalText(input: Record<string, unknown>, key: string, maxLength: number): string {
  const value = text(field(input, key))?.trim() ?? "";
  if (value.length > maxLength) throw new Error(`${key} is too long`);
  return value;
}

function requiredInteger(input: Record<string, unknown>, key: string, minimum = 0): number {
  const value = numberValue(field(input, key));
  if (value === null || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${key} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function boundedInteger(input: Record<string, unknown>, key: string, fallback: number, maximum: number): number {
  const value = numberValue(field(input, key));
  if (value === null) return fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
  return Math.min(value, maximum);
}

function requiredBoolean(input: Record<string, unknown>, key: string): boolean {
  const value = booleanValue(field(input, key));
  if (value === null) throw new Error(`${key} must be a boolean`);
  return value;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean {
  const value = booleanValue(field(input, key));
  return value ?? false;
}

function optionalHttpsUrl(input: Record<string, unknown>, key: string): string {
  const value = optionalText(input, key, 2_000);
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTPS URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${key} must be a valid HTTPS URL`);
  return value;
}

function mimeType(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      throw new Error("sourcePath must point to a JPG, PNG, GIF, or WebP image");
  }
}

async function resolveWorkspaceImage(input: Record<string, unknown>, context: Record<string, unknown>): Promise<{ path: string; fileName: string }> {
  const workspaceDirectory = requiredText(context, "directory", 4_000);
  const sourcePath = requiredText(input, "sourcePath", 1_000).replaceAll("\\", "/");
  if (sourcePath.startsWith("/") || sourcePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("sourcePath must be a safe path inside the active workspace");
  }
  const root = await realpath(resolve(workspaceDirectory));
  const path = await realpath(resolve(root, sourcePath));
  const pathFromRoot = relative(root, path);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || pathFromRoot.includes("/../")) {
    throw new Error("sourcePath must stay inside the active workspace");
  }
  const fileName = basename(path);
  mimeType(fileName);
  return { path, fileName };
}

function article(input: Record<string, unknown>): Record<string, unknown> {
  const title = requiredText(input, "title", 128);
  const content = requiredText(input, "content", MAX_ARTICLE_CONTENT_LENGTH);
  const thumbMediaId = requiredText(input, "thumbMediaId", 256);
  const sourceUrl = optionalHttpsUrl(input, "contentSourceUrl");
  const author = optionalText(input, "author", 64);
  const digest = optionalText(input, "digest", 120);
  return {
    title,
    author,
    digest,
    content,
    content_source_url: sourceUrl,
    thumb_media_id: thumbMediaId,
    show_cover_pic: optionalBoolean(input, "showCoverPic") ? 1 : 0,
    need_open_comment: optionalBoolean(input, "needOpenComment") ? 1 : 0,
    only_fans_can_comment: optionalBoolean(input, "onlyFansCanComment") ? 1 : 0,
  };
}

function articleList(input: Record<string, unknown>): Record<string, unknown>[] {
  const values = records(field(input, "articles"));
  if (!values.length) throw new Error("articles must contain at least one article");
  if (values.length > MAX_ARTICLES_PER_DRAFT) throw new Error(`articles must contain at most ${MAX_ARTICLES_PER_DRAFT} articles`);
  return values.map(article);
}

function maskAppId(value: string): string {
  return value.length <= 6 ? "••••" : `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

function apiBase(): string {
  return (process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
}

function wechatError(payload: Record<string, unknown>, action: string): Error | null {
  const errcode = numberValue(Reflect.get(payload, "errcode"));
  if (errcode === null || errcode === 0) return null;
  const message = text(Reflect.get(payload, "errmsg"));
  return new Error(`WeChat ${action} failed with ${errcode}${message ? `: ${message}` : ""}`);
}

export default async function createWeChatOfficialService(runtime: WeChatRuntime) {
  let cachedToken: AccessToken | null = null;

  async function credential(): Promise<{ appId: string; appSecret: string }> {
    const stored = await runtime.authorization.getCredential("wechat-official-account");
    const appId = stored?.appId?.trim() ?? "";
    const appSecret = stored?.appSecret?.trim() ?? "";
    if (!appId || !appSecret) throw new Error("Connect a WeChat Official Account before using this action");
    return { appId, appSecret };
  }

  async function accessToken(): Promise<{ value: string; appId: string }> {
    const account = await credential();
    if (cachedToken && cachedToken.appId === account.appId && cachedToken.expiresAt > Date.now() + 60_000) {
      return { value: cachedToken.value, appId: account.appId };
    }
    const url = new URL("/cgi-bin/token", `${apiBase()}/`);
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", account.appId);
    url.searchParams.set("secret", account.appSecret);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const payload = record(await response.json().catch(() => null));
    if (!response.ok || !payload) throw new Error(`WeChat credential validation failed with HTTP ${response.status}`);
    const error = wechatError(payload, "credential validation");
    if (error) throw error;
    const value = text(Reflect.get(payload, "access_token"))?.trim() ?? "";
    if (!value) throw new Error("WeChat credential validation returned no access token");
    const expiresIn = numberValue(Reflect.get(payload, "expires_in")) ?? 7_200;
    cachedToken = { appId: account.appId, value, expiresAt: Date.now() + Math.max(60, expiresIn) * 1_000 };
    return { value, appId: account.appId };
  }

  async function request(path: string, options: ApiRequest = {}): Promise<Record<string, unknown>> {
    const token = await accessToken();
    const url = new URL(path, `${apiBase()}/`);
    url.searchParams.set("access_token", token.value);
    const multipart = options.body instanceof FormData;
    const response = await fetch(url, {
      method: options.method ?? "POST",
      headers: multipart ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : multipart ? options.body : JSON.stringify(options.body),
      signal: AbortSignal.timeout(25_000),
    });
    const payload = record(await response.json().catch(() => null));
    if (!response.ok || !payload) throw new Error(`WeChat request failed with HTTP ${response.status}`);
    const error = wechatError(payload, path);
    if (error) throw error;
    return payload;
  }

  async function uploadImage(input: Record<string, unknown>, context: Record<string, unknown>, kind: "article" | "cover") {
    const source = await resolveWorkspaceImage(input, context);
    const information = await stat(source.path);
    if (!information.isFile()) throw new Error("sourcePath must point to a file");
    if (information.size > MAX_IMAGE_BYTES) throw new Error("image is too large to upload");
    const bytes = await readFile(source.path);
    const form = new FormData();
    form.append("media", new Blob([bytes], { type: mimeType(source.fileName) }), source.fileName);
    const payload = await request(
      kind === "article" ? "/cgi-bin/media/uploadimg" : "/cgi-bin/material/add_material?type=image",
      { body: form },
    );
    return kind === "article"
      ? { sourcePath: requiredText(input, "sourcePath", 1_000), url: text(Reflect.get(payload, "url")) }
      : {
        sourcePath: requiredText(input, "sourcePath", 1_000),
        mediaId: text(Reflect.get(payload, "media_id")),
        url: text(Reflect.get(payload, "url")),
      };
  }

  return {
    actions: {
      "connection-status": async () => {
        const token = await accessToken();
        return { connected: true, account: { appId: maskAppId(token.appId) }, pluginVersion: runtime.plugin.version };
      },

      "upload-article-image": async (input: Record<string, unknown>, context: Record<string, unknown>) => uploadImage(input, context, "article"),
      "upload-cover-image": async (input: Record<string, unknown>, context: Record<string, unknown>) => uploadImage(input, context, "cover"),

      "create-draft": async (input: Record<string, unknown>) => {
        const payload = await request("/cgi-bin/draft/add", { body: { articles: articleList(input) } });
        return { mediaId: text(Reflect.get(payload, "media_id")) };
      },

      "get-draft": async (input: Record<string, unknown>) => {
        const payload = await request("/cgi-bin/draft/get", { body: { media_id: requiredText(input, "mediaId", 256) } });
        return { newsItem: records(Reflect.get(payload, "news_item")) };
      },

      "list-drafts": async (input: Record<string, unknown>) => {
        const payload = await request("/cgi-bin/draft/batchget", {
          body: {
            offset: boundedInteger(input, "offset", 0, 100_000),
            count: Math.max(1, Math.min(20, boundedInteger(input, "limit", 20, 20))),
            no_content: 1,
          },
        });
        return {
          totalCount: numberValue(Reflect.get(payload, "total_count")),
          itemCount: numberValue(Reflect.get(payload, "item_count")),
          items: records(Reflect.get(payload, "item")),
        };
      },

      "update-draft": async (input: Record<string, unknown>) => {
        const articleInput = record(field(input, "article"));
        if (!articleInput) throw new Error("article must be an object");
        await request("/cgi-bin/draft/update", {
          body: {
            media_id: requiredText(input, "mediaId", 256),
            index: requiredInteger(input, "index"),
            articles: article(articleInput),
          },
        });
        return { updated: true };
      },

      "submit-publish": async (input: Record<string, unknown>) => {
        const payload = await request("/cgi-bin/freepublish/submit", { body: { media_id: requiredText(input, "mediaId", 256) } });
        return { publishId: text(Reflect.get(payload, "publish_id")) };
      },

      "get-publish-status": async (input: Record<string, unknown>) => {
        const payload = await request("/cgi-bin/freepublish/get", { body: { publish_id: requiredText(input, "publishId", 256) } });
        return {
          publishId: text(Reflect.get(payload, "publish_id")),
          publishStatus: numberValue(Reflect.get(payload, "publish_status")),
          articleId: text(Reflect.get(payload, "article_id")),
          articleDetail: record(Reflect.get(payload, "article_detail")),
          failIdx: records(Reflect.get(payload, "fail_idx")),
        };
      },

      "list-comments": async (input: Record<string, unknown>) => {
        const payload = await request("/cgi-bin/comment/list", {
          body: {
            msg_data_id: requiredInteger(input, "msgDataId", 1),
            index: boundedInteger(input, "index", 0, 10_000),
            count: Math.max(1, Math.min(50, boundedInteger(input, "limit", 20, 50))),
            type: 0,
          },
        });
        return {
          totalCount: numberValue(Reflect.get(payload, "total_count")),
          commentList: records(Reflect.get(payload, "comment")),
        };
      },

      "reply-comment": async (input: Record<string, unknown>) => {
        await request("/cgi-bin/comment/reply/add", {
          body: {
            msg_data_id: requiredInteger(input, "msgDataId", 1),
            index: requiredInteger(input, "index"),
            user_comment_id: requiredInteger(input, "userCommentId", 1),
            content: requiredText(input, "content", 600),
          },
        });
        return { replied: true };
      },

      "set-comment-featured": async (input: Record<string, unknown>) => {
        const featured = requiredBoolean(input, "featured");
        await request(featured ? "/cgi-bin/comment/markelect" : "/cgi-bin/comment/unmarkelect", {
          body: {
            msg_data_id: requiredInteger(input, "msgDataId", 1),
            index: requiredInteger(input, "index"),
            user_comment_id: requiredInteger(input, "userCommentId", 1),
          },
        });
        return { featured };
      },

      "delete-comment": async (input: Record<string, unknown>) => {
        await request("/cgi-bin/comment/delete", {
          body: {
            msg_data_id: requiredInteger(input, "msgDataId", 1),
            index: requiredInteger(input, "index"),
            user_comment_id: requiredInteger(input, "userCommentId", 1),
          },
        });
        return { deleted: true };
      },

      "set-comment-state": async (input: Record<string, unknown>) => {
        const open = requiredBoolean(input, "open");
        await request(open ? "/cgi-bin/comment/open" : "/cgi-bin/comment/close", {
          body: {
            msg_data_id: requiredInteger(input, "msgDataId", 1),
            index: requiredInteger(input, "index"),
          },
        });
        return { open };
      },

      "list-followers": async (input: Record<string, unknown>) => {
        const nextOpenId = optionalText(input, "nextOpenId", 256);
        const payload = await request(`/cgi-bin/user/get${nextOpenId ? `?next_openid=${encodeURIComponent(nextOpenId)}` : ""}`, { method: "GET" });
        const data = record(Reflect.get(payload, "data"));
        return {
          total: numberValue(Reflect.get(payload, "total")),
          count: numberValue(Reflect.get(payload, "count")),
          nextOpenId: text(Reflect.get(payload, "next_openid")),
          openIds: data ? (Array.isArray(Reflect.get(data, "openid")) ? Reflect.get(data, "openid") : []) : [],
        };
      },

      "get-menu": async () => request("/cgi-bin/menu/get", { method: "GET" }),

      "update-menu": async (input: Record<string, unknown>) => {
        const menu = record(field(input, "menu"));
        if (!menu) throw new Error("menu must be an object");
        if (JSON.stringify(menu).length > MAX_MENU_JSON_LENGTH) throw new Error("menu is too large");
        await request("/cgi-bin/menu/create", { body: menu });
        return { updated: true };
      },

      "send-customer-text": async (input: Record<string, unknown>) => {
        await request("/cgi-bin/message/custom/send", {
          body: {
            touser: requiredText(input, "openId", 256),
            msgtype: "text",
            text: { content: requiredText(input, "content", 2_000) },
          },
        });
        return { sent: true };
      },
    },
  };
}
