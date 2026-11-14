---
kind: upgrade-guide
description: iPolloWork account services require PostgreSQL and apply owner-scoped output retention.
---

# iPolloWork PostgreSQL and output storage

English | [中文](guide.zh.md)

## Change

The optional iPolloWork account service uses PostgreSQL instead of its SQLite runtime. `DATABASE_URL` is required. The DSH suite stores native presented outputs for linked projects. Inputs are not automatically uploaded. Personal unpublished outputs expire after seven days; published and organization outputs remain retained. These rules do not delete local workspace files. Existing imported cloud files retain their previous lifetime.

## Migration

1. Stop the old account service and back up its database, private files and authentication secret.
2. Create an empty PostgreSQL database and set `DATABASE_URL` while preserving `DATA_DIR`, the secret and service hostname. Run `npm run import:sqlite -- /absolute/path/work.sqlite` from `services/ipollowork`; the original SQLite file stays untouched. See [storage deployment](../../../../services/ipollowork/docs/storage.md).
3. Configure private OSS for a public deployment. Review owner quotas and retention settings in `.env.example`; set individual limits in the administration UI.
4. Build and restart the service, then install the updated suite through the native plugin manager and restart the profile. Verify `/api/health`, existing account access and a linked project output download. Disable output archiving in the project's Files settings if required.

No native DSH Session format or default agent preset changes. Disabling the suite removes its archive and project-memory extensions.
