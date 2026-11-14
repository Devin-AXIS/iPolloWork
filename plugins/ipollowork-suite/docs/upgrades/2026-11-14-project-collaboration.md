# Project collaboration

Deploy the account service with business schema version 3 before updating the suite client. The client uses the work and project-collaboration endpoints in addition to the existing share API. Back up the SQLite file before migration. Version 3 adds project_work and work_revisions and preserves existing identities, projects, shares, and financial records. An older account service must not open this database; restore its matching backup to roll back.

The suite adds Team collaboration inside Enterprise spaces. Continue work creates a separate native Session with the shared reference in its unsent draft. Publish result makes the edited text available to project members, and subsequent updates create versions with an expected-version check. Removing enterprise membership prevents further reads and writes. Revoking the original share prevents new handoffs from it; previously published project results keep project permissions.

A shared HTTPS account-service origin is required for links used on another computer. A localhost origin remains local. No model keys, MCP credentials, or native file trees are copied by a handoff.
