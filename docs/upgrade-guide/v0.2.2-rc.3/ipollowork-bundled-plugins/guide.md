---
kind: upgrade-guide
description: iPolloWork Desktop uses its bundled application plugins instead of profile-local copies.
---

# iPolloWork bundled plugins

English | [中文](guide.zh.md)

## Change

iPolloWork Desktop now supplies the suite, Design, and Video versions included in its installation. Previously installed profile copies could override those versions. Startup backs up those copies and the original profile manifest under `.dsh-bundled-package-backups/upgrade-*`, then removes their dependency declarations. It preserves bundle selections, custom patches, documents, credentials, and unrelated plugins.

## Migration

1. Quit the old desktop application when its tasks finish, then open the updated application.
2. Keep the backup directories under `$DSH_HOME/profiles/desktop` until the update is verified. If startup reports a migration failure, resolve the reported filesystem problem and reopen the app.
3. Open enabled Design and Video pages and confirm they load. Use a matching older application and restore the saved package entries and manifest while the app is closed if rolling back is necessary.
