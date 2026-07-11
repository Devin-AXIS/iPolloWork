/**
 * Microsoft 365 Cloud Connect proof.
 *
 * Prerequisites:
 *   node evals/drivers/cloud-connect-services-mock.mjs --port 3979
 *
 * Start den-api with the mock endpoints before running this flow:
 *   DEN_MICROSOFT_OAUTH_AUTHORIZE_URL=http://127.0.0.1:3979/entra/{tenantId}/oauth2/v2.0/authorize
 *   DEN_MICROSOFT_OAUTH_TOKEN_URL=http://127.0.0.1:3979/entra/{tenantId}/oauth2/v2.0/token
 *   DEN_MICROSOFT_GRAPH_BASE_URL=http://127.0.0.1:3979/graph/v1.0
 */

import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import {
  denApiFetch,
  mcpAgentCall,
  mintMcpToken,
  openAdminConnections,
  openYourConnections,
  signInApi,
  signInViaBrowser,
} from "./lib/den-web.mjs";

const vo = await loadVoiceoverParagraphs("microsoft-365-cloud-connect");

const ADMIN_EMAIL = process.env.IPOLLOWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.IPOLLOWORK_EVAL_DEMO_PASSWORD?.trim() || "iPolloWorkDemo123!";
const MOCK_SERVER_URL = (process.env.IPOLLOWORK_EVAL_CLOUD_CONNECT_MOCK_URL ?? "http://127.0.0.1:3979")
  .trim()
  .replace(/\/+$/, "");
const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CLIENT_SECRET = "ipollowork-microsoft-mock-secret";
const MICROSOFT_SCOPES = ["Mail.Read", "Calendars.Read", "Files.Read"];
const MAIL_PATH = "/v1/capabilities/microsoft-365/mail-messages";
const CALENDAR_PATH = "/v1/capabilities/microsoft-365/calendar-events";
const DRIVE_SEARCH_PATH = "/v1/capabilities/microsoft-365/drive-files";
const DRIVE_FILE_PATH = "/v1/capabilities/microsoft-365/drive-file/{itemId}";

const state = {
  adminSession: null,
  mcpToken: null,
  mailCapability: null,
  calendarCapability: null,
  driveSearchCapability: null,
  driveFileCapability: null,
  graphRequestCount: 0,
};

function witness(ctx, condition, assertion, actual) {
  ctx.assert(condition, assertion);
  ctx.recordEvidence({ type: "assertion", status: "passed", assertion, actual });
}

function toolJson(result) {
  const text = result?.content?.find((entry) => entry?.type === "text")?.text ?? "{}";
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function mockRequests() {
  const response = await fetch(`${MOCK_SERVER_URL}/__mock/requests`);
  if (!response.ok) throw new Error(`Mock request log failed: ${response.status}`);
  const body = await response.json();
  return Array.isArray(body.requests) ? body.requests : [];
}

function graphRequests(requests) {
  return requests.filter((request) => typeof request.path === "string" && request.path.startsWith("/graph/v1.0/"));
}

async function authenticatedApi(path, options = {}) {
  return denApiFetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${state.adminSession}`,
      ...(options.headers ?? {}),
    },
  });
}

async function findCapability(ctx, input) {
  const result = await mcpAgentCall(state.mcpToken, "tools/call", {
    name: "search_capabilities",
    arguments: { query: input.query, limit: 20 },
  }, ctx);
  const body = toolJson(result);
  const matches = Array.isArray(body.matches) ? body.matches : [];
  const match = matches.find((candidate) => candidate.method === "GET" && candidate.path === input.path) ?? null;
  witness(
    ctx,
    Boolean(match),
    `search_capabilities exposes GET ${input.path}`,
    matches.map((candidate) => ({ name: candidate.name, method: candidate.method, path: candidate.path })),
  );
  return match;
}

async function executeCapability(ctx, capability, args = {}) {
  const result = await mcpAgentCall(state.mcpToken, "tools/call", {
    name: "execute_capability",
    arguments: { name: capability.name, ...args },
  }, ctx);
  return { result, body: toolJson(result) };
}

function microsoftRowScript(requiredText) {
  return `(() => {
    const leaves = [...document.querySelectorAll('p, span')]
      .filter((element) => (element.textContent ?? '').trim() === 'Microsoft 365');
    return leaves.some((leaf) => {
      let row = leaf;
      for (let depth = 0; depth < 7 && row; depth += 1) {
        if ((row.textContent ?? '').includes(${JSON.stringify(requiredText)})) {
          row.scrollIntoView({ block: 'center' });
          return true;
        }
        row = row.parentElement;
      }
      return false;
    });
  })()`;
}

function scheduleMicrosoftRowButtonScript(buttonText) {
  return `(() => {
    const leaves = [...document.querySelectorAll('p, span')]
      .filter((element) => (element.textContent ?? '').trim() === 'Microsoft 365');
    for (const leaf of leaves) {
      let row = leaf;
      for (let depth = 0; depth < 7 && row; depth += 1) {
        const button = [...row.querySelectorAll('button')]
          .find((candidate) => (candidate.textContent ?? '').trim() === ${JSON.stringify(buttonText)});
        if (button) {
          row.scrollIntoView({ block: 'center' });
          setTimeout(() => button.click(), 600);
          return true;
        }
        row = row.parentElement;
      }
    }
    return false;
  })()`;
}

async function openMicrosoftSetup(ctx) {
  const clicked = await ctx.eval(`(() => {
    const button = document.querySelector('[data-testid="quick-add-microsoft-365"]');
    button?.scrollIntoView({ block: 'center' });
    button?.click();
    return Boolean(button);
  })()`);
  witness(ctx, clicked, "The Microsoft 365 quick-add card opens its setup dialog.", { clicked });
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"microsoft-365-dialog\"]'))", {
    timeoutMs: 20_000,
    label: "Microsoft 365 setup dialog",
  });
  await ctx.waitFor(`(() => {
    const dialog = document.querySelector('[data-testid="microsoft-365-dialog"]');
    const text = dialog?.textContent ?? '';
    return text.includes('Change tenant or credentials') || Boolean(dialog?.querySelector('[data-testid="microsoft-tenant-id"]'));
  })()`, { timeoutMs: 20_000, label: "loaded Microsoft 365 client configuration" });

  const configured = await ctx.eval("document.querySelector('[data-testid=\"microsoft-365-dialog\"]')?.textContent?.includes('Change tenant or credentials') ?? false");
  if (configured) {
    await ctx.clickText("Change tenant or credentials", { timeoutMs: 10_000 });
  }
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"microsoft-tenant-id\"]'))", {
    timeoutMs: 10_000,
    label: "Microsoft tenant ID field",
  });
}

async function saveMicrosoftSetup(ctx) {
  const clicked = await ctx.eval(`(() => {
    const button = document.querySelector('[data-testid="save-microsoft-365"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  witness(ctx, clicked, "The enabled Save setup button submits the Entra configuration.", { clicked });
  await ctx.waitFor("!document.querySelector('[data-testid=\"microsoft-365-dialog\"]')", {
    timeoutMs: 30_000,
    label: "Microsoft 365 setup saved and dialog closed",
  });
  await ctx.waitFor(`(() => {
    const card = document.querySelector('[data-testid="quick-add-microsoft-365"]');
    return (card?.textContent ?? '').includes('Configured');
  })()`, { timeoutMs: 30_000, label: "configured Microsoft 365 quick-add card" });
}

function summarizeMail(messages) {
  return messages.map((message) => ({
    subject: message.subject,
    from: message.from?.address ?? null,
    summary: message.preview,
    source: message.webLink,
  }));
}

export default {
  id: "microsoft-365-cloud-connect",
  title: "Members connect delegated Microsoft 365 read access, use mail/calendar/OneDrive capabilities, and disconnect safely",
  kind: "user-facing",
  preserveTheme: true,
  requiredEnv: ["IPOLLOWORK_EVAL_DEN_API_URL", "IPOLLOWORK_EVAL_DEN_WEB_URL"],
  steps: [
    {
      name: "Setup: mock services are healthy and the demo owner starts disconnected",
      run: async (ctx) => {
        const healthResponse = await fetch(`${MOCK_SERVER_URL}/health`).catch(() => null);
        witness(ctx, Boolean(healthResponse?.ok), `Cloud Connect mock is reachable at ${MOCK_SERVER_URL}.`, {
          status: healthResponse?.status ?? null,
        });
        const health = await healthResponse.json();
        witness(ctx, health.service === "cloud-connect-services-mock", "The deterministic Cloud Connect service mock is running.", {
          service: health.service,
          microsoftGraphBaseUrl: health.endpoints?.microsoftGraphBaseUrl,
        });
        const reset = await fetch(`${MOCK_SERVER_URL}/__mock/reset`, { method: "POST" });
        witness(ctx, reset.ok, "The Cloud Connect service mock starts from a clean request log.", { status: reset.status });

        state.adminSession = await signInApi(ADMIN_EMAIL, ADMIN_PASSWORD);
        if (!state.adminSession && ctx.env.IPOLLOWORK_EVAL_DEN_TOKEN?.trim()) {
          state.adminSession = ctx.env.IPOLLOWORK_EVAL_DEN_TOKEN.trim();
        }
        witness(ctx, Boolean(state.adminSession), `The demo owner can sign in as ${ADMIN_EMAIL}.`);

        const disconnected = await authenticatedApi("/v1/oauth-providers/microsoft-365/disconnect", { method: "POST", body: "{}" });
        witness(
          ctx,
          disconnected.response.ok || disconnected.response.status === 404,
          "The calling member starts without a stored Microsoft 365 access token.",
          { status: disconnected.response.status },
        );
      },
    },
    {
      name: "Frame 1 — Admin configures delegated, read-only Microsoft 365 access",
      run: async (ctx) => {
        await ctx.prove("An admin is guided through Entra setup and chooses only the three read capabilities", {
          voiceover: vo[0],
          action: async () => {
            await signInViaBrowser(ctx, ADMIN_EMAIL, ADMIN_PASSWORD);
            await openAdminConnections(ctx);
            await ctx.waitForText("Microsoft 365", { timeoutMs: 20_000 });
            await openMicrosoftSetup(ctx);

            await ctx.fill('[data-testid="microsoft-tenant-id"]', TENANT_ID);
            await ctx.fill('[data-testid="microsoft-365-dialog"] input[placeholder="00000000-0000-0000-0000-000000000000"]:not([data-testid="microsoft-tenant-id"])', CLIENT_ID);
            await ctx.fill('[data-testid="microsoft-365-dialog"] input[placeholder="Paste the secret value, not its ID"]', CLIENT_SECRET);
            await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="microsoft-365-dialog"]');
              if (dialog) dialog.scrollTop = dialog.scrollHeight;
              return true;
            })()`);
          },
          assert: async () => {
            await ctx.expectText("Set up the Entra app");
            await ctx.expectText("Read-only access");
            await ctx.expectText("Directory (tenant) ID");
            await ctx.expectText("Application (client) ID");
            await ctx.expectText("Client secret value");
            const form = await ctx.eval(`(() => ({
              tenant: document.querySelector('[data-testid="microsoft-tenant-id"]')?.value,
              client: document.querySelector('[data-testid="microsoft-365-dialog"] input[placeholder="00000000-0000-0000-0000-000000000000"]:not([data-testid="microsoft-tenant-id"])')?.value,
              permissions: [...document.querySelectorAll('[data-testid="microsoft-365-dialog"] input[data-feature]')]
                .map((input) => ({ feature: input.dataset.feature, checked: input.checked })),
              redirectUri: document.querySelector('[data-microsoft-redirect-uri]')?.textContent?.trim(),
              saveEnabled: !document.querySelector('[data-testid="save-microsoft-365"]')?.disabled,
            }))()`);
            witness(ctx, form.tenant === TENANT_ID && form.client === CLIENT_ID, "The tenant and application IDs are entered in distinct fields.", {
              tenantId: form.tenant,
              clientId: form.client,
            });
            witness(
              ctx,
              form.permissions.length === 3 && form.permissions.every((permission) => permission.checked),
              "Only Outlook mail, calendar, and OneDrive read features are selected.",
              form.permissions,
            );
            witness(ctx, String(form.redirectUri).includes("/v1/oauth-providers/microsoft-365/connect/callback"), "The dialog shows the exact self-host-safe OAuth callback URI.", {
              redirectUri: form.redirectUri,
            });
            witness(ctx, form.saveEnabled === true, "The setup is ready to save after all three Entra credentials are present.");
          },
          screenshot: {
            name: "microsoft-365-entra-read-only-setup",
            claim: "The setup dialog exposes the tenant, client, and secret fields alongside the exact callback and read-only Microsoft Graph permissions.",
            requireText: ["Set up the Entra app", "Read-only access", "Mail.Read", "Calendars.Read", "Files.Read", "Directory (tenant) ID", "Client secret value"],
            rejectText: ["Mail.ReadWrite", "Calendars.ReadWrite", "Files.ReadWrite", "Something went wrong"],
          },
        });

        await saveMicrosoftSetup(ctx);
        const config = await authenticatedApi("/v1/oauth-providers/microsoft-365/client");
        witness(ctx, config.response.ok && config.body.configured === true, "The Entra app configuration is persisted for the organization.", {
          providerId: config.body.providerId,
          configured: config.body.configured,
          tenantId: config.body.tenantId,
          scopes: config.body.scopes,
        });
        witness(ctx, config.body.tenantId === TENANT_ID, "The persisted connection is pinned to the selected Microsoft tenant.", {
          tenantId: config.body.tenantId,
        });
        witness(ctx, MICROSOFT_SCOPES.every((scope) => config.body.scopes.includes(scope)), "The persisted client requests all three selected read scopes.", {
          scopes: config.body.scopes,
        });

        const start = await authenticatedApi("/v1/oauth-providers/microsoft-365/connect/start");
        witness(ctx, start.response.ok, "The saved client can produce a member authorization URL.", { status: start.response.status });
        const authorizeUrl = new URL(start.body.authorizeUrl);
        const requestedScopes = (authorizeUrl.searchParams.get("scope") ?? "").split(" ");
        witness(
          ctx,
          authorizeUrl.origin === new URL(MOCK_SERVER_URL).origin && authorizeUrl.pathname.includes(`/entra/${TENANT_ID}/oauth2/v2.0/authorize`),
          "The test authorization URL is tenant-scoped and points to the deterministic Entra mock.",
          { origin: authorizeUrl.origin, pathname: authorizeUrl.pathname },
        );
        witness(ctx, MICROSOFT_SCOPES.every((scope) => requestedScopes.includes(scope)), "The authorization URL asks for no less and no more than the configured Graph read features.", {
          requestedReadScopes: requestedScopes.filter((scope) => scope.endsWith(".Read")),
        });
      },
    },
    {
      name: "Frame 2 — A member connects their own organizational account",
      run: async (ctx) => {
        await ctx.prove("The calling member completes delegated OAuth and sees their tenant plus exact approved scopes", {
          voiceover: vo[1],
          action: async () => {
            await openYourConnections(ctx);
            await ctx.waitFor(microsoftRowScript("Connect your account"), { timeoutMs: 30_000, label: "Microsoft 365 needs member connection" });
            const scheduled = await ctx.eval(scheduleMicrosoftRowButtonScript("Connect"));
            witness(ctx, scheduled, "The member uses the Connect button on the Microsoft 365 row.", { scheduled });
            const oauthTab = await ctx.switchToNewTab({ timeoutMs: 20_000, label: "Microsoft 365 OAuth popup" });
            await ctx.waitForText("Connected", { timeoutMs: 30_000 });
            await ctx.expectText("Microsoft 365 is connected");
            ctx.switchBack();
            const closed = await fetch(`${ctx.cdpBaseUrl.replace(/\/$/, "")}/json/close/${encodeURIComponent(oauthTab.id)}`).catch(() => null);
            witness(ctx, Boolean(closed?.ok), "The completed OAuth popup closes before returning to iPolloWork.", {
              status: closed?.status ?? null,
            });
          },
          assert: async () => {
            await ctx.waitFor(microsoftRowScript("Connected as you"), { timeoutMs: 60_000, label: "Microsoft 365 connected for calling member" });
            await ctx.expectText(TENANT_ID);
            for (const scope of MICROSOFT_SCOPES) await ctx.expectText(scope);

            const status = await authenticatedApi("/v1/oauth-providers/microsoft-365/status");
            witness(ctx, status.response.ok && status.body.connected === true, "The provider status is connected for the calling member.", {
              connected: status.body.connected,
              providerId: status.body.providerId,
            });
            witness(ctx, MICROSOFT_SCOPES.every((scope) => status.body.scopes.includes(scope)), "The stored member grant contains every approved read scope.", {
              scopes: status.body.scopes,
            });

            const requests = await mockRequests();
            const authorize = requests.find((request) => request.path === `/entra/${TENANT_ID}/oauth2/v2.0/authorize`);
            const token = requests.find((request) => request.path === `/entra/${TENANT_ID}/oauth2/v2.0/token`);
            witness(ctx, Boolean(authorize && token), "The browser authorization and server-side token exchange both reached the Entra mock.", {
              authorize: authorize?.path ?? null,
              token: token?.path ?? null,
            });
            witness(ctx, token?.body?.grant_type === "authorization_code" && token?.body?.client_id === CLIENT_ID, "The callback exchanges an authorization code with the configured client.", {
              grantType: token?.body?.grant_type,
              clientId: token?.body?.client_id,
              sentClientSecret: Boolean(token?.body?.client_secret),
            });
            ctx.output("member-microsoft-365-grant.json", JSON.stringify({
              identity: "Connected as you",
              tenantId: TENANT_ID,
              scopes: status.body.scopes,
            }, null, 2));
          },
          screenshot: {
            name: "microsoft-365-connected-as-member",
            claim: "Your Connections identifies the grant as the calling member's and shows its tenant and exact delegated scopes.",
            requireText: ["Your Connections", "Microsoft 365", "Connected as you", TENANT_ID, "Mail.Read", "Calendars.Read", "Files.Read"],
            rejectText: ["Waiting for authorization", "Connection failed", "Something went wrong"],
          },
        });
        state.mcpToken = await mintMcpToken(state.adminSession, ctx);
      },
    },
    {
      name: "Frame 3 — The agent reads exactly three recent Outlook messages",
      run: async (ctx) => {
        await ctx.prove("The agent capability returns three bounded Outlook summaries with source links", {
          voiceover: vo[2],
          action: async () => {
            await openAdminConnections(ctx);
            await ctx.waitFor(`(() => {
              const card = document.querySelector('[data-testid="quick-add-microsoft-365"]');
              card?.scrollIntoView({ block: 'center' });
              return (card?.textContent ?? '').includes('Configured');
            })()`, { timeoutMs: 30_000, label: "configured Microsoft 365 card" });
          },
          assert: async () => {
            state.mailCapability = await findCapability(ctx, { query: "latest Outlook mail messages", path: MAIL_PATH });
            const direct = await authenticatedApi(`${MAIL_PATH}?maxResults=3`);
            witness(ctx, direct.response.ok && direct.body.messages?.length === 3, "The member REST capability returns exactly the three requested recent messages.", {
              status: direct.response.status,
              count: direct.body.messages?.length,
            });

            const executed = await executeCapability(ctx, state.mailCapability, { query: { maxResults: 3 } });
            witness(ctx, executed.result.isError !== true && executed.body.ok === true, "execute_capability invokes the matched Outlook read operation successfully.", {
              isError: executed.result.isError ?? false,
              ok: executed.body.ok,
            });
            witness(ctx, executed.body.messages?.length === 3, "The MCP execution is bounded to exactly three Outlook messages.", {
              count: executed.body.messages?.length,
            });
            const summaries = summarizeMail(executed.body.messages ?? []);
            witness(ctx, summaries.every((message) => message.summary && message.source?.startsWith("https://outlook.office.test/")), "Every concise message summary includes an original Outlook source link.", summaries);

            const requests = await mockRequests();
            const mailRequests = graphRequests(requests).filter((request) => request.path.includes("/me/messages"));
            witness(ctx, mailRequests.length >= 2 && mailRequests.every((request) => request.path === "/graph/v1.0/me/messages"), "The proof uses bounded list calls and never imports individual message bodies.", mailRequests.map((request) => ({
              path: request.path,
              query: request.search,
            })));
            witness(ctx, mailRequests.every((request) => new URLSearchParams(request.search).get("$top") === "3"), "Every Graph mail request is explicitly capped at three results.", mailRequests.map((request) => request.search));
            ctx.output("three-latest-outlook-summaries.json", JSON.stringify(summaries, null, 2));
          },
          screenshot: {
            name: "microsoft-365-mail-capability-ready",
            claim: "Microsoft 365 remains configured while the agent MCP proof returns exactly three Outlook summaries and their source links.",
            requireText: ["Connections", "Microsoft 365", "Configured"],
            rejectText: ["Something went wrong", "Connection failed"],
          },
        });
      },
    },
    {
      name: "Frame 4 — The agent reads upcoming meetings and the Q3 OneDrive plan",
      run: async (ctx) => {
        await ctx.prove("The agent returns upcoming calendar events and the Q3 plan with source links and bounded file content", {
          voiceover: vo[3],
          action: async () => {
            const clicked = await ctx.eval(`(() => {
              const card = document.querySelector('[data-testid="quick-add-microsoft-365"]');
              card?.click();
              return Boolean(card);
            })()`);
            witness(ctx, clicked, "The configured Microsoft 365 card opens its current read-only setup.", { clicked });
            await ctx.waitForText("Credentials saved", { timeoutMs: 20_000 });
            await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="microsoft-365-dialog"]');
              if (dialog) dialog.scrollTop = dialog.scrollHeight;
              return true;
            })()`);
          },
          assert: async () => {
            state.calendarCapability = await findCapability(ctx, { query: "upcoming Microsoft calendar events", path: CALENDAR_PATH });
            const calendar = await executeCapability(ctx, state.calendarCapability, {
              query: {
                timeMin: "2026-07-10T00:00:00Z",
                timeMax: "2026-07-12T00:00:00Z",
                maxResults: 10,
              },
            });
            witness(ctx, calendar.result.isError !== true && calendar.body.events?.length === 2, "The calendar capability returns the two deterministic upcoming meetings.", {
              isError: calendar.result.isError ?? false,
              events: calendar.body.events?.map((event) => event.subject),
            });
            witness(ctx, calendar.body.events.every((event) => event.webLink?.startsWith("https://outlook.office.test/calendar/")), "Every meeting includes its original Outlook calendar link.", calendar.body.events.map((event) => event.webLink));

            state.driveSearchCapability = await findCapability(ctx, { query: "search OneDrive files Q3 plan", path: DRIVE_SEARCH_PATH });
            const search = await executeCapability(ctx, state.driveSearchCapability, { query: { query: "Q3", maxResults: 5 } });
            const q3File = search.body.files?.find((file) => file.name === "Q3 Plan.txt");
            witness(ctx, search.result.isError !== true && Boolean(q3File), "The OneDrive search capability finds Q3 Plan.txt.", {
              isError: search.result.isError ?? false,
              files: search.body.files?.map((file) => ({ id: file.id, name: file.name, webUrl: file.webUrl })),
            });

            state.driveFileCapability = await findCapability(ctx, { query: "read OneDrive text file content", path: DRIVE_FILE_PATH });
            const file = await executeCapability(ctx, state.driveFileCapability, { path: { itemId: q3File.id } });
            witness(ctx, file.result.isError !== true && file.body.file?.content?.includes("Ship cloud connections"), "The matched file-read capability returns the Q3 plan's bounded text content.", {
              isError: file.result.isError ?? false,
              name: file.body.file?.name,
              content: file.body.file?.content,
              truncated: file.body.file?.truncated,
            });
            witness(ctx, file.body.file.webUrl === "https://onedrive.office.test/files/file-q3-plan", "The file result preserves the original OneDrive source link.", {
              source: file.body.file.webUrl,
            });

            const requests = await mockRequests();
            const graph = graphRequests(requests);
            witness(ctx, graph.some((request) => request.path === "/graph/v1.0/me/calendarView"), "The calendar execution reaches the delegated Microsoft Graph calendar endpoint.", graph.map((request) => request.path));
            witness(ctx, graph.some((request) => request.path.startsWith("/graph/v1.0/me/drive/root/search")) && graph.some((request) => request.path === "/graph/v1.0/me/drive/items/file-q3-plan/content"), "OneDrive search and content endpoints are both exercised.", graph.map((request) => request.path));
            state.graphRequestCount = graph.length;
            ctx.output("meetings-and-q3-plan.json", JSON.stringify({
              upcomingMeetings: calendar.body.events.map((event) => ({
                subject: event.subject,
                start: event.start,
                source: event.webLink,
              })),
              q3Plan: {
                name: file.body.file.name,
                source: file.body.file.webUrl,
                content: file.body.file.content,
                truncated: file.body.file.truncated,
              },
            }, null, 2));
          },
          screenshot: {
            name: "microsoft-365-read-only-capabilities",
            claim: "The configured provider still shows encrypted credentials and only mail, calendar, and file read permissions while the capability proof returns calendar and OneDrive data.",
            requireText: ["Update Microsoft 365", "Credentials saved", "Read-only access", "Mail.Read", "Calendars.Read", "Files.Read"],
            rejectText: ["Mail.ReadWrite", "Calendars.ReadWrite", "Files.ReadWrite", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 5 — Disconnect removes only the calling member's grant and fails closed",
      run: async (ctx) => {
        await ctx.prove("After disconnect, the same capability returns needs_connection and never falls back to another member's token", {
          voiceover: vo[4],
          action: async () => {
            const dialogOpen = await ctx.eval("Boolean(document.querySelector('[data-testid=\"microsoft-365-dialog\"]'))");
            if (dialogOpen) await ctx.clickText("Cancel", { timeoutMs: 10_000 });
            await openYourConnections(ctx);
            await ctx.waitFor(microsoftRowScript("Connected as you"), { timeoutMs: 30_000, label: "connected Microsoft 365 row before disconnect" });
            const scheduled = await ctx.eval(scheduleMicrosoftRowButtonScript("Disconnect"));
            witness(ctx, scheduled, "The member uses Disconnect on their own Microsoft 365 row.", { scheduled });
            await ctx.waitFor(microsoftRowScript("Connect your account"), { timeoutMs: 30_000, label: "Microsoft 365 row returns to Connect your account" });
          },
          assert: async () => {
            await ctx.expectText("Connect your account");
            const status = await authenticatedApi("/v1/oauth-providers/microsoft-365/status");
            witness(ctx, status.response.ok && status.body.connected === false, "The calling member's provider status is disconnected.", {
              connected: status.body.connected,
              scopes: status.body.scopes,
            });

            const direct = await authenticatedApi(`${MAIL_PATH}?maxResults=3`);
            witness(ctx, direct.response.status === 409 && direct.body.error === "needs_connection", "The REST capability fails closed with needs_connection after disconnect.", {
              status: direct.response.status,
              error: direct.body.error,
              message: direct.body.message,
            });
            const executed = await executeCapability(ctx, state.mailCapability, { query: { maxResults: 3 } });
            witness(ctx, executed.result.isError === true && executed.body.error === "needs_connection", "The agent-facing execute_capability returns the same needs_connection boundary.", {
              isError: executed.result.isError,
              error: executed.body.error,
              message: executed.body.message,
            });

            const requests = await mockRequests();
            const afterDisconnectGraphCount = graphRequests(requests).length;
            witness(ctx, afterDisconnectGraphCount === state.graphRequestCount, "No Microsoft Graph request occurs after disconnect, so another member's credentials cannot be used silently.", {
              beforeDisconnect: state.graphRequestCount,
              afterDisconnect: afterDisconnectGraphCount,
            });
            ctx.output("microsoft-365-needs-connection.json", JSON.stringify({
              connected: status.body.connected,
              rest: { status: direct.response.status, error: direct.body.error, message: direct.body.message },
              mcp: { isError: executed.result.isError, error: executed.body.error, message: executed.body.message },
              graphRequestsAfterDisconnect: afterDisconnectGraphCount - state.graphRequestCount,
            }, null, 2));
          },
          screenshot: {
            name: "microsoft-365-disconnected-needs-connection",
            claim: "Your Connections returns to Connect your account, while REST and MCP both report needs_connection without another Graph call.",
            requireText: ["Your Connections", "Microsoft 365", "Connect your account"],
            rejectText: ["Connected as you", "Connection failed", "Something went wrong"],
          },
        });
      },
    },
  ],
};
