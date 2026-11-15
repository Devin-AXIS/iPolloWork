---
kind: upgrade-guide
description: iPolloWork service schema nine cannot be opened by older service versions.
---
# iPolloWork enterprise analytics

English | [中文](guide.zh.md)

## Change

The independent iPolloWork account service migrates PostgreSQL business data to schema nine. Older service versions reject this schema. The Console includes enterprise service consumption and metadata-only activity from linked projects. Historical unattributed service calls are excluded.

## Migration

1. Back up PostgreSQL and the service authentication secret using the [service deployment instructions](../../../../services/ipollowork/docs/storage.md).
2. Deploy the updated account service before updating the iPolloWork suite. Service startup applies the migration transactionally; verify that `SELECT MAX(version) FROM service_schema` returns `9` in the configured schema.
3. Update the suite and restart its DSH profile. Enterprise administrators can open Console → Analytics. `enterpriseUsageReporting: false` disables project activity reporting in the suite's `cordis.patch.yml` configuration; service gateway consumption is still recorded.
4. Restore the database backup together with the older service if rollback is required. Do not run the older service against schema nine.
