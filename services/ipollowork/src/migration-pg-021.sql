ALTER TABLE organization_publication_versions ADD COLUMN title TEXT;
ALTER TABLE organization_publication_versions ADD COLUMN description TEXT;
UPDATE organization_publication_versions v
SET title=p.title,description=p.description
FROM organization_publications p WHERE p.id=v.publication_id;
ALTER TABLE organization_publication_versions ALTER COLUMN title SET NOT NULL;
ALTER TABLE organization_publication_versions ALTER COLUMN description SET NOT NULL;
CREATE INDEX members_roster ON members(enterprise_id,created_at,user_id);
