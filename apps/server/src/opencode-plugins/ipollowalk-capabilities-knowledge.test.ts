import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { iPolloWalkCapabilitiesKnowledge } from "./ipollowalk-capabilities-knowledge.js";

describe("iPolloWalk capabilities knowledge plugin", () => {
  test("retrieves Slack connection guidance from bundled docs", async () => {
    process.env.IPOLLOWALK_DOCS_DIR = resolve(import.meta.dir, "../../../../packages/docs");

    const plugin = await iPolloWalkCapabilitiesKnowledge();
    const search = await plugin.tool.ipollowalk_docs_search.execute({ query: "how can i connect slack", limit: 3 });

    expect(search).toContain("start-here/connect-your-stack/connect-slack-mcp.mdx");
    expect(search).toContain("Connect Slack MCP");

    const read = await plugin.tool.ipollowalk_docs_read.execute({
      path: "start-here/connect-your-stack/connect-slack-mcp.mdx",
    });

    expect(read).toContain("https://mcp.slack.com/mcp");
    expect(read).toContain("Advanced OAuth");
    expect(read).toContain("http://127.0.0.1:19876/mcp/oauth/callback");
    expect(read).toContain("search:read.public");
  });
});
