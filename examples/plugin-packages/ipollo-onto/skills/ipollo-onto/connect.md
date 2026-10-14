# Connect iPollo Onto

1. Install the complete Onto 0.1.5+ cloud package in iPolloWork. Opening its workspace app automatically starts the bundled service and creates its own local SQLite database; no PostgreSQL setup or package manager is needed. Keep existing PostgreSQL data intact; this package does not automatically move it into SQLite.
2. In iPolloWork, open **right pane + → iPollo Onto**. The workbench finds the local production UI on 5711 or development UI on 5710 automatically. Create or choose your project in that pane. The standalone browser interface remains available too.
3. Open **Project settings → API / MCP**, or a table's **… → API / MCP** for a narrower scope. Copy its actual MCP URL.
4. In iPolloWork's native MCP settings, add that URL as a remote HTTP MCP connection, enabled, with OAuth off for this loopback preview. Do not replace the project UUID with a guessed value. The settings format is:

```json
{
  "type": "remote",
  "url": "http://127.0.0.1:5711/api/projects/YOUR_PROJECT_UUID/mcp",
  "enabled": true,
  "oauth": false
}
```

5. Check the host reports connected, discover tools, then request a read of `data_context`. Discover `onto_status` / `onto_bind` in the active Workspace App and bind the intended project to this conversation. Pass the returned `workbench` only to operation schemas that support it. The user's chosen iPolloWork model performs AI work; Onto has no separate model configuration.

This plugin includes the full application, a signed Workspace App and workflow Skill. The host starts and stops its bundled service. SQLite data and document files live outside the versioned package and survive updates. Project MCP registration remains explicit. The trusted-local preview has no multi-user authentication; a scoped URL is not an access token. Optional independent PostgreSQL project connections require an available database.
