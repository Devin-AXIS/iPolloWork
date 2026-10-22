import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  assertCloudPluginIdentity,
  cloudPluginUpdate,
  installCloudPluginResource,
  discoverEnterpriseConnection,
  downloadEnterpriseResource,
  joinEnterpriseWithCode,
  listEnterpriseResources,
  readRemoteTemplateCard,
  normalizeEnterpriseOrigin,
  readEnterpriseConnections,
  refreshEnterpriseConnection,
  refreshEnterpriseMembership,
  removeEnterpriseConnection,
  saveEnterpriseConnection,
  setEnterpriseConnectionAccount,
  type EnterpriseConnection,
  type EnterpriseResource,
} from "../src/app/lib/enterprise-connections";
import { comparePluginPackageVersions } from "@ipollowork/types/plugins";
import { IPOLLOWORK_PACKAGE_MEDIA_TYPE, templateManifestV1Schema } from "@ipollowork/types/templates";
import { enterpriseFeaturesSchema } from "@ipollowork/types/enterprise";
import { activateEnterpriseWorkContext, activatePersonalWorkContext, clearEnterpriseLoginState, readActiveEnterpriseConnection, readActiveWorkContextId } from "../src/app/lib/work-context";

const originalWindow = globalThis.window;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

const connectedEnterprise: EnterpriseConnection = {
  id: "ent_medical",
  name: "Medical Studio",
  shortName: "Medical",
  origin: "https://enterprise.example.com",
  logoUrl: null,
  accent: "blue",
  authMode: "ipollo_oidc",
  membership: { id: "member-1", role: "member" },
  session: { token: "enterprise-session", expiresAt: "2099-01-01T00:00:00.000Z" },
};

async function sha256Hex(bytes: Uint8Array) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function artifactResponse(
  bytes: Uint8Array,
  type: EnterpriseResource["type"],
  digest: string,
  contentType: string,
  digestHeader = "x-ipollowork-sha256",
  typeHeader = "x-ipollowork-resource-type",
) {
  return new Response(bytes, { headers: {
    "content-type": contentType,
    [digestHeader]: digest,
    [typeHeader]: type,
  } });
}

describe("enterprise connections", () => {
  beforeEach(() => {
    const localStorage = memoryStorage();
    localStorage.setItem("ipollowork.den.baseUrl", "http://i.ipollo.ai");
    localStorage.setItem("ipollowork.den.authToken", "cloud-session");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage, sessionStorage: memoryStorage(), dispatchEvent: () => true },
    });
    setEnterpriseConnectionAccount(null);
    setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: "http://i.ipollo.ai", token: "cloud-session" });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  test("normalizes only http and https server addresses", () => {
    expect(normalizeEnterpriseOrigin("https://enterprise.example.com/")).toBe(
      "https://enterprise.example.com",
    );
    expect(normalizeEnterpriseOrigin("http://localhost:3200/team/")).toBe(
      "http://localhost:3200/team",
    );
    expect(normalizeEnterpriseOrigin("ipollowork://enterprise")).toBeNull();
  });

  test("reads a versioned card with the member session and rejects mismatched identities and executable covers", async () => {
    const manifest = templateManifestV1Schema.parse({ schemaVersion: 1, id: "test.remote-card", version: "1.0.0", kind: "design", category: "site", subcategory: "landing", style: "minimal", title: "Remote card", description: "A template card", cover: "cover.svg", entry: "entry.html", source: { name: "Test", license: "Private" }, designSystem: { tokenVersion: 1, editableGroups: ["theme"] }, applyChecklist: ["Update content"], minimumAppVersion: "0.1.0" });
    const resource: EnterpriseResource = { id: "remote-card", type: "template", slug: manifest.id, manifestId: manifest.id, name: manifest.title, description: manifest.description, category: "site", enterpriseCategory: "Marketing", iconPath: null, featured: false, updatedAt: "2026-10-22", latestVersion: { version: "1.0.0", digest: "a".repeat(64), downloadPath: "/api/v1/resources/remote-card/versions/1.0.0/download" } };
    let payload = { manifest, coverDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" };
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requested.push(String(input));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer enterprise-session");
      return Response.json(payload);
    };
    const options = { connection: connectedEnterprise, fetcher };
    expect((await readRemoteTemplateCard(resource, options)).manifest.id).toBe(manifest.id);
    expect(requested).toEqual(["https://enterprise.example.com/api/v1/resources/remote-card?version=1.0.0"]);
    payload = { ...payload, manifest: { ...manifest, id: "test.different" } };
    await expect(readRemoteTemplateCard(resource, options)).rejects.toThrow("invalid_template_preview");
    payload = { ...payload, manifest, coverDataUrl: "data:text/html;base64,PHNjcmlwdD4=" };
    await expect(readRemoteTemplateCard(resource, options)).rejects.toThrow("invalid_template_preview");
    payload = { ...payload, manifest: { ...manifest, version: "2.0.0" } };
    await expect(readRemoteTemplateCard(resource, options)).rejects.toThrow("invalid_template_preview");
    expect(requested.every((url) => !url.includes("/download"))).toBe(true);
  });
  test("retains both resource manager roles when saving and restoring a bound enterprise account", () => {
    for (const role of ["template_admin", "extension_admin", "skill_admin"] as const) {
      saveEnterpriseConnection({ ...connectedEnterprise, membership: { ...connectedEnterprise.membership, role } });
      expect(readEnterpriseConnections()[0]?.membership.role).toBe(role);
    }
  });

  test("enterprise features require the matching active enterprise context, not a saved connection", async () => {
    saveEnterpriseConnection(connectedEnterprise);
    expect(readActiveEnterpriseConnection()).toBeNull();
    await activateEnterpriseWorkContext(connectedEnterprise);
    expect(readActiveEnterpriseConnection()?.membership.id).toBe(connectedEnterprise.membership.id);
    await activatePersonalWorkContext();
    expect(readActiveEnterpriseConnection()).toBeNull();
    expect(readEnterpriseConnections()).toHaveLength(1);
  });

  test.each(["invited", "suspended", "left"] as const)("%s enterprise members have no active enterprise features", async (status) => {
    const inactive = { ...connectedEnterprise, membership: { ...connectedEnterprise.membership, status } };
    saveEnterpriseConnection(inactive);
    window.localStorage.setItem("ipollowork.work-context.v1", `enterprise:${inactive.id}`);
    expect(readActiveEnterpriseConnection()).toBeNull();
    await expect(activateEnterpriseWorkContext(inactive)).rejects.toThrow("enterprise_signin_required");
  });

  test.each(["2020-01-01T00:00:00.000Z", "invalid-date"])("expired or malformed enterprise sessions hide all enterprise features (%s)", async (expiresAt) => {
    const expired = { ...connectedEnterprise, session: { ...connectedEnterprise.session, expiresAt } };
    saveEnterpriseConnection(expired);
    window.localStorage.setItem("ipollowork.work-context.v1", `enterprise:${expired.id}`);
    expect(readActiveEnterpriseConnection()).toBeNull();
    await expect(activateEnterpriseWorkContext(expired)).rejects.toThrow("enterprise_signin_required");
  });

  test("signing out hides enterprise credentials and restores bindings only for the same account", async () => {
    saveEnterpriseConnection({ ...connectedEnterprise, id: "ent_another" });
    saveEnterpriseConnection(connectedEnterprise);
    await activateEnterpriseWorkContext(connectedEnterprise);
    clearEnterpriseLoginState();
    expect(readEnterpriseConnections()).toEqual([]);
    expect(readActiveEnterpriseConnection()).toBeNull();
    expect(readActiveWorkContextId()).toBe("personal");
    window.localStorage.setItem("ipollowork.den.authToken", "account-b-session");
    setEnterpriseConnectionAccount({ userId: "account-b", baseUrl: "http://i.ipollo.ai", token: "account-b-session" });
    expect(readEnterpriseConnections()).toEqual([]);
    await expect(activateEnterpriseWorkContext(connectedEnterprise)).rejects.toThrow("enterprise_signin_required");
    const other = { ...connectedEnterprise, membership: { id: "member-b", role: "admin" as const }, session: { ...connectedEnterprise.session, token: "enterprise-b" } };
    saveEnterpriseConnection(other);
    clearEnterpriseLoginState();
    window.localStorage.setItem("ipollowork.den.authToken", "new-account-a-session");
    setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: "http://i.ipollo.ai", token: "new-account-a-session" });
    expect(readEnterpriseConnections().map((item) => item.id)).toEqual(["ent_medical", "ent_another"]);
    expect(readEnterpriseConnections()[0].membership.id).toBe("member-1");
    expect(readActiveWorkContextId()).toBe("personal");
    window.localStorage.setItem("ipollowork.den.authToken", "account-b-session");
    expect(readEnterpriseConnections()).toEqual([]);
    setEnterpriseConnectionAccount({ userId: "account-b", baseUrl: "http://i.ipollo.ai", token: "account-b-session" });
    expect(readEnterpriseConnections()).toEqual([other]);
  });

  test("an explicit unbind persists across logout and returning to the account", () => {
    saveEnterpriseConnection(connectedEnterprise);
    removeEnterpriseConnection(connectedEnterprise.id);
    clearEnterpriseLoginState();
    setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: "http://i.ipollo.ai", token: "cloud-session" });
    expect(readEnterpriseConnections()).toEqual([]);
  });

  test("isolates the same user ID on different login services and ignores stale verification", () => {
    saveEnterpriseConnection(connectedEnterprise);
    window.localStorage.setItem("ipollowork.den.baseUrl", "https://another-account.example");
    expect(readEnterpriseConnections()).toEqual([]);
    setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: "http://i.ipollo.ai", token: "cloud-session" });
    expect(readEnterpriseConnections()).toEqual([]);
    setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: "https://another-account.example", token: "cloud-session" });
    expect(readEnterpriseConnections()).toEqual([]);
    window.localStorage.setItem("ipollowork.den.baseUrl", "http://i.ipollo.ai");
    setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: "http://i.ipollo.ai", token: "cloud-session" });
    expect(readEnterpriseConnections()).toEqual([connectedEnterprise]);
  });

  test("migrates the legacy device bindings once after verifying the account", () => {
    clearEnterpriseLoginState();
    window.localStorage.setItem("ipollowork.enterprise-connections.v1", JSON.stringify([connectedEnterprise]));
    expect(readEnterpriseConnections()).toEqual([]);
    setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: "http://i.ipollo.ai", token: "cloud-session" });
    expect(readEnterpriseConnections()).toEqual([connectedEnterprise]);
    expect(window.localStorage.getItem("ipollowork.enterprise-connections.v1")).toBeNull();
    setEnterpriseConnectionAccount({ userId: "account-b", baseUrl: "http://i.ipollo.ai", token: "cloud-session" });
    expect(readEnterpriseConnections()).toEqual([]);
  });

  test("a refresh started by the previous account cannot overwrite the next account's binding", async () => {
    saveEnterpriseConnection(connectedEnterprise);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = refreshEnterpriseConnection(connectedEnterprise, async (input) => {
      if (String(input).includes(".well-known")) {
        await gate;
        return Response.json({ serverId: connectedEnterprise.id, name: "Updated", origin: connectedEnterprise.origin, authMode: connectedEnterprise.authMode });
      }
      return Response.json({ enterprise: { ...connectedEnterprise, name: "Updated" } });
    });
    window.localStorage.setItem("ipollowork.den.authToken", "account-b-session");
    setEnterpriseConnectionAccount({ userId: "account-b", baseUrl: "http://i.ipollo.ai", token: "account-b-session" });
    const other = { ...connectedEnterprise, membership: { id: "member-b", role: "member" as const } };
    saveEnterpriseConnection(other);
    release();
    await pending;
    expect(readEnterpriseConnections()).toEqual([other]);
    window.localStorage.setItem("ipollowork.den.authToken", "cloud-session");
    setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: "http://i.ipollo.ai", token: "cloud-session" });
    expect(readEnterpriseConnections()).toEqual([connectedEnterprise]);
  });

  test("verifies discovery and manifest identity before saving a server", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/.well-known/ipollo-enterprise")) {
        return Response.json({
          serverId: "ent_medical",
          name: "Medical Studio",
          origin: "https://enterprise.example.com",
          authMode: "bootstrap",
        });
      }
      return Response.json({
        enterprise: {
          id: "ent_medical",
          name: "Medical Studio",
          shortName: "Medical",
          logoUrl: null,
          accent: "blue",
        },
      });
    };

    await expect(
      discoverEnterpriseConnection("https://enterprise.example.com/", fetcher),
    ).resolves.toEqual({
      id: "ent_medical",
      name: "Medical Studio",
      shortName: "Medical",
      origin: "https://enterprise.example.com",
      logoUrl: null,
      accent: "blue",
      authMode: "bootstrap",
    });
    expect(requested).toEqual([
      "https://enterprise.example.com/.well-known/ipollo-enterprise",
      "https://enterprise.example.com/api/v1/client-manifest",
    ]);
  });

  test("rejects a manifest issued for another enterprise", async () => {
    const fetcher: typeof fetch = async (input) => {
      if (String(input).endsWith("/.well-known/ipollo-enterprise")) {
        return Response.json({
          serverId: "ent_expected",
          name: "Expected Enterprise",
          origin: "https://enterprise.example.com",
          authMode: "bootstrap",
        });
      }
      return Response.json({
        enterprise: {
          id: "ent_other",
          name: "Other Enterprise",
          shortName: "Other",
          logoUrl: null,
          accent: "neutral",
        },
      });
    };

    await expect(
      discoverEnterpriseConnection("https://enterprise.example.com", fetcher),
    ).rejects.toThrow("enterprise_manifest_mismatch");
  });

  test("refreshes stored Enterprise branding without replacing its membership or session", async () => {
    saveEnterpriseConnection(connectedEnterprise);
    const refreshed = await refreshEnterpriseConnection(connectedEnterprise, async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/ipollo-enterprise")) {
        return Response.json({
          serverId: "ent_medical",
          name: "Medical Enterprise",
          origin: "https://enterprise.example.com",
          authMode: "ipollo_oidc",
        });
      }
      return Response.json({
        enterprise: {
          id: "ent_medical",
          name: "Updated Medical Enterprise",
          shortName: "Updated Medical",
          logoUrl: "https://enterprise.example.com/api/v1/branding/logo?revision=7",
          accent: "neutral",
        },
      });
    });

    expect(refreshed).toMatchObject({
      name: "Updated Medical Enterprise",
      shortName: "Updated Medical",
      logoUrl: "https://enterprise.example.com/api/v1/branding/logo?revision=7",
      accent: "neutral",
      membership: connectedEnterprise.membership,
      session: connectedEnterprise.session,
    });
    expect(readEnterpriseConnections()[0]).toEqual(refreshed);
  });

  test("refreshes role and member status, then clears capabilities when the service is downgraded", async () => {
    const connected = { ...connectedEnterprise, session: { token: "synthetic-session", expiresAt: "2099-01-01T00:00:00.000Z" }, membership: { id: "member-1", role: "owner", status: "active" }, features: enterpriseFeaturesSchema.parse({ sessionSharing: true }) } satisfies EnterpriseConnection;
    saveEnterpriseConnection(connected);
    let upgraded = true;
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/ipollo-enterprise")) return Response.json({ serverId: connected.id, name: connected.name, origin: connected.origin, authMode: connected.authMode });
      if (url.endsWith("/membership")) return Response.json({ membership: { id: connected.membership.id, role: "member", status: "suspended", displayName: "Employee", email: "employee@example.com", departmentId: "department-1" } });
      return Response.json({ enterprise: connected, ...(upgraded ? { features: { membership: true, sessionSharing: true } } : {}) });
    };
    const refreshed = await refreshEnterpriseConnection(connected, fetcher);
    expect(refreshed.membership).toEqual({ id: "member-1", role: "member", status: "suspended", departmentId: "department-1" });
    expect(readEnterpriseConnections()[0].membership.role).toBe("member");
    upgraded = false;
    const downgraded = await refreshEnterpriseConnection(refreshed, fetcher);
    expect(downgraded.features).toBeUndefined();
    expect(readEnterpriseConnections()[0].features).toBeUndefined();
  });

  test("resource management refreshes membership even when its separate capability flag is absent", async () => {
    const admin = { ...connectedEnterprise, membership: { ...connectedEnterprise.membership, role: "admin" } } satisfies EnterpriseConnection;
    saveEnterpriseConnection(admin);
    const refreshed = await refreshEnterpriseConnection(admin, async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/ipollo-enterprise")) return Response.json({ serverId: admin.id, name: admin.name, origin: admin.origin, authMode: admin.authMode });
      if (url.endsWith("/membership")) return Response.json({ membership: { ...admin.membership, role: "member", status: "active", displayName: "Employee", email: "employee@example.com" } });
      return Response.json({ enterprise: admin, features: { resourceManagement: true } });
    });
    expect(refreshed.membership.role).toBe("member");
    expect(readEnterpriseConnections()[0].membership.role).toBe("member");
  });

  test("a slow membership response cannot restore privileges already revoked by a newer refresh", async () => {
    const admin = { ...connectedEnterprise, membership: { ...connectedEnterprise.membership, role: "admin" } } satisfies EnterpriseConnection;
    saveEnterpriseConnection(admin);
    let finish: (response: Response) => void = () => {};
    const pending = refreshEnterpriseMembership(admin, () => new Promise<Response>((resolve) => { finish = resolve; }));
    saveEnterpriseConnection({ ...admin, membership: { ...admin.membership, role: "member" } });
    finish(Response.json({ membership: { ...admin.membership, status: "active", displayName: "Employee", email: "employee@example.com" } }));
    expect((await pending).membership.role).toBe("member");
    expect(readEnterpriseConnections()[0].membership.role).toBe("member");
  });

  test("membership verification rejects account switches and cannot save permissions for the next login", async () => {
    saveEnterpriseConnection(connectedEnterprise);
    let finish: (response: Response) => void = () => {};
    const pending = refreshEnterpriseMembership(connectedEnterprise, () => new Promise<Response>((resolve) => { finish = resolve; }));
    setEnterpriseConnectionAccount({ userId: "account-b", baseUrl: "http://i.ipollo.ai", token: "cloud-session" });
    finish(Response.json({ membership: { ...connectedEnterprise.membership, role: "admin", status: "active", displayName: "Employee", email: "employee@example.com" } }));
    await expect(pending).rejects.toThrow("enterprise_account_changed");
    expect(readEnterpriseConnections()).toEqual([]);
  });

  test("joins the configured Enterprise with a Cloud-issued identity token", async () => {
    window.localStorage.setItem("ipollowork.den.baseUrl", "https://account.ipollo.ai");
    setEnterpriseConnectionAccount({ userId: "account-a", baseUrl: "https://account.ipollo.ai", token: "cloud-session" });
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requested.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/.well-known/ipollo-enterprise")) {
        return Response.json({
          serverId: "ent_medical",
          name: "Medical Studio",
          origin: "https://enterprise.example.com",
          authMode: "ipollo_oidc",
        });
      }
      if (url.endsWith("/api/v1/client-manifest")) {
        return Response.json({
          enterprise: {
            id: "ent_medical",
            name: "Medical Studio",
            shortName: "Medical",
            logoUrl: null,
            accent: "blue",
          },
        });
      }
      if (url.endsWith("/api/auth/token")) return Response.json({ token: "identity-token" });
      return Response.json({
        enterprise: {
          id: "ent_medical",
          name: "Medical Studio",
          shortName: "Medical",
          logoUrl: null,
          accent: "blue",
        },
        membership: { id: "member-1", role: "member", status: "active" },
        session: { token: "enterprise-session", expiresAt: "2026-08-26T00:00:00.000Z" },
      });
    };

    await expect(joinEnterpriseWithCode({
      joinCode: "ABCDE-23456",
      cloudBaseUrl: "https://account.ipollo.ai",
      cloudToken: "cloud-session",
      enterpriseBaseUrl: "https://enterprise.example.com",
    }, fetcher)).resolves.toMatchObject({
      id: "ent_medical",
      membership: { id: "member-1", role: "member" },
      session: { token: "enterprise-session" },
    });
    expect(requested).toEqual([
      "GET https://enterprise.example.com/.well-known/ipollo-enterprise",
      "GET https://enterprise.example.com/api/v1/client-manifest",
      "GET https://account.ipollo.ai/api/auth/token",
      "POST https://enterprise.example.com/api/v1/join",
    ]);
  });

  test("rejects an invalid Enterprise address before making a request", async () => {
    let requestCount = 0;
    const fetcher: typeof fetch = async () => {
      requestCount += 1;
      return Response.json({});
    };

    await expect(joinEnterpriseWithCode({
      joinCode: "ABCDE-23456",
      cloudBaseUrl: "http://i.ipollo.ai",
      cloudToken: "cloud-session",
      enterpriseBaseUrl: "ftp://enterprise.example.com",
    }, fetcher)).rejects.toThrow("invalid_enterprise_url");
    expect(requestCount).toBe(0);
  });

  test("keeps connections to multiple Enterprise servers", () => {
    saveEnterpriseConnection(connectedEnterprise);
    saveEnterpriseConnection({
      ...connectedEnterprise,
      id: "ent_retail",
      name: "Retail Studio",
      shortName: "Retail",
      origin: "https://retail.example.com",
      membership: { id: "member-2", role: "member" },
      session: { token: "retail-session", expiresAt: "2026-08-27T00:00:00.000Z" },
    });

    expect(readEnterpriseConnections().map((connection) => connection.id)).toEqual([
      "ent_retail",
      "ent_medical",
    ]);

    removeEnterpriseConnection("ent_retail");
    expect(readEnterpriseConnections().map((connection) => connection.id)).toEqual(["ent_medical"]);
  });

  test("keeps the Cloud resource catalog compatible with its existing contract", async () => {
    const digest = "a".repeat(64);
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requested.push(String(input));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-session");
      return Response.json({ resources: [{
        id: "resource-1",
        type: "template",
        slug: "medical-report",
        name: "Medical report",
        description: "Approved report format",
        category: "report",
        enterpriseCategory: "Clinical",
        iconUrl: "/api/v1/enterprise-resources/resource-1/icon",
        featured: true,
        status: "published",
        updatedAt: "2026-07-28T00:00:00.000Z",
        latestArtifact: {
          version: "1.2.0",
          manifestId: "personal.medical-report",
          sha256: digest,
          downloadPath: "/api/v1/enterprise-resources/resource-1/versions/1.2.0/download",
        },
      }, {
        id: "resource-2",
        type: "template",
        slug: "medical-slides",
        name: "Medical slides",
        description: "Approved presentation",
        category: "slides",
        enterpriseCategory: "Clinical",
        iconUrl: null,
        featured: false,
        updatedAt: "2026-07-29T00:00:00.000Z",
        latestArtifact: null,
      }, { id: "wrong-type", type: "extension" }] });
    };

    await expect(listEnterpriseResources("template", { fetcher })).resolves.toMatchObject([
      { id: "resource-1", type: "template", manifestId: "personal.medical-report", latestVersion: { version: "1.2.0" } },
      { id: "resource-2", type: "template", latestVersion: null },
    ]);
    expect(requested).toEqual([
      "http://i.ipollo.ai/api/v1/enterprise-resources?type=template&limit=50",
    ]);
  });

  test("loads resources from the active Enterprise Server with its member session", async () => {
    const digest = "b".repeat(64);
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requested.push(url);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer enterprise-session");
      if (!url.includes("cursor=")) {
        return Response.json({
          items: [{
            id: "enterprise-template",
            type: "template",
            slug: "brand-deck",
            name: "Brand deck",
            description: "Approved enterprise deck",
            category: "slides",
            enterpriseCategory: "Brand",
            access: "all",
            featured: true,
            status: "published",
            sourceTemplateId: "enterprise.brand-deck",
            ownerMemberId: null,
            updatedAt: "2026-08-31T00:00:00.000Z",
            iconPath: "/api/v1/resources/enterprise-template/icon",
            latestVersion: {
              version: "1.0.0",
              digest,
              downloadPath: "/api/v1/resources/enterprise-template/versions/1.0.0/download",
            },
          }],
          nextCursor: "page-2",
        });
      }
      return Response.json({
        items: [{
          id: "enterprise-template-2",
          type: "template",
          slug: "brand-site",
          name: "Brand site",
          description: "Approved enterprise site",
          category: "site",
          enterpriseCategory: "Brand",
          access: "all",
          featured: false,
          status: "published",
          sourceTemplateId: null,
          ownerMemberId: null,
          updatedAt: "2026-08-31T01:00:00.000Z",
          iconPath: null,
          latestVersion: null,
        }, { id: "draft-template", type: "template", status: "draft" }],
        nextCursor: null,
      });
    };

    await expect(listEnterpriseResources("template", {
      connection: connectedEnterprise,
      fetcher,
    })).resolves.toMatchObject([
      {
        id: "enterprise-template",
        name: "Brand deck",
        manifestId: "enterprise.brand-deck",
        iconPath: "/api/v1/resources/enterprise-template/icon",
        latestVersion: { version: "1.0.0", digest },
      },
      { id: "enterprise-template-2", name: "Brand site", latestVersion: null },
    ]);
    expect(requested).toEqual([
      "https://enterprise.example.com/api/v1/resources?type=template&limit=50",
      "https://enterprise.example.com/api/v1/resources?type=template&limit=50&cursor=page-2",
    ]);
  });

  test("downloads an explicitly selected Enterprise resource with the Cloud session", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const digest = await sha256Hex(bytes);
    const resource = (await listEnterpriseResources("extension", { fetcher: async () => Response.json({ resources: [{
      id: "resource-2",
      type: "extension",
      slug: "github-tools",
      name: "GitHub tools",
      description: "Enterprise GitHub package",
      category: "developer",
      enterpriseCategory: "Engineering",
      featured: false,
      updatedAt: "2026-07-28T00:00:00.000Z",
      latestArtifact: {
        version: "2.0.0",
        manifestId: "github-tools",
        sha256: digest,
        downloadPath: "/api/v1/enterprise-resources/resource-2/versions/2.0.0/download",
      },
    }] }) }))[0];
    if (!resource) throw new Error("Expected an Enterprise extension resource");
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toContain("/api/v1/enterprise-resources/resource-2/versions/2.0.0/download");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-session");
      return artifactResponse(bytes, "extension", digest, "application/zip");
    };
    const file = await downloadEnterpriseResource(resource, { fetcher });
    expect(file.name).toBe("github-tools-2.0.0.ipollowork-plugin");
    expect(file.size).toBe(3);
  });

  test("downloads an Enterprise Server resource with its member session", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const digest = await sha256Hex(bytes);
    const resource: EnterpriseResource = {
      id: "enterprise-template",
      type: "template",
      slug: "brand-deck",
      manifestId: "enterprise.brand-deck",
      name: "Brand deck",
      description: "Approved enterprise deck",
      category: "slides",
      enterpriseCategory: "Brand",
      iconPath: null,
      featured: true,
      updatedAt: "2026-08-31T00:00:00.000Z",
      latestVersion: {
        version: "1.0.0",
        digest,
        downloadPath: "/api/v1/resources/enterprise-template/versions/1.0.0/download",
      },
    };
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe(
        "https://enterprise.example.com/api/v1/resources/enterprise-template/versions/1.0.0/download",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer enterprise-session");
      return artifactResponse(
        bytes,
        "template",
        digest,
        IPOLLOWORK_PACKAGE_MEDIA_TYPE,
        "x-ipollo-artifact-sha256",
        "x-ipollo-resource-type",
      );
    };

    const file = await downloadEnterpriseResource(resource, {
      connection: connectedEnterprise,
      fetcher,
    });
    expect(file.name).toBe("brand-deck-1.0.0.ipwp");
  });

  test("keeps legacy Enterprise templates importable and names canonical packages .ipwp", async () => {
    const bytes = new Uint8Array([1]);
    const digest = await sha256Hex(bytes);
    const resource: EnterpriseResource = {
      id: "resource-template",
      type: "template",
      slug: "clinical-report",
      manifestId: "personal.clinical-report",
      name: "Clinical report",
      description: "Approved report format",
      category: "report",
      enterpriseCategory: "Clinical",
      iconPath: null,
      featured: true,
      updatedAt: "2026-07-28T00:00:00.000Z",
      latestVersion: {
        version: "1.2.0",
        digest,
        downloadPath: "/api/v1/enterprise-resources/resource-template/versions/1.2.0/download",
      },
    };
    const legacy = await downloadEnterpriseResource(resource, { fetcher: async () => (
      artifactResponse(bytes, "template", digest, "application/octet-stream")
    ) });
    const canonical = await downloadEnterpriseResource(resource, { fetcher: async () => (
      artifactResponse(bytes, "template", digest, IPOLLOWORK_PACKAGE_MEDIA_TYPE)
    ) });

    expect(legacy.name).toBe("clinical-report-1.2.0.ipwt");
    expect(canonical.name).toBe("clinical-report-1.2.0.ipwp");
  });

  test("rejects Enterprise artifacts whose digest or resource type does not match the catalog", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const digest = await sha256Hex(bytes);
    const resource: EnterpriseResource = {
      id: "resource-extension",
      type: "extension",
      slug: "approved-tools",
      manifestId: "approved-tools",
      name: "Approved tools",
      description: "Approved extension",
      category: "developer",
      enterpriseCategory: "Engineering",
      iconPath: null,
      featured: false,
      updatedAt: "2026-07-28T00:00:00.000Z",
      latestVersion: {
        version: "1.0.0",
        digest,
        downloadPath: "/api/v1/enterprise-resources/resource-extension/versions/1.0.0/download",
      },
    };
    await expect(downloadEnterpriseResource(resource, { fetcher: async () => (
      artifactResponse(bytes, "template", digest, "application/zip")
    ) })).rejects.toThrow("enterprise_resource_type_mismatch");
    await expect(downloadEnterpriseResource(resource, { fetcher: async () => (
      artifactResponse(bytes, "extension", "b".repeat(64), "application/zip")
    ) })).rejects.toThrow("enterprise_resource_digest_mismatch");
  });
});

describe("cloud plugin lifecycle", () => {
  function resource(version: string, manifestId = "sample-plugin"): EnterpriseResource {
    return { id: "cloud-" + version, type: "extension", slug: "display-slug", manifestId, name: "Sample",
      description: "", category: "", enterpriseCategory: "", iconPath: null, featured: false, updatedAt: "",
      latestVersion: { version, digest: "a".repeat(64), downloadPath: "/api/v1/enterprise-resources/sample/download" } };
  }
  test.each([
    ["1.10.0", "1.9.0", 1], ["1.0.0", "1.0.0-rc.2", 1],
    ["1.0.0-rc.10", "1.0.0-rc.2", 1], ["1.0.0+build.2", "1.0.0+build.1", 0],
    ["0.3.1", "0.4.19", -1], ["2.0.0-beta.1", "2.0.0", -1],
  ])("compares %s against %s by semantic precedence", (left, right, direction) => {
    expect(Math.sign(comparePluginPackageVersions(left, right) ?? NaN)).toBe(direction);
  });
  test("selects the newest matching manifest ID and ignores older or invalid metadata", () => {
    const current = { pluginId: "sample-plugin", version: "1.2.0" };
    const newest = resource("1.10.0");
    expect(cloudPluginUpdate([resource("1.1.0"), resource("9.0.0", "another-plugin"), resource("invalid"), resource("1.3.0"), newest], current)).toBe(newest);
    expect(cloudPluginUpdate([resource("0.3.1")], { pluginId: "sample-plugin", version: "0.4.19" })).toBeUndefined();
    expect(cloudPluginUpdate([resource("1.2.0+build.9")], current)).toBeUndefined();
  });
  test("rejects a downloaded package for another plugin or version", () => {
    const selected = resource("1.2.0");
    expect(() => assertCloudPluginIdentity(selected, { id: "another-plugin", package: { version: "1.2.0" } })).toThrow("identity_mismatch");
    expect(() => assertCloudPluginIdentity(selected, { id: "sample-plugin", package: { version: "1.1.0" } })).toThrow("identity_mismatch");
    expect(() => assertCloudPluginIdentity(selected, { id: "sample-plugin", package: { version: "1.2.0" } })).not.toThrow();
  });
  test("rechecks the installed version before downloading so a stale Update cannot downgrade", async () => {
    let downloaded = false;
    const result = await installCloudPluginResource(resource("1.0.0"), {
      listPluginPackages: async () => ({ items: [{
        pluginId: "sample-plugin", name: "Sample", version: "1.2.0", enabled: true, disabledResourceIds: [], previousVersion: null, integrity: { status: "unsigned", sha256: "a".repeat(64) },
        manifest: { schemaVersion: 2, id: "sample-plugin", name: "Sample", description: "",
          source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false }, resources: [] },
      }] }),
      validatePluginPackageUpload: async () => { throw new Error("Validation must not run"); },
      importPluginPackage: async () => { throw new Error("Installation must not run"); },
    }, "workspace", { fetcher: async () => { downloaded = true; throw new Error("Download must not run"); } });
    expect(result).toBeNull();
    expect(downloaded).toBe(false);
  });
});
