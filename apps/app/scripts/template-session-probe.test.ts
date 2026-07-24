import { describe, expect, it } from "bun:test";
import type { TemplateSessionSnapshot } from "@ipollowork/types/templates";

import { loadTemplateSession } from "../src/react-app/domains/session/templates/template-session-probe";

const designSession: TemplateSessionSnapshot = {
  sessionId: "ses_deck",
  surface: "design",
  state: {
    schemaVersion: 1,
    template: { id: "ipollowork.deck", version: "1.0.0", sourceType: "bundled" },
    entry: "design/ses_deck/entry.html",
    briefPath: "design/ses_deck/brief.json",
    createdAt: 1,
  },
  manifest: { surface: "design" } as TemplateSessionSnapshot["manifest"],
};

describe("loadTemplateSession", () => {
  it("finds a Design template when the local session type cache says work", async () => {
    const calls: string[] = [];
    const client = {
      getTemplateSession: async (workspaceId: string, sessionId: string) => {
        calls.push(`${workspaceId}:${sessionId}`);
        return designSession;
      },
      adoptLegacyVideoSession: async () => {
        throw new Error("should not adopt a Design session");
      },
    };

    await expect(loadTemplateSession({
      client,
      workspaceId: "workspace_1",
      sessionId: "ses_deck",
      knownSessionType: "work",
    })).resolves.toEqual(designSession);
    expect(calls).toEqual(["workspace_1:ses_deck"]);
  });
});
