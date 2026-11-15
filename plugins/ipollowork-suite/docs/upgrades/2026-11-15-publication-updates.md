# Stable Design publication URLs

Deploy the account service with schema 8 before using the updated suite publication lookup. Back up PostgreSQL and the authentication secret before migration. The migration adds nullable publication identity and revision links, plus a unique owner/site index; existing publication IDs and URLs remain valid.

Design identifies a site by native workspace and entry path. New revisions upload privately and replace the live revision only after every file is ready. Incomplete or superseded revisions leave the published page unchanged. A unique legacy publication for the same owner, project and entry is adopted on first update. Multiple matching legacy publications fail with `PUBLICATION_AMBIGUOUS` rather than updating an arbitrary page.

The optional Host `publicationInfo(workspaceId, entry)` reports the existing URL to the Design toolbar. This is product plugin and account-service code; DSH remains unchanged.
