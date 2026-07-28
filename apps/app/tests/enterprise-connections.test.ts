import { describe, expect, test } from "bun:test";

import {
  discoverEnterpriseConnection,
  downloadEnterpriseResource,
  joinEnterpriseWithCode,
  listEnterpriseResources,
  normalizeEnterpriseOrigin,
  type EnterpriseConnection,
} from "../src/app/lib/enterprise-connections";

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

describe("enterprise connections", () => {
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

  test("resolves a join code through Cloud and exchanges it for an Enterprise session", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requested.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/v1/enterprise-directory/resolve")) {
        return Response.json({
          enterprise: {
            serverId: "ent_medical",
            name: "Medical Studio",
            shortName: "Medical",
            origin: "https://enterprise.example.com",
            logoUrl: null,
            accent: "blue",
          },
        });
      }
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
    }, fetcher)).resolves.toMatchObject({
      id: "ent_medical",
      membership: { id: "member-1", role: "member" },
      session: { token: "enterprise-session" },
    });
    expect(requested).toEqual([
      "POST https://account.ipollo.ai/api/v1/enterprise-directory/resolve",
      "GET https://enterprise.example.com/.well-known/ipollo-enterprise",
      "GET https://enterprise.example.com/api/v1/client-manifest",
      "GET https://account.ipollo.ai/api/auth/token",
      "POST https://enterprise.example.com/api/v1/join",
    ]);
  });

  test("loads only valid resources from the active Enterprise catalog", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://enterprise.example.com/api/v1/resources?type=template&limit=50");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer enterprise-session");
      return Response.json({ items: [{
        id: "resource-1",
        type: "template",
        slug: "medical-report",
        name: "Medical report",
        description: "Approved report format",
        category: "report",
        enterpriseCategory: "Clinical",
        iconPath: null,
        featured: true,
        updatedAt: "2026-07-28T00:00:00.000Z",
        latestVersion: {
          version: "1.2.0",
          digest: "sha256:abc",
          downloadPath: "/api/v1/resources/resource-1/versions/1.2.0/download",
        },
      }, { id: "wrong-type", type: "extension" }] });
    };

    await expect(listEnterpriseResources(connectedEnterprise, "template", fetcher)).resolves.toMatchObject([
      { id: "resource-1", type: "template", latestVersion: { version: "1.2.0" } },
    ]);
  });

  test("downloads an explicitly selected Enterprise resource with its session", async () => {
    const resource = (await listEnterpriseResources(connectedEnterprise, "extension", async () => Response.json({ items: [{
      id: "resource-2",
      type: "extension",
      slug: "github-tools",
      name: "GitHub tools",
      description: "Enterprise GitHub package",
      category: "developer",
      enterpriseCategory: "Engineering",
      featured: false,
      updatedAt: "2026-07-28T00:00:00.000Z",
      latestVersion: {
        version: "2.0.0",
        digest: "sha256:def",
        downloadPath: "/api/v1/resources/resource-2/versions/2.0.0/download",
      },
    }] })))[0];
    if (!resource) throw new Error("Expected an Enterprise extension resource");
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toContain("/api/v1/resources/resource-2/versions/2.0.0/download");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer enterprise-session");
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/zip" } });
    };
    const file = await downloadEnterpriseResource(connectedEnterprise, resource, fetcher);
    expect(file.name).toBe("github-tools-2.0.0.zip");
    expect(file.size).toBe(3);
  });
});
