---
name: acme-research
description: Search and summarize material from the Acme research service.
---

# Acme research

Use the Acme research service supplied by this plugin when the user asks to search its private research library.

1. Call `ipollowork_extension_call` with `extensionId: "acme-research"`, `action: "search"`, and `args: { "query": "..." }`.
2. Cite each returned document title and source URL.
3. If the platform reports `plugin_authorization_required`, ask the user to connect Acme Research in Settings → Extensions. Never ask the user to paste a key into chat.
4. Never expose, echo, or summarize authorization values.
