import { describe, expect, test } from "bun:test";

import {
  discoverEnterpriseConnection,
  normalizeEnterpriseOrigin,
} from "../src/app/lib/enterprise-connections";

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
});
