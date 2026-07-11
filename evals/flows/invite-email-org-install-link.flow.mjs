import { execSync } from "node:child_process";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "invite-email-org-install-link";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const DEN_API_URL = cleanBaseUrl(process.env.IPOLLOWALK_EVAL_DEN_API_URL);
const DEN_WEB_URL = cleanBaseUrl(process.env.IPOLLOWALK_EVAL_DEN_WEB_URL);
const MARK_VERIFIED_CMD = process.env.IPOLLOWALK_EVAL_MARK_VERIFIED_CMD?.trim() || "";
const PLATFORM_ADMIN_EMAIL = process.env.IPOLLOWALK_EVAL_PLATFORM_ADMIN_EMAIL?.trim() || "";
const PLATFORM_ADMIN_PASSWORD = process.env.IPOLLOWALK_EVAL_PLATFORM_ADMIN_PASSWORD?.trim() || "";
const ADMIN_EMAIL = process.env.IPOLLOWALK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.IPOLLOWALK_EVAL_DEMO_PASSWORD?.trim() || "iPolloWalkDemo123!";
const RUN_TAG = Date.now().toString(36);
const INVITEE_EMAIL = `maya.install+${RUN_TAG}@acme.test`;
const ORGANIZATION_NAME = "Acme Robotics";

const state = {
  adminToken: null,
  platformAdminToken: null,
  organizationId: null,
  emailInstallUrl: null,
  windowsDownloadUrl: null,
};

function cleanBaseUrl(value) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function redactedInstallUrl(value, secrets = []) {
  let sanitized = value;
  for (const secret of secrets) {
    if (!secret) continue;
    sanitized = sanitized
      .replaceAll(secret, "[redacted]")
      .replaceAll(encodeURIComponent(secret), "%5Bredacted%5D");
  }
  try {
    const url = new URL(sanitized);
    if (url.searchParams.has("token")) url.searchParams.set("token", "[redacted]");
    return url.toString();
  } catch {
    return "invalid install URL";
  }
}

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual: actual === undefined ? undefined : typeof actual === "string" ? actual : JSON.stringify(actual).slice(0, 900),
  });
  ctx.assert(condition, assertion + (actual === undefined ? "" : ` (actual: ${JSON.stringify(actual).slice(0, 500)})`));
}

async function denApiFetch(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("origin", DEN_WEB_URL || DEN_API_URL);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${DEN_API_URL}${path}`, { ...options, headers });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, text };
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

async function ensureAdminToken(ctx) {
  if (state.adminToken) return state.adminToken;
  const signedIn = await denApiFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (signedIn.response.ok && typeof signedIn.body?.token === "string") {
    state.adminToken = signedIn.body.token;
    return state.adminToken;
  }
  const token = process.env.IPOLLOWALK_EVAL_DEN_TOKEN?.trim() ?? "";
  witness(ctx, token.length > 0, "A platform-admin token is available for eval setup", signedIn.response.status);
  state.adminToken = token;
  return token;
}

async function ensureOrganizationInstallLinks(ctx) {
  const orgAdminToken = await ensureAdminToken(ctx);
  const org = await denApiFetch("/v1/org", { headers: authHeaders(orgAdminToken) });
  witness(ctx, org.response.ok, "Alex can load the organization", {
    status: org.response.status,
    organization: { id: org.body?.organization?.id, name: org.body?.organization?.name },
  });
  witness(ctx, org.body?.organization?.name === ORGANIZATION_NAME, "The eval organization is Acme Robotics", {
    id: org.body?.organization?.id,
    name: org.body?.organization?.name,
  });
  state.organizationId = org.body?.organization?.id ?? null;
  witness(ctx, typeof state.organizationId === "string", "Acme exposes an organization id", state.organizationId);

  const platformAdminToken = await ensurePlatformAdmin(ctx);
  const enabled = await denApiFetch(`/v1/admin/organizations/${state.organizationId}/capabilities`, {
    method: "PUT",
    headers: authHeaders(platformAdminToken),
    body: JSON.stringify({ capabilities: { installLinks: true } }),
  });
  witness(ctx, enabled.response.ok, "Acme install links are enabled", { status: enabled.response.status, body: enabled.body });
}

function markEmailVerified(ctx, email) {
  witness(ctx, MARK_VERIFIED_CMD.length > 0, "The eval has an email-verification setup command", Boolean(MARK_VERIFIED_CMD));
  execSync(MARK_VERIFIED_CMD.replaceAll("{email}", email), { stdio: "ignore" });
}

async function ensurePlatformAdmin(ctx) {
  if (state.platformAdminToken) return state.platformAdminToken;

  const signup = await denApiFetch("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Priya Platform", email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD }),
  });
  witness(ctx, signup.response.ok || [400, 403, 409, 422].includes(signup.response.status), "The allowlisted platform-admin account exists", {
    status: signup.response.status,
    email: PLATFORM_ADMIN_EMAIL,
  });
  markEmailVerified(ctx, PLATFORM_ADMIN_EMAIL);

  const signedIn = await denApiFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD }),
  });
  witness(ctx, signedIn.response.ok && typeof signedIn.body?.token === "string", "The platform admin can sign in", { status: signedIn.response.status, email: PLATFORM_ADMIN_EMAIL });
  state.platformAdminToken = signedIn.body.token;

  const probe = await denApiFetch("/v1/admin/overview", { headers: authHeaders(state.platformAdminToken) });
  witness(
    ctx,
    probe.response.ok,
    `${PLATFORM_ADMIN_EMAIL} is allowlisted as a platform admin`,
    { status: probe.response.status, hint: `Start den-api with DEN_BOOTSTRAP_ADMIN_EMAILS=${PLATFORM_ADMIN_EMAIL}` },
  );
  return state.platformAdminToken;
}

async function navigateTo(ctx, url) {
  await ctx.eval(`location.assign(${JSON.stringify(url)}); true`);
  await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000, label: `load ${url}` });
}

async function clickExactText(ctx, text, selector = "button, a") {
  await ctx.waitFor(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const element = candidates.find((candidate) => (candidate.textContent ?? '').trim() === ${JSON.stringify(text)} && !candidate.disabled);
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs: 20_000, label: `click ${text}` });
}

async function clickLastExactText(ctx, text, selector = "button") {
  await ctx.waitFor(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((candidate) => (candidate.textContent ?? '').trim() === ${JSON.stringify(text)} && !candidate.disabled);
    const element = candidates.at(-1);
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs: 20_000, label: `click last ${text}` });
}

async function signInToDenWeb(ctx) {
  await navigateTo(ctx, DEN_WEB_URL);
  await ctx.eval(
    `fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(() => true).catch(() => true)`,
    { awaitPromise: true },
  );
  await navigateTo(ctx, DEN_WEB_URL);
  await ctx.waitFor("document.body.innerText.includes('Sign in')", { timeoutMs: 30_000, label: "sign-in screen" });
  await clickExactText(ctx, "Sign in");
  await ctx.waitFor("Boolean(document.querySelector('input[type=\"email\"], input[name=\"email\"]'))", { timeoutMs: 15_000, label: "email input" });
  await ctx.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
  await ctx.fill('input[type="password"]', ADMIN_PASSWORD);
  await clickLastExactText(ctx, "Sign in");
  await ctx.waitFor("location.pathname.startsWith('/dashboard')", { timeoutMs: 45_000, label: "dashboard after sign-in" });
}

async function assertPendingInvitation(ctx) {
  const token = await ensureAdminToken(ctx);
  const org = await denApiFetch("/v1/org", { headers: authHeaders(token) });
  const invitations = Array.isArray(org.body?.invitations) ? org.body.invitations : [];
  const pending = invitations.find((entry) => entry?.email === INVITEE_EMAIL && entry?.status === "pending") ?? null;
  witness(ctx, org.response.ok && Boolean(pending), `Maya's invitation is pending in the server`, {
    status: org.response.status,
    pending: pending ? { id: pending.id, email: pending.email, role: pending.role, status: pending.status } : null,
  });
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function latestInvitationEmail(ctx) {
  const list = await denApiFetch("/v1/dev/emails?template=organizationInvite");
  const emails = Array.isArray(list.body?.emails) ? list.body.emails : [];
  const emailSummaries = emails.map((entry) => ({ template: entry?.template, to: entry?.to, subject: entry?.subject, at: entry?.at }));
  witness(ctx, list.response.ok && emails.some((entry) => entry?.to === INVITEE_EMAIL), "The dev outbox contains Maya's real invitation email", emailSummaries);
  witness(ctx, emails[0]?.to === INVITEE_EMAIL, "Maya's invitation is the newest rendered organization email", emailSummaries[0]);

  const response = await fetch(`${DEN_API_URL}/v1/dev/emails/last?template=organizationInvite`);
  const html = await response.text();
  witness(ctx, response.ok, "The rendered invitation email is available", response.status);
  const invitationMatch = html.match(/href="([^"]*\/join-org\?invite=[^"]+)"/);
  const invitationUrl = new URL(decodeHtmlAttribute(invitationMatch?.[1] ?? ""));
  witness(ctx, invitationUrl.origin === new URL(DEN_WEB_URL).origin, "The invitation acceptance link uses this deployment's public Den Web origin", { origin: invitationUrl.origin, pathname: invitationUrl.pathname });
  const match = html.match(/href="([^"]*\/install\?token=[^"]+)"/);
  const installUrl = decodeHtmlAttribute(match?.[1] ?? "");
  witness(ctx, installUrl.length > 0, "The invitation email contains an organization install link", redactedInstallUrl(installUrl));
  return { html, installUrl };
}

export default {
  id: FLOW_ID,
  title: "Invitation emails send teammates through the same organization installer as the dashboard",
  kind: "user-facing",
  requiredEnv: [
    "IPOLLOWALK_EVAL_DEN_API_URL",
    "IPOLLOWALK_EVAL_DEN_WEB_URL",
    "IPOLLOWALK_EVAL_DEN_TOKEN",
    "IPOLLOWALK_EVAL_PLATFORM_ADMIN_EMAIL",
    "IPOLLOWALK_EVAL_PLATFORM_ADMIN_PASSWORD",
    "IPOLLOWALK_EVAL_MARK_VERIFIED_CMD",
  ],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("Alex sends Maya an Acme invitation from the Members page", {
          voiceover: vo[0],
          action: async () => {
            await ensureOrganizationInstallLinks(ctx);
            await signInToDenWeb(ctx);
            await navigateTo(ctx, `${DEN_WEB_URL}/dashboard/members`);
            await clickExactText(ctx, "Add member", "button");
            await ctx.fill('input[placeholder="teammate@example.com"]', INVITEE_EMAIL);
            await clickExactText(ctx, "Send invite", "button");
            await ctx.waitForText(INVITEE_EMAIL, { timeoutMs: 30_000 });
            await ctx.waitForText("Pending", { timeoutMs: 20_000 });
            await ctx.waitFor(`(() => {
              const email = [...document.querySelectorAll('p')]
                .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(INVITEE_EMAIL)});
              email?.scrollIntoView({ block: 'center' });
              return Boolean(email);
            })()`, { timeoutMs: 20_000, label: "scroll Maya's pending invitation into view" });
          },
          assert: async () => {
            await assertPendingInvitation(ctx);
            await ctx.expectText(INVITEE_EMAIL);
            await ctx.expectText("Pending");
          },
          screenshot: { name: "invite-email-org-link-pending", requireText: [INVITEE_EMAIL, "Pending"] },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("Maya's real email links the desktop CTA to Acme's installer page", {
          voiceover: vo[1],
          action: async () => {
            const email = await latestInvitationEmail(ctx);
            state.emailInstallUrl = email.installUrl;
            const parsed = new URL(state.emailInstallUrl);
            witness(ctx, parsed.origin === new URL(DEN_WEB_URL).origin, "The email uses this deployment's public Den Web origin", parsed.origin);
            witness(ctx, parsed.pathname === "/install", "The email CTA targets the shared install page", parsed.pathname);
            witness(ctx, (parsed.searchParams.get("token") ?? "").length >= 8, "The email carries an opaque install token", parsed.searchParams.get("token")?.length);
            witness(ctx, !email.html.includes("https://ipollowalklabs.com/download"), "The organization invitation no longer uses the generic marketing download", "generic URL absent");
            ctx.output("invite-email-install-link", JSON.stringify({ to: INVITEE_EMAIL, installPage: `${parsed.origin}${parsed.pathname}`, opaqueTokenLength: parsed.searchParams.get("token")?.length }, null, 2));
            await navigateTo(ctx, `${DEN_API_URL}/v1/dev/emails/last?template=organizationInvite`);
            const invitationEvidenceRedacted = await ctx.eval(`(() => {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              let redactedTextNodes = 0;
              let node = walker.nextNode();
              while (node) {
                if (node.nodeValue?.includes('/join-org?invite=')) {
                  node.nodeValue = node.nodeValue.replace(/([?&]invite=)[^&\\s]+/g, '$1[redacted]');
                  redactedTextNodes += 1;
                }
                node = walker.nextNode();
              }
              let redactedLinks = 0;
              for (const link of document.querySelectorAll('a[href*="/join-org?invite="]')) {
                link.href = ${JSON.stringify(`${DEN_WEB_URL}/join-org?invite=%5Bredacted%5D`)};
                redactedLinks += 1;
              }
              return redactedTextNodes > 0 && redactedLinks > 0;
            })()`);
            witness(ctx, invitationEvidenceRedacted === true, "Published email evidence redacts the invitation credential", invitationEvidenceRedacted);
            await ctx.waitForText("Accept invite", { timeoutMs: 20_000 });
            await ctx.waitForText("Download the desktop app", { timeoutMs: 20_000 });
          },
          assert: async () => {
            const href = await ctx.eval(`(() => [...document.querySelectorAll('a')]
              .find((link) => link.textContent?.trim() === 'Download the desktop app')?.href ?? '')()`);
            witness(ctx, href === state.emailInstallUrl, "The visible email CTA uses the asserted Acme install URL", redactedInstallUrl(href));
            await ctx.expectText("Accept invite");
            await ctx.expectText("Download the desktop app");
          },
          screenshot: {
            name: "invite-email-org-link-real-email",
            requireText: ["Join Acme Robotics", "Accept invite", "Download the desktop app"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("The email opens Acme's Windows installer and keeps fallback URLs token-free", {
          voiceover: vo[2],
          action: async () => {
            await ctx.client.send("Emulation.setUserAgentOverride", {
              userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              platform: "Win32",
            });
            await ctx.eval(`(() => {
              const link = [...document.querySelectorAll('a')]
                .find((candidate) => candidate.textContent?.trim() === 'Download the desktop app');
              if (!link) return false;
              link.target = '_self';
              return true;
            })()`);
            try {
              await ctx.trustedClick('a[href*="/install?token="]');
              await ctx.waitFor("location.pathname === '/install'", { timeoutMs: 30_000, label: "Acme install page" });
              const currentUrl = await ctx.eval("location.href");
              witness(ctx, currentUrl === state.emailInstallUrl, "The email opens the exact organization install link", redactedInstallUrl(currentUrl));
              await ctx.waitForText(`Download iPolloWalk for ${ORGANIZATION_NAME}`, { timeoutMs: 30_000 });
              await ctx.waitForText("Download for Windows", { timeoutMs: 20_000 });
            } finally {
              await ctx.eval(`(() => { History.prototype.replaceState.call(history, null, '', '/install?token=%5Bredacted%5D'); return true; })()`);
            }
          },
          assert: async () => {
            state.windowsDownloadUrl = await ctx.eval("document.querySelector('[data-testid=\"install-download-primary\"]')?.href ?? ''");
            const download = new URL(state.windowsDownloadUrl);
            const installToken = new URL(state.emailInstallUrl).searchParams.get("token") ?? "";
            const config = await denApiFetch(`/v1/install-config?token=${encodeURIComponent(installToken)}`);
            witness(ctx, config.response.ok && typeof config.body?.apiUrl === "string", "The email install token resolves its public API URL", { status: config.response.status, body: config.body });
            const configuredApi = new URL(config.body.apiUrl);
            const expectedPath = `${configuredApi.pathname.replace(/\/+$/, "")}/v1/install/win-x64`;
            witness(ctx, download.origin === configuredApi.origin && download.pathname === expectedPath, "Windows download preserves the configured public API origin and path prefix", { href: redactedInstallUrl(state.windowsDownloadUrl, [installToken]), configuredApi: config.body.apiUrl, expectedPath });

            const firstResponse = await fetch(state.windowsDownloadUrl, { redirect: "manual" });
            const location = firstResponse.headers.get("location") ?? "";
            if (firstResponse.status === 302) {
              witness(ctx, location.length > 0, "A missing generic artifact returns a fallback location", redactedInstallUrl(location, [installToken]));
              witness(ctx, !location.includes(installToken), "The fallback URL contains no organization token", redactedInstallUrl(location, [installToken]));
              const fallback = await fetch(location, { method: "HEAD", redirect: "follow" });
              witness(ctx, fallback.ok && fallback.url.toLowerCase().includes(".exe"), "The verified fallback resolves to a real Windows executable", { status: fallback.status, url: redactedInstallUrl(fallback.url, [installToken]) });
              ctx.output("windows-invite-download", JSON.stringify({ mode: "verified normal fallback", denStatus: firstResponse.status, location: redactedInstallUrl(location, [installToken]), finalStatus: fallback.status, finalUrl: redactedInstallUrl(fallback.url, [installToken]) }, null, 2));
            } else {
              witness(ctx, firstResponse.ok, "Den serves the generic Windows installer", firstResponse.status);
              witness(ctx, (firstResponse.headers.get("content-type") ?? "").includes("portable-executable"), "The generic response is a Windows executable", firstResponse.headers.get("content-type"));
              ctx.output("windows-invite-download", JSON.stringify({ mode: "generic organization installer", status: firstResponse.status, contentType: firstResponse.headers.get("content-type") }, null, 2));
            }
            await ctx.expectText(`Download iPolloWalk for ${ORGANIZATION_NAME}`);
            await ctx.expectText("Download for Windows");
          },
          screenshot: {
            name: "invite-email-org-link-windows-page",
            requireText: [`Download iPolloWalk for ${ORGANIZATION_NAME}`, "Download for Windows", "Run it, then sign in"],
            rejectText: ["Not Found", "Something went wrong"],
          },
        });
      },
    },
  ],
};
