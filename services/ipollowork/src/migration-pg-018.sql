ALTER TABLE organization_publications DROP CONSTRAINT organization_publications_kind_check;
ALTER TABLE organization_publications ADD CONSTRAINT organization_publications_kind_check
  CHECK (kind IN ('plugin','template','skill','mcp'));
