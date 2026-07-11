import { execSync } from "node:child_process";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "connect-delivery-switch";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const DEN_API_URL = cleanBaseUrl(process.env.IPOLLOWORK_EVAL_DEN_API_URL);
const DEN_WEB_URL = cleanBaseUrl(process.env.IPOLLOWORK_EVAL_DEN_WEB_URL || DEN_API_URL);
const ADMIN_EMAIL = process.env.IPOLLOWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.IPOLLOWORK_EVAL_DEMO_PASSWORD?.trim() || "iPolloWorkDemo123!";
const PLATFORM_ADMIN_EMAIL = process.env.IPOLLOWORK_EVAL_PLATFORM_ADMIN_EMAIL?.trim() || "";
const PLATFORM_ADMIN_PASSWORD = process.env.IPOLLOWORK_EVAL_PLATFORM_ADMIN_PASSWORD?.trim() || "";
const MARK_VERIFIED_CMD = process.env.IPOLLOWORK_EVAL_MARK_VERIFIED_CMD?.trim() || "";
const WORKSPACE_PATH = "/tmp/ipollowork-connect-delivery-switch";
const RUN_TAG = Date.now();
const SEED_PREFIX = "connect-delivery-switch";
const MARKETPLACE_NAME = `${SEED_PREFIX}-${RUN_TAG}`;
const PLUGIN_NAME = `Connect Delivery Probe ${RUN_TAG}`;
const PLUGIN_DESCRIPTION = "A seeded marketplace plugin used to prove Connect delivery.";
const SKILL_NAME = `connect-delivery-probe-${RUN_TAG}`;
const SKILL_DESCRIPTION = "Reports that marketplace content runs through Connect.";

const state = {
  orgAdminToken: null,
  platformAdminToken: null,
  orgId: null,
  marketplaceId: null,
  pluginId: null,
};

export default {
  id: FLOW_ID,
  title: "Connect-mode delivery switch moves marketplace plugins from desktop import to the cloud rail",
  kind: "user-facing",
  spec: "evals/voiceovers/connect-delivery-switch.md",
  requiredEnv: [
    "IPOLLOWORK_EVAL_DEN_API_URL",
    "IPOLLOWORK_EVAL_PLATFORM_ADMIN_EMAIL",
    "IPOLLOWORK_EVAL_PLATFORM_ADMIN_PASSWORD",
    "IPOLLOWORK_EVAL_MARK_VERIFIED_CMD",
  ],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("With Connect off, Extensions still exposes the installable Marketplace pane", {
          voiceover: vo[0],
          action: async () => {
            await prepareSignedInDesktopWithConnectOff(ctx);
            await openExtensionsMarketplace(ctx);
            await waitForMarketplacePlugin(ctx, PLUGIN_NAME);
          },
          assert: async () => {
            const proof = await readExtensionsMarketplaceState(ctx, PLUGIN_NAME);
            ctx.assert(proof.buttonTexts.includes("My Extensions"), `My Extensions toggle missing: ${JSON.stringify(proof.buttonTexts)}`);
            ctx.assert(proof.buttonTexts.includes("Marketplace"), `Marketplace toggle missing: ${JSON.stringify(proof.buttonTexts)}`);
            ctx.assert(proof.pageText.includes("Extension Marketplace"), "Marketplace pane did not render.");
            ctx.assert(proof.pluginCardText.includes(PLUGIN_NAME), `Seed plugin card missing: ${proof.pluginCardText}`);
            ctx.assert(proof.pluginCardText.includes("Add"), `Seed plugin was not installable: ${proof.pluginCardText}`);
            ctx.assert(!proof.pluginCardText.includes("Runs in cloud"), `Connect cloud label leaked with flag off: ${proof.pluginCardText}`);
          },
          screenshot: {
            name: "connect-delivery-flag-off-marketplace-installable",
            claim: "Flag off keeps the Extensions Marketplace toggle and an installable marketplace plugin.",
            requireText: ["My Extensions", "Marketplace", PLUGIN_NAME, "Add"],
            rejectText: ["Cloud-runnable marketplace apps live in Connect.", "Runs in cloud", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("With Connect on, the Extensions Marketplace tab filters to machine-installable items and points cloud content at Connect", {
          voiceover: vo[1],
          action: async () => {
            await setCapabilityViaAdminApi(ctx, { mcpConnections: true });
            await remountDesktop(ctx);
            await navigateToSettingsTab(ctx, "extensions");
            await ctx.waitForText("Cloud-runnable marketplace apps live in Connect.", { timeoutMs: 60_000 });
            await openExtensionsMarketplace(ctx);
            await ctx.waitForText("installs on this machine", { timeoutMs: 30_000 });
          },
          assert: async () => {
            const proof = await readExtensionsMarketplaceState(ctx, PLUGIN_NAME);
            ctx.assert(proof.pageText.includes("Cloud-runnable marketplace apps live in Connect."), "Runtime-split hint missing.");
            ctx.assert(proof.buttonTexts.includes("Open Connect"), `Open Connect button missing: ${JSON.stringify(proof.buttonTexts)}`);
            ctx.assert(proof.buttonTexts.includes("My Extensions"), `My Extensions toggle should stay: ${JSON.stringify(proof.buttonTexts)}`);
            ctx.assert(proof.buttonTexts.includes("Marketplace"), `Marketplace toggle should stay: ${JSON.stringify(proof.buttonTexts)}`);
            ctx.assert(proof.pageText.includes("installs on this machine"), "Filtered marketplace heading missing.");
            ctx.assert(!proof.pluginCardText.includes(PLUGIN_NAME), `Cloud-runnable plugin leaked into the machine pane: ${proof.pluginCardText}`);
            ctx.assert(!proof.pageText.includes(PLUGIN_NAME), "Cloud-runnable plugin name rendered in Extensions marketplace pane.");
          },
          screenshot: {
            name: "connect-delivery-flag-on-extensions-hint",
            claim: "Flag on keeps the Marketplace tab but filters it to items that install on this machine.",
            requireText: ["installs on this machine", "Open Connect"],
            rejectText: [PLUGIN_NAME, "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("Connect active state lists the seeded marketplace plugin as cloud-run with no install action", {
          voiceover: vo[2],
          action: async () => {
            await ctx.clickText("Open Connect", { selector: "button", timeoutMs: 30_000 });
            await ctx.waitFor("window.location.hash.includes('/settings/connect')", { timeoutMs: 30_000, label: "connect settings route" });
            await waitForConnectOrganizationRow(ctx, PLUGIN_NAME);
            await ctx.eval("document.querySelector('[data-testid=\"connect-organization-section\"]')?.scrollIntoView({ block: 'center' })");
          },
          assert: async () => {
            const proof = await readConnectOrganizationState(ctx, PLUGIN_NAME);
            ctx.assert(proof.statusText.includes("Connected to"), `Connect status missing: ${JSON.stringify(proof)}`);
            ctx.assert(proof.sectionText.includes("From your organization"), `Organization section missing: ${proof.sectionText}`);
            ctx.assert(proof.sectionText.includes("READY TO USE"), `Ready group missing: ${proof.sectionText}`);
            ctx.assert(proof.rowText.includes(PLUGIN_NAME), `Seed plugin missing from Connect row: ${proof.rowText}`);
            ctx.assert(proof.rowText.includes("Ready"), `Ready chip missing: ${proof.rowText}`);
            ctx.assert(proof.rowButtons.length === 0, `Ready row should have no action button: ${JSON.stringify(proof.rowButtons)}`);
            ctx.assert(!proof.rowText.includes("Add"), `Connect row exposed Add: ${proof.rowText}`);
          },
          screenshot: {
            name: "connect-delivery-connect-cloud-rail",
            claim: "Connect lists the marketplace plugin in the Ready group with no install button.",
            requireText: ["From your organization", "READY TO USE", PLUGIN_NAME],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("Turning Connect back off restores the Extensions Marketplace toggle and install action", {
          voiceover: vo[3],
          action: async () => {
            await setCapabilityViaAdminApi(ctx, { mcpConnections: false });
            await remountDesktop(ctx);
            await openExtensionsMarketplace(ctx);
            await waitForMarketplacePlugin(ctx, PLUGIN_NAME);
          },
          assert: async () => {
            const proof = await readExtensionsMarketplaceState(ctx, PLUGIN_NAME);
            ctx.assert(proof.buttonTexts.includes("My Extensions"), `My Extensions toggle did not return: ${JSON.stringify(proof.buttonTexts)}`);
            ctx.assert(proof.buttonTexts.includes("Marketplace"), `Marketplace toggle did not return: ${JSON.stringify(proof.buttonTexts)}`);
            ctx.assert(proof.pluginCardText.includes("Add"), `Seed plugin was not installable after restore: ${proof.pluginCardText}`);
            ctx.assert(!proof.pageText.includes("Cloud-runnable marketplace apps live in Connect."), "Runtime-split hint persisted after capability off.");
          },
          screenshot: {
            name: "connect-delivery-flag-off-restored",
            claim: "Flag off restores the old Extensions Marketplace pane with the install action.",
            requireText: ["Extension Marketplace", PLUGIN_NAME, "Add"],
            rejectText: ["Cloud-runnable marketplace apps live in Connect.", "Runs in cloud", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Cleanup",
      run: async (ctx) => {
        await setCapabilityViaAdminApi(ctx, { mcpConnections: false }).catch(() => undefined);
        await cleanupSeededMarketplace(ctx).catch((error) => {
          ctx.log(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      },
    },
  ],
};

function cleanBaseUrl(value) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireStateValue(value, label) {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`${label} was not prepared by an earlier frame.`);
}

async function denApiFetch(pathname, options = {}) {
  const response = await fetch(`${DEN_API_URL}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      origin: DEN_WEB_URL,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, text };
}

async function signIn(email, password) {
  return denApiFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

function markEmailVerified(ctx, email) {
  ctx.assert(
    MARK_VERIFIED_CMD.length > 0,
    "Platform-admin provisioning requires IPOLLOWORK_EVAL_MARK_VERIFIED_CMD with an {email} placeholder.",
  );
  execSync(MARK_VERIFIED_CMD.replaceAll("{email}", email), { stdio: "ignore" });
}

async function ensurePlatformAdmin(ctx) {
  if (state.platformAdminToken) return state.platformAdminToken;

  const signup = await denApiFetch("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Priya Platform", email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD }),
  });
  const signupAccepted = signup.response.ok || [400, 403, 409, 422].includes(signup.response.status);
  ctx.assert(signupAccepted, `Platform admin sign-up failed: ${signup.response.status} ${signup.text.slice(0, 300)}`);
  markEmailVerified(ctx, PLATFORM_ADMIN_EMAIL);

  const signedIn = await signIn(PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
  ctx.assert(
    signedIn.response.ok && typeof signedIn.body?.token === "string",
    `Platform admin sign-in failed: ${signedIn.response.status} ${signedIn.text.slice(0, 300)}`,
  );
  state.platformAdminToken = signedIn.body.token;

  const probe = await denApiFetch("/v1/admin/overview", {
    headers: { authorization: `Bearer ${state.platformAdminToken}` },
  });
  ctx.assert(
    probe.response.ok,
    `${PLATFORM_ADMIN_EMAIL} is not a platform admin (overview probe ${probe.response.status}).`,
  );
  return state.platformAdminToken;
}

async function ensureOrgAdminContext(ctx) {
  if (state.orgAdminToken && state.orgId) return;

  const signedIn = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  ctx.assert(
    signedIn.response.ok && typeof signedIn.body?.token === "string",
    `Org admin sign-in failed for ${ADMIN_EMAIL}: ${signedIn.response.status} ${signedIn.text.slice(0, 300)}`,
  );
  state.orgAdminToken = signedIn.body.token;

  const listed = await denApiFetch("/v1/me/orgs", {
    headers: { authorization: `Bearer ${state.orgAdminToken}` },
  });
  ctx.assert(listed.response.ok, `Could not list orgs: ${listed.response.status} ${listed.text.slice(0, 300)}`);
  const orgs = listed.body?.orgs;
  ctx.assert(Array.isArray(orgs), "Current user organizations payload was missing orgs.");
  const activeOrgId = typeof listed.body?.activeOrgId === "string" ? listed.body.activeOrgId : null;
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  ctx.assert(activeOrg && typeof activeOrg.id === "string", `Could not resolve an organization for ${ADMIN_EMAIL}.`);
  state.orgId = activeOrg.id;

  const active = await denApiFetch("/v1/me/active-organization", {
    method: "POST",
    headers: { authorization: `Bearer ${state.orgAdminToken}` },
    body: JSON.stringify({ organizationId: state.orgId }),
  });
  ctx.assert(active.response.ok, `Could not switch active organization: ${active.response.status} ${active.text.slice(0, 300)}`);
}

async function setCapabilityViaAdminApi(ctx, capabilities) {
  const token = requireStateValue(state.platformAdminToken, "platform admin token");
  const orgId = requireStateValue(state.orgId, "organization id");
  const updated = await denApiFetch(`/v1/admin/organizations/${orgId}/capabilities`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ capabilities }),
  });
  ctx.assert(updated.response.ok, `Admin capability update failed: ${updated.response.status} ${updated.text.slice(0, 300)}`);
}

function skillSourceText() {
  return [
    "---",
    `name: ${SKILL_NAME}`,
    `description: ${SKILL_DESCRIPTION}`,
    "---",
    "",
    "When invoked, explain that this marketplace skill is active through iPolloWork Connect.",
  ].join("\n");
}

async function seedMarketplacePlugin(ctx) {
  await cleanupSeededMarketplace(ctx);
  const token = requireStateValue(state.orgAdminToken, "org admin token");

  const marketplace = await denApiFetch("/v1/marketplaces", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: MARKETPLACE_NAME, description: "Connect delivery switch seeded marketplace" }),
  });
  ctx.assert(marketplace.response.ok, `Marketplace create failed: ${marketplace.response.status} ${marketplace.text.slice(0, 300)}`);
  state.marketplaceId = marketplace.body?.item?.id ?? null;
  ctx.assert(typeof state.marketplaceId === "string", `Marketplace create response missing id: ${marketplace.text.slice(0, 300)}`);

  const grant = await denApiFetch(`/v1/marketplaces/${state.marketplaceId}/access`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ orgWide: true, role: "viewer" }),
  });
  ctx.assert(grant.response.ok, `Marketplace access grant failed: ${grant.response.status} ${grant.text.slice(0, 300)}`);

  const plugin = await denApiFetch("/v1/plugins", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: PLUGIN_NAME,
      description: PLUGIN_DESCRIPTION,
      orgWide: true,
      marketplaceId: state.marketplaceId,
      components: [{
        type: "skill",
        input: {
          rawSourceText: skillSourceText(),
          metadata: { name: SKILL_NAME, description: SKILL_DESCRIPTION },
        },
      }],
    }),
  });
  ctx.assert(plugin.response.ok, `Plugin create failed: ${plugin.response.status} ${plugin.text.slice(0, 300)}`);
  state.pluginId = plugin.body?.item?.id ?? null;
  ctx.assert(typeof state.pluginId === "string", `Plugin create response missing id: ${plugin.text.slice(0, 300)}`);
}

async function cleanupSeededMarketplace(ctx) {
  if (!state.orgAdminToken) return;
  const token = state.orgAdminToken;
  const headers = { authorization: `Bearer ${token}` };

  const marketplaces = await denApiFetch("/v1/marketplaces?limit=100", { headers });
  if (marketplaces.response.ok && Array.isArray(marketplaces.body?.items)) {
    for (const marketplace of marketplaces.body.items) {
      if (typeof marketplace.name !== "string" || !marketplace.name.startsWith(SEED_PREFIX)) continue;
      await cleanupMarketplacePlugins(ctx, marketplace.id, token);
      await denApiFetch(`/v1/marketplaces/${marketplace.id}/archive`, { method: "POST", headers });
    }
  }

  const plugins = await denApiFetch(`/v1/plugins?limit=100&q=${encodeURIComponent("Connect Delivery Probe")}`, { headers });
  if (plugins.response.ok && Array.isArray(plugins.body?.items)) {
    for (const plugin of plugins.body.items) {
      if (typeof plugin.name !== "string" || !plugin.name.startsWith("Connect Delivery Probe")) continue;
      await cleanupPlugin(ctx, plugin.id, token);
    }
  }

  state.marketplaceId = null;
  state.pluginId = null;
}

async function cleanupMarketplacePlugins(ctx, marketplaceId, token) {
  if (typeof marketplaceId !== "string") return;
  const headers = { authorization: `Bearer ${token}` };
  const memberships = await denApiFetch(`/v1/marketplaces/${marketplaceId}/plugins`, { headers });
  if (!memberships.response.ok || !Array.isArray(memberships.body?.items)) return;
  for (const membership of memberships.body.items) {
    if (typeof membership.pluginId !== "string") continue;
    await denApiFetch(`/v1/marketplaces/${marketplaceId}/plugins/${membership.pluginId}`, { method: "DELETE", headers });
    await cleanupPlugin(ctx, membership.pluginId, token);
  }
}

async function cleanupPlugin(ctx, pluginId, token) {
  if (typeof pluginId !== "string") return;
  const headers = { authorization: `Bearer ${token}` };
  const memberships = await denApiFetch(`/v1/plugins/${pluginId}/config-objects`, { headers });
  if (memberships.response.ok && Array.isArray(memberships.body?.items)) {
    for (const membership of memberships.body.items) {
      if (typeof membership.configObjectId !== "string") continue;
      await denApiFetch(`/v1/plugins/${pluginId}/config-objects/${membership.configObjectId}`, { method: "DELETE", headers });
      await denApiFetch(`/v1/config-objects/${membership.configObjectId}/delete`, { method: "POST", headers });
    }
  }
  const archived = await denApiFetch(`/v1/plugins/${pluginId}/archive`, { method: "POST", headers });
  if (!archived.response.ok && archived.response.status !== 404) {
    ctx.log(`Plugin archive returned ${archived.response.status}: ${archived.text.slice(0, 200)}`);
  }
}

async function prepareSignedInDesktopWithConnectOff(ctx) {
  await ensurePlatformAdmin(ctx);
  await ensureOrgAdminContext(ctx);
  await setCapabilityViaAdminApi(ctx, { mcpConnections: true });
  await seedMarketplacePlugin(ctx);
  await setCapabilityViaAdminApi(ctx, { mcpConnections: false });
  await signDesktopIntoCloud(ctx);
  await clearDesktopConfigCache(ctx);
  await completeDesktopCloudOnboardingIfNeeded(ctx);
}

async function signDesktopIntoCloud(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 120_000, label: "desktop control API" });
  await ctx.waitFor("Boolean(window.__IPOLLOWORK_ELECTRON__?.invokeDesktop)", { timeoutMs: 30_000, label: "desktop bridge" });
  const bootstrap = { baseUrl: DEN_API_URL, apiBaseUrl: DEN_API_URL, requireSignin: false, handoff: null };
  const written = await ctx.eval(`(async () => {
    const bridge = window.__IPOLLOWORK_ELECTRON__?.invokeDesktop;
    if (!bridge) return { ok: false };
    await bridge("setDesktopBootstrapConfig", ${JSON.stringify(bootstrap)});
    localStorage.setItem('ipollowork.den.baseUrl', ${JSON.stringify(DEN_API_URL)});
    localStorage.setItem('ipollowork.den.apiBaseUrl', ${JSON.stringify(DEN_API_URL)});
    localStorage.removeItem('ipollowork.den.authToken');
    localStorage.removeItem('ipollowork.den.activeOrgId');
    localStorage.removeItem('ipollowork.den.activeOrgSlug');
    localStorage.removeItem('ipollowork.den.activeOrgName');
    return { ok: true };
  })()`, { awaitPromise: true });
  ctx.assert(written?.ok, "Failed to write desktop bootstrap config.");
  await clearDesktopConfigCache(ctx);
  await ctx.eval("location.reload()");
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "control API after bootstrap reload" });
  await ctx.waitFor("(document.getElementById('root')?.childElementCount ?? 0) > 0", { timeoutMs: 60_000, label: "react root mounted after bootstrap reload" });

  const handoff = await denApiFetch("/v1/auth/desktop-handoff", {
    method: "POST",
    headers: { authorization: `Bearer ${requireStateValue(state.orgAdminToken, "org admin token")}` },
    body: JSON.stringify({ desktopScheme: "ipollowork" }),
  });
  ctx.assert(handoff.response.ok, `Handoff create failed: ${handoff.response.status} ${handoff.text.slice(0, 300)}`);
  await ctx.control("auth.exchange-grant", { grant: handoff.body.grant, baseUrl: DEN_API_URL });
  await ctx.waitFor("Boolean((localStorage.getItem('ipollowork.den.authToken') ?? '').trim())", {
    timeoutMs: 45_000,
    label: "persisted den auth token",
  });
  await ctx.waitFor(`localStorage.getItem('ipollowork.den.activeOrgId') === ${JSON.stringify(requireStateValue(state.orgId, "organization id"))}`, {
    timeoutMs: 60_000,
    label: "active org resolved",
  });
}

async function clearDesktopConfigCache(ctx) {
  await ctx.eval(`(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ipollowork.den.desktopConfig:')) localStorage.removeItem(key);
    }
    return true;
  })()`);
}

async function completeDesktopCloudOnboardingIfNeeded(ctx) {
  await ctx.clickText("Continue with organization", { timeoutMs: 5_000 }).catch(() => {});
  await ctx.clickText("Continue to workspace", { timeoutMs: 8_000 }).catch(() => {});
  const needsFolder = await ctx.eval("Boolean(document.querySelector('input[placeholder=\"/workspace/my-project\"]'))").catch(() => false);
  if (needsFolder) {
    await ctx.fill('input[placeholder="/workspace/my-project"]', WORKSPACE_PATH);
    await ctx.clickText("Use this folder", { timeoutMs: 10_000 });
    await ctx.waitFor("window.location.hash.includes('/workspace/')", { timeoutMs: 60_000, label: "workspace open after folder selection" });
  }
  await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').trim() === 'Continue without iPolloWork Models');
    button?.click();
    return true;
  })()`);
}

async function remountDesktop(ctx) {
  await clearDesktopConfigCache(ctx);
  // The renderer sometimes boots into a dead-blank state (empty root, no
  // control API) that only another reload clears. Retry with bounds.
  let remountReady = false;
  for (let attempt = 0; attempt < 3 && !remountReady; attempt += 1) {
    await ctx.eval("location.reload()");
    try {
      await ctx.waitFor("Boolean(window.__ipolloworkControl) && (document.getElementById('root')?.childElementCount ?? 0) > 0", { timeoutMs: 45_000, label: `desktop alive after reload (attempt ${attempt + 1})` });
      remountReady = true;
    } catch {
      // fall through to the next reload attempt
    }
  }
  ctx.assert(remountReady, "Desktop never became interactive after remount reloads.");
  await ctx.waitFor("(document.getElementById('root')?.childElementCount ?? 0) > 0", { timeoutMs: 120_000, label: "react root mounted after reload" });
  await completeDesktopCloudOnboardingIfNeeded(ctx);
}

async function navigateToSettingsTab(ctx, tab) {
  const workspaceId = await ctx.eval("(window.location.hash.match(/\\/workspace\\/([^/]+)/) ?? [])[1] ?? ''");
  await ctx.navigateHash(workspaceId ? `/workspace/${workspaceId}/settings/${tab}` : `/settings/${tab}`);
  await ctx.waitFor(`window.location.hash.includes('/settings/${tab}')`, { timeoutMs: 30_000, label: `${tab} settings route` });
  // Hash changes during early boot can leave the React root empty (observed
  // deterministically after remounts). Recover once with a reload — the hash
  // is already at the target, so a fresh boot lands on the right tab.
  try {
    await ctx.waitFor("(document.body?.innerText ?? '').includes('Back to app')", { timeoutMs: 10_000, label: "settings surface mounted" });
  } catch {
    await ctx.eval("location.reload()");
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "control API after settings recovery reload" });
    await ctx.waitFor("(document.body?.innerText ?? '').includes('Back to app')", { timeoutMs: 60_000, label: "settings surface mounted (after recovery)" });
  }
}

async function openExtensionsMarketplace(ctx) {
  await navigateToSettingsTab(ctx, "extensions");
  await ctx.waitForText("My Extensions", { timeoutMs: 30_000 });
  await ctx.clickText("Marketplace", { selector: "button", timeoutMs: 30_000 });
  // Heading differs by mode: flag off = "Extension Marketplace", flag on =
  // "From your marketplace — installs on this machine".
  await ctx.waitFor(
    "(document.body?.innerText ?? '').includes('Extension Marketplace') || (document.body?.innerText ?? '').includes('installs on this machine')",
    { timeoutMs: 30_000, label: "marketplace pane heading" },
  );
  await ctx.control("extensions.refresh-marketplace").catch(() => {});
}

async function waitForMarketplacePlugin(ctx, name) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const found = await ctx.eval(`document.body.innerText.includes(${JSON.stringify(name)})`);
    if (found) return;
    await ctx.control("extensions.refresh-marketplace").catch(() => {});
    await sleep(2_000);
  }
  ctx.assert(false, `Marketplace plugin did not render: ${name}`);
}

async function waitForConnectOrganizationRow(ctx, name) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const found = await ctx.eval(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="connect-organization-row"]')];
      return rows.some((row) => (row.innerText ?? '').includes(${JSON.stringify(name)}));
    })()`);
    if (found) return;
    await sleep(1_000);
  }
  ctx.assert(false, `Connect organization row did not render: ${name}`);
}

async function readConnectOrganizationState(ctx, name) {
  return ctx.eval(`(() => {
    const compact = (entry) => (entry?.innerText ?? entry?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const section = document.querySelector('[data-testid="connect-organization-section"]');
    const row = [...document.querySelectorAll('[data-testid="connect-organization-row"]')]
      .find((entry) => compact(entry).includes(${JSON.stringify(name)}));
    return {
      pageText: document.body.innerText,
      statusText: compact(document.querySelector('[data-testid="connect-org-status-row"]')),
      sectionText: section ? section.innerText : '',
      rowText: compact(row),
      rowButtons: [...(row?.querySelectorAll('button') ?? [])].map(compact),
    };
  })()`);
}

async function readExtensionsMarketplaceState(ctx, name) {
  return ctx.eval(`(() => {
    const compact = (entry) => (entry?.innerText ?? entry?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const buttons = [...document.querySelectorAll('button')];
    const pluginCard = buttons.find((button) => compact(button).includes(${JSON.stringify(name)}));
    return {
      pageText: document.body.innerText,
      buttonTexts: buttons.map(compact),
      pluginCardText: compact(pluginCard),
    };
  })()`);
}

async function readExtensionsHintState(ctx) {
  return ctx.eval(`(() => {
    const compact = (entry) => (entry?.innerText ?? entry?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const buttons = [...document.querySelectorAll('button')];
    return {
      text: document.body.innerText,
      buttonTexts: buttons.map(compact),
    };
  })()`);
}

async function readConnectMarketplaceState(ctx, name) {
  return ctx.eval(`(() => {
    const compact = (entry) => (entry?.innerText ?? entry?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const section = document.querySelector('[data-testid="connect-marketplace-section"]');
    const card = [...document.querySelectorAll('[data-testid="connect-marketplace-plugin-card"]')]
      .find((entry) => compact(entry).includes(${JSON.stringify(name)}));
    return {
      pageText: document.body.innerText,
      statusText: compact(document.querySelector('[data-testid="connect-org-status-row"]')),
      sectionText: compact(section),
      cardText: compact(card),
      cardButtons: [...(card?.querySelectorAll('button') ?? [])].map(compact),
    };
  })()`);
}
