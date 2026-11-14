---
kind: upgrade-guide
description: "iPolloWork sharing moves into the native dialog and upgrades its account database to schema seven."
---

# iPolloWork native sharing

English | [中文](guide.zh.md)

## Change

iPolloWork recipient selection now lives inside DSH's native Share dialog. The separate suite sharing dialog is removed. The account service stores per-share link, team, department, or member access instead of requiring a project for every new share. Existing shares retain their project permissions. Public links admit anonymous viewers, and are listed only to their owner.

## Migration

1. Back up the account service with `npm run backup` in `services/ipollowork`. Its next startup migrates the database to schema seven; older service binaries cannot open that database.
2. Update the account service, `@ipollo/dsh-suite`, and `@deepseek-ai/dsh-experimental-liveshare` together from this checkout. The native plugin supplies the optional `liveshare.share.audience` slot. No profile keys or Session files change.
3. Open a conversation's native Share action. Confirm that its recipient selector offers link, team, departments, and members, alongside the native session permissions and fork controls. Team recipients must sign in; a link can be opened without signing in. Removing the suite removes its selector and leaves native sharing available.
