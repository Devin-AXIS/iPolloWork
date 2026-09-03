import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  discoverEnterpriseConnection,
  downloadEnterpriseResource,
  joinEnterpriseWithCode,
  listEnterpriseResources,
  normalizeEnterpriseOrigin,
  readEnterpriseConnections,
  refreshEnterpriseConnection,
  removeEnterpriseConnection,
  saveEnterpriseConnection,
  type EnterpriseConnection,
  type EnterpriseResource,
} from "../src/app/lib/enterprise-connections";
import { IPOLLOWORK_PACKAGE_MEDIA_TYPE } from "@ipollowork/types/templates";

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
  session: { token: "enterprise-session", expiresAt: "2026-08-26T00:00:00.000Z" },
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
      value: { localStorage, dispatchEvent: () => true },
    });
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

  test("joins the configured Enterprise with a Cloud-issued identity token", async () => {
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
