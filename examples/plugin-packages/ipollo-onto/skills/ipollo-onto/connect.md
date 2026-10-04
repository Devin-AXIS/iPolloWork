# Connect iPollo Onto

1. Reuse the user's existing standalone Onto checkout/deployment and database. Ensure its version matches this plugin (0.1.4); rebuild its UI and restart that service after an upgrade. If no deployment exists, use a matching source release from [iPollo Onto releases](https://github.com/Devin-AXIS/iPollo-Onto/releases) when available and follow its README. Do not silently fall back to an older release or initialize a replacement database to fix a connection.
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

This plugin includes a signed Workspace App and an AI workflow Skill. It shares the current project/table IDs with the host and exposes `onto_status` / `onto_navigate` for page navigation. Installing it does not start PostgreSQL, start the Onto process, or register a project HTTP MCP automatically. Keep the standalone service running on the same machine as the host; use this revision's standalone source with the workbench handshake, not an older frontend. The preview has no multi-user authentication; a scoped URL is not an access token. Uninstalling the plugin does not delete standalone business data.
