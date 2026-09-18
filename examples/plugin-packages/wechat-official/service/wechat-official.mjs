import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const DEFAULT_API_BASE = "https://api.weixin.qq.com";
const AUTHORIZATION_METHOD_ID = "wechat-official-account";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ARTICLES_PER_DRAFT = 8;
const MAX_ARTICLE_CONTENT_LENGTH = 200_000;
const MAX_MENU_JSON_LENGTH = 10_000;
const MAX_STUDIO_REQUEST_BYTES = 256 * 1024;
const STUDIO_ACTION_RE = /^\/api\/actions\/([a-z-]+)$/;
const STUDIO_ASSETS = new Map([
    ["/", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
    ["/app.css", { fileName: "app.css", contentType: "text/css; charset=utf-8" }],
    ["/app.js", { fileName: "app.js", contentType: "text/javascript; charset=utf-8" }],
]);
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : null;
}
function records(value) {
    return Array.isArray(value) ? value.map(record).filter((item) => item !== null) : [];
}
function text(value) {
    return typeof value === "string" ? value : null;
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function booleanValue(value) {
    return typeof value === "boolean" ? value : null;
}
function field(input, key) {
    return Reflect.get(input, key);
}
function requiredText(input, key, maxLength = 256) {
    const value = text(field(input, key))?.trim() ?? "";
    if (!value)
        throw new Error(`${key} is required`);
    if (value.length > maxLength)
        throw new Error(`${key} is too long`);
    return value;
}
function optionalText(input, key, maxLength) {
    const value = text(field(input, key))?.trim() ?? "";
    if (value.length > maxLength)
        throw new Error(`${key} is too long`);
    return value;
}
function requiredInteger(input, key, minimum = 0) {
    const value = numberValue(field(input, key));
    if (value === null || !Number.isInteger(value) || value < minimum) {
        throw new Error(`${key} must be an integer greater than or equal to ${minimum}`);
    }
    return value;
}
function boundedInteger(input, key, fallback, maximum) {
    const value = numberValue(field(input, key));
    if (value === null)
        return fallback;
    if (!Number.isInteger(value) || value < 0)
        throw new Error(`${key} must be a non-negative integer`);
    return Math.min(value, maximum);
}
function requiredBoolean(input, key) {
    const value = booleanValue(field(input, key));
    if (value === null)
        throw new Error(`${key} must be a boolean`);
    return value;
}
function optionalBoolean(input, key) {
    const value = booleanValue(field(input, key));
    return value ?? false;
}
function optionalHttpsUrl(input, key) {
    const value = optionalText(input, key, 2_000);
    if (!value)
        return "";
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error(`${key} must be a valid HTTPS URL`);
    }
    if (url.protocol !== "https:")
        throw new Error(`${key} must be a valid HTTPS URL`);
    return value;
}
function mimeType(fileName) {
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
async function resolveWorkspaceImage(input, context) {
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
function article(input) {
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
function articleList(input) {
    const values = records(field(input, "articles"));
    if (!values.length)
        throw new Error("articles must contain at least one article");
    if (values.length > MAX_ARTICLES_PER_DRAFT)
        throw new Error(`articles must contain at most ${MAX_ARTICLES_PER_DRAFT} articles`);
    return values.map(article);
}
function maskAppId(value) {
    return value.length <= 6 ? "••••" : `${value.slice(0, 3)}••••${value.slice(-3)}`;
}
function apiBase() {
    return (process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
}
function wechatError(payload, action) {
    const errcode = numberValue(Reflect.get(payload, "errcode"));
    if (errcode === null || errcode === 0)
        return null;
    const message = text(Reflect.get(payload, "errmsg"));
    return new Error(`WeChat ${action} failed with ${errcode}${message ? `: ${message}` : ""}`);
}
async function readStudioJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_STUDIO_REQUEST_BYTES)
            throw new Error("请求内容超过 256 KiB");
        chunks.push(chunk);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const value = record(parsed);
    if (!value)
        throw new Error("请求必须是 JSON 对象");
    return value;
}
function studioErrorMessage(error) {
    if (!(error instanceof Error))
        return "操作失败，请稍后重试";
    if (error.message.startsWith("WeChat "))
        return "公众号接口拒绝了请求，请检查账号权限与内容后重试";
    if (error.message.includes("fetch failed") || error.name === "AbortError")
        return "无法连接公众号接口，请检查网络后重试";
    return error.message;
}
export default async function createWeChatOfficialService(runtime) {
    const cachedTokens = new Map();
    let studioServer = null;
    let studioStart = null;
    const studioToken = randomBytes(32).toString("base64url");
    async function accountConnections() {
        return (await runtime.authorization.listConnections())
            .filter((connection) => connection.methodId === AUTHORIZATION_METHOD_ID);
    }
    async function storedCredential(accountId) {
        return accountId
            ? runtime.authorization.readCredential(accountId, AUTHORIZATION_METHOD_ID)
            : runtime.authorization.getCredential(AUTHORIZATION_METHOD_ID);
    }
    async function credential(accountId = "") {
        const connections = await accountConnections();
        const stored = await storedCredential(accountId);
        const appId = stored?.appId?.trim() ?? "";
        const appSecret = stored?.appSecret?.trim() ?? "";
        if (!appId || !appSecret)
            throw new Error(accountId ? `未找到公众号账号“${accountId}”，请重新选择或添加账号` : "请先添加微信公众号账号");
        if (accountId)
            return { accountId, appId, appSecret };
        const matches = await Promise.all(connections.map(async (connection) => ({
            accountId: connection.accountId,
            values: await runtime.authorization.readCredential(connection.accountId, AUTHORIZATION_METHOD_ID),
        })));
        const active = matches.find((candidate) => candidate.values?.appId === appId && candidate.values?.appSecret === appSecret);
        return { accountId: active?.accountId ?? connections[0]?.accountId ?? "default", appId, appSecret };
    }
    async function fetchAccessToken(account) {
        const url = new URL("/cgi-bin/token", `${apiBase()}/`);
        url.searchParams.set("grant_type", "client_credential");
        url.searchParams.set("appid", account.appId);
        url.searchParams.set("secret", account.appSecret);
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        const payload = record(await response.json().catch(() => null));
        if (!response.ok || !payload)
            throw new Error(`WeChat credential validation failed with HTTP ${response.status}`);
        const error = wechatError(payload, "credential validation");
        if (error)
            throw error;
        const value = text(Reflect.get(payload, "access_token"))?.trim() ?? "";
        if (!value)
            throw new Error("WeChat credential validation returned no access token");
        const expiresIn = numberValue(Reflect.get(payload, "expires_in")) ?? 7_200;
        return { value, expiresAt: Date.now() + Math.max(60, expiresIn) * 1_000 };
    }
    async function accessToken(accountId = "") {
        const account = await credential(accountId);
        const cachedToken = cachedTokens.get(account.accountId);
        if (cachedToken && cachedToken.appId === account.appId && cachedToken.expiresAt > Date.now() + 60_000) {
            return { value: cachedToken.value, accountId: account.accountId, appId: account.appId };
        }
        const fetched = await fetchAccessToken(account);
        cachedTokens.set(account.accountId, { appId: account.appId, ...fetched });
        return { value: fetched.value, accountId: account.accountId, appId: account.appId };
    }
    async function request(accountId, path, options = {}) {
        const token = await accessToken(accountId);
        const url = new URL(path, `${apiBase()}/`);
        url.searchParams.set("access_token", token.value);
        const multipart = options.body instanceof FormData;
        const body = options.body === undefined
            ? undefined
            : options.body instanceof FormData ? options.body : JSON.stringify(options.body);
        const response = await fetch(url, {
            method: options.method ?? "POST",
            headers: multipart ? undefined : { "content-type": "application/json" },
            body,
            signal: AbortSignal.timeout(25_000),
        });
        const payload = record(await response.json().catch(() => null));
        if (!response.ok || !payload)
            throw new Error(`WeChat request failed with HTTP ${response.status}`);
        const error = wechatError(payload, path);
        if (error)
            throw error;
        return payload;
    }
    async function accountSummaries() {
        const connections = await accountConnections();
        return Promise.all(connections.map(async (connection) => {
            const stored = await runtime.authorization.readCredential(connection.accountId, AUTHORIZATION_METHOD_ID);
            const appId = stored?.appId?.trim() ?? "";
            return {
                accountId: connection.accountId,
                appId: appId ? maskAppId(appId) : "未配置",
                updatedAt: connection.updatedAt,
            };
        }));
    }
    async function activeAccountId() {
        try {
            return (await credential()).accountId;
        }
        catch {
            return null;
        }
    }
    function requestedAccountId(input) {
        return optionalText(input, "accountId", 80);
    }
    async function saveStudioAccount(input) {
        const accountId = requiredText(input, "accountId", 80);
        const existing = await runtime.authorization.readCredential(accountId, AUTHORIZATION_METHOD_ID);
        const appId = optionalText(input, "appId", 128) || existing?.appId?.trim() || "";
        const appSecret = optionalText(input, "appSecret", 256) || existing?.appSecret?.trim() || "";
        if (!appId || !appSecret)
            throw new Error("新增账号需要填写 AppID 和 AppSecret");
        const token = await fetchAccessToken({ appId, appSecret });
        await runtime.authorization.saveCredential(AUTHORIZATION_METHOD_ID, accountId, { appId, appSecret });
        cachedTokens.set(accountId, { appId, ...token });
        return actions["studio-state"]({ accountId }, { directory: runtime.workspace.root });
    }
    async function deleteStudioAccount(accountId) {
        const normalized = accountId.trim();
        if (!normalized)
            throw new Error("accountId is required");
        if (!await runtime.authorization.revokeAccount(normalized))
            throw new Error(`未找到公众号账号“${normalized}”`);
        cachedTokens.delete(normalized);
        return actions["studio-state"]({}, { directory: runtime.workspace.root });
    }
    async function uploadImage(input, context, kind) {
        const source = await resolveWorkspaceImage(input, context);
        const information = await stat(source.path);
        if (!information.isFile())
            throw new Error("sourcePath must point to a file");
        if (information.size > MAX_IMAGE_BYTES)
            throw new Error("image is too large to upload");
        const bytes = await readFile(source.path);
        const form = new FormData();
        form.append("media", new Blob([bytes], { type: mimeType(source.fileName) }), source.fileName);
        const payload = await request(requestedAccountId(input), kind === "article" ? "/cgi-bin/media/uploadimg" : "/cgi-bin/material/add_material?type=image", { body: form });
        return kind === "article"
            ? { sourcePath: requiredText(input, "sourcePath", 1_000), url: text(Reflect.get(payload, "url")) }
            : {
                sourcePath: requiredText(input, "sourcePath", 1_000),
                mediaId: text(Reflect.get(payload, "media_id")),
                url: text(Reflect.get(payload, "url")),
            };
    }
    const actions = {
        "open-workbench": async (input) => {
            const studio = await ensureStudioStarted();
            const hash = new URLSearchParams({ token: studioToken });
            const accountId = requestedAccountId(input);
            if (accountId)
                hash.set("accountId", accountId);
            return { url: `${studio.origin}/#${hash}` };
        },
        "connection-status": async (input) => {
            const token = await accessToken(requestedAccountId(input));
            return {
                connected: true,
                account: { accountId: token.accountId, appId: maskAppId(token.appId) },
                accounts: await accountSummaries(),
                pluginVersion: runtime.plugin.version,
            };
        },
        "select-account": async (input) => {
            const accountId = requiredText(input, "accountId", 80);
            if (!await runtime.authorization.setActiveAccount(AUTHORIZATION_METHOD_ID, accountId))
                throw new Error(`未找到公众号账号“${accountId}”`);
            const connection = await actions["connection-status"]({ accountId }, {});
            return { selected: true, ...connection };
        },
        "studio-state": async (input, context) => {
            const accounts = await accountSummaries();
            const selectedAccountId = requestedAccountId(input) || await activeAccountId() || accounts[0]?.accountId || null;
            let connection;
            try {
                connection = await actions["connection-status"](selectedAccountId ? { ...input, accountId: selectedAccountId } : input, context);
            }
            catch (error) {
                return {
                    connection: { connected: false, message: studioErrorMessage(error), pluginVersion: runtime.plugin.version },
                    accounts,
                    activeAccountId: selectedAccountId,
                    drafts: { totalCount: 0, itemCount: 0, items: [] },
                };
            }
            try {
                return {
                    connection,
                    accounts,
                    activeAccountId: connection.account.accountId,
                    drafts: await actions["list-drafts"]({ ...input, accountId: connection.account.accountId }, context),
                };
            }
            catch (error) {
                return {
                    connection,
                    accounts,
                    activeAccountId: connection.account.accountId,
                    drafts: { totalCount: 0, itemCount: 0, items: [] },
                    draftsError: studioErrorMessage(error),
                };
            }
        },
        "upload-article-image": async (input, context) => uploadImage(input, context, "article"),
        "upload-cover-image": async (input, context) => uploadImage(input, context, "cover"),
        "create-draft": async (input) => {
            const payload = await request(requestedAccountId(input), "/cgi-bin/draft/add", { body: { articles: articleList(input) } });
            return { mediaId: text(Reflect.get(payload, "media_id")) };
        },
        "get-draft": async (input) => {
            const payload = await request(requestedAccountId(input), "/cgi-bin/draft/get", { body: { media_id: requiredText(input, "mediaId", 256) } });
            return { newsItem: records(Reflect.get(payload, "news_item")) };
        },
        "list-drafts": async (input) => {
            const payload = await request(requestedAccountId(input), "/cgi-bin/draft/batchget", {
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
        "update-draft": async (input) => {
            const articleInput = record(field(input, "article"));
            if (!articleInput)
                throw new Error("article must be an object");
            await request(requestedAccountId(input), "/cgi-bin/draft/update", {
                body: {
                    media_id: requiredText(input, "mediaId", 256),
                    index: requiredInteger(input, "index"),
                    articles: article(articleInput),
                },
            });
            return { updated: true };
        },
        "submit-publish": async (input) => {
            const payload = await request(requestedAccountId(input), "/cgi-bin/freepublish/submit", { body: { media_id: requiredText(input, "mediaId", 256) } });
            return { publishId: text(Reflect.get(payload, "publish_id")) };
        },
        "get-publish-status": async (input) => {
            const payload = await request(requestedAccountId(input), "/cgi-bin/freepublish/get", { body: { publish_id: requiredText(input, "publishId", 256) } });
            return {
                publishId: text(Reflect.get(payload, "publish_id")),
                publishStatus: numberValue(Reflect.get(payload, "publish_status")),
                articleId: text(Reflect.get(payload, "article_id")),
                articleDetail: record(Reflect.get(payload, "article_detail")),
                failIdx: records(Reflect.get(payload, "fail_idx")),
            };
        },
        "list-comments": async (input) => {
            const payload = await request(requestedAccountId(input), "/cgi-bin/comment/list", {
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
        "reply-comment": async (input) => {
            await request(requestedAccountId(input), "/cgi-bin/comment/reply/add", {
                body: {
                    msg_data_id: requiredInteger(input, "msgDataId", 1),
                    index: requiredInteger(input, "index"),
                    user_comment_id: requiredInteger(input, "userCommentId", 1),
                    content: requiredText(input, "content", 600),
                },
            });
            return { replied: true };
        },
        "set-comment-featured": async (input) => {
            const featured = requiredBoolean(input, "featured");
            await request(requestedAccountId(input), featured ? "/cgi-bin/comment/markelect" : "/cgi-bin/comment/unmarkelect", {
                body: {
                    msg_data_id: requiredInteger(input, "msgDataId", 1),
                    index: requiredInteger(input, "index"),
                    user_comment_id: requiredInteger(input, "userCommentId", 1),
                },
            });
            return { featured };
        },
        "delete-comment": async (input) => {
            await request(requestedAccountId(input), "/cgi-bin/comment/delete", {
                body: {
                    msg_data_id: requiredInteger(input, "msgDataId", 1),
                    index: requiredInteger(input, "index"),
                    user_comment_id: requiredInteger(input, "userCommentId", 1),
                },
            });
            return { deleted: true };
        },
        "set-comment-state": async (input) => {
            const open = requiredBoolean(input, "open");
            await request(requestedAccountId(input), open ? "/cgi-bin/comment/open" : "/cgi-bin/comment/close", {
                body: {
                    msg_data_id: requiredInteger(input, "msgDataId", 1),
                    index: requiredInteger(input, "index"),
                },
            });
            return { open };
        },
        "list-followers": async (input) => {
            const nextOpenId = optionalText(input, "nextOpenId", 256);
            const payload = await request(requestedAccountId(input), `/cgi-bin/user/get${nextOpenId ? `?next_openid=${encodeURIComponent(nextOpenId)}` : ""}`, { method: "GET" });
            const data = record(Reflect.get(payload, "data"));
            return {
                total: numberValue(Reflect.get(payload, "total")),
                count: numberValue(Reflect.get(payload, "count")),
                nextOpenId: text(Reflect.get(payload, "next_openid")),
                openIds: data ? (Array.isArray(Reflect.get(data, "openid")) ? Reflect.get(data, "openid") : []) : [],
            };
        },
        "get-menu": async (input) => request(requestedAccountId(input), "/cgi-bin/menu/get", { method: "GET" }),
        "update-menu": async (input) => {
            const menu = record(field(input, "menu"));
            if (!menu)
                throw new Error("menu must be an object");
            if (JSON.stringify(menu).length > MAX_MENU_JSON_LENGTH)
                throw new Error("menu is too large");
            await request(requestedAccountId(input), "/cgi-bin/menu/create", { body: menu });
            return { updated: true };
        },
        "send-customer-text": async (input) => {
            await request(requestedAccountId(input), "/cgi-bin/message/custom/send", {
                body: {
                    touser: requiredText(input, "openId", 256),
                    msgtype: "text",
                    text: { content: requiredText(input, "content", 2_000) },
                },
            });
            return { sent: true };
        },
    };
    async function startStudio() {
        const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../ui");
        const assets = new Map();
        await Promise.all([...STUDIO_ASSETS].map(async ([path, asset]) => {
            assets.set(path, { body: await readFile(resolve(uiRoot, asset.fileName)), contentType: asset.contentType });
        }));
        let origin = "";
        const server = createServer(async (request, response) => {
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader("Referrer-Policy", "no-referrer");
            response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors http://localhost:* http://127.0.0.1:* file:");
            const json = (status, body) => {
                if (response.destroyed)
                    return;
                response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
                response.end(JSON.stringify(body));
            };
            try {
                if (!origin || request.headers.host !== new URL(origin).host)
                    throw new Error("本机服务地址不匹配");
                if (request.headers.origin && request.headers.origin !== origin) {
                    json(403, { error: "请求来源不匹配", code: "forbidden" });
                    return;
                }
                const url = new URL(request.url ?? "/", origin);
                if (request.method === "GET" && url.pathname === "/healthz") {
                    json(200, { service: runtime.plugin.id, ok: true });
                    return;
                }
                const asset = assets.get(url.pathname);
                if (request.method === "GET" && asset) {
                    response.writeHead(200, { "Content-Type": asset.contentType });
                    response.end(asset.body);
                    return;
                }
                const expected = Buffer.from(`Bearer ${studioToken}`);
                const actual = Buffer.from(request.headers.authorization ?? "");
                if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
                    json(401, { error: "请从插件入口重新打开公众号 Studio", code: "unauthorized" });
                    return;
                }
                const studioContext = { directory: runtime.workspace.root };
                if (request.method === "GET" && url.pathname === "/api/state") {
                    const accountId = url.searchParams.get("accountId")?.trim() ?? "";
                    const result = await actions["studio-state"](accountId ? { accountId } : {}, studioContext);
                    json(200, { result });
                    return;
                }
                if (request.method === "POST" && url.pathname === "/api/accounts") {
                    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json"))
                        throw new Error("请求必须使用 application/json");
                    const result = await saveStudioAccount(await readStudioJson(request));
                    json(200, { result });
                    return;
                }
                if (request.method === "DELETE" && url.pathname.startsWith("/api/accounts/")) {
                    const accountId = decodeURIComponent(url.pathname.slice("/api/accounts/".length));
                    const result = await deleteStudioAccount(accountId);
                    json(200, { result });
                    return;
                }
                const match = request.method === "POST" ? STUDIO_ACTION_RE.exec(url.pathname) : null;
                const handler = match ? actions[match[1]] : null;
                if (!handler || match?.[1] === "open-workbench") {
                    json(404, { error: "没有找到此操作", code: "not_found" });
                    return;
                }
                if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
                    throw new Error("请求必须使用 application/json");
                }
                const result = await handler(await readStudioJson(request), studioContext);
                json(200, { result });
            }
            catch (error) {
                json(400, { error: studioErrorMessage(error), code: "operation_failed" });
            }
        });
        server.requestTimeout = 60_000;
        server.headersTimeout = 10_000;
        await new Promise((done, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                server.removeListener("error", reject);
                done();
            });
        });
        const address = server.address();
        if (!address || typeof address === "string") {
            server.close();
            throw new Error("公众号 Studio 未能绑定本机端口");
        }
        studioServer = server;
        origin = `http://127.0.0.1:${address.port}`;
        return { origin };
    }
    function ensureStudioStarted() {
        if (!studioStart) {
            studioStart = startStudio().catch((error) => {
                studioStart = null;
                throw error;
            });
        }
        return studioStart;
    }
    return {
        actions,
        async dispose() {
            const server = studioServer;
            studioServer = null;
            studioStart = null;
            if (!server)
                return;
            await new Promise((done) => {
                server.close(() => done());
                server.closeAllConnections();
            });
        },
    };
}
