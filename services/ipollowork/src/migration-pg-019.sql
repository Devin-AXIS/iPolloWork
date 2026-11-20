CREATE TABLE organization_conversation_shares (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  transcript JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX organization_conversation_shares_owner ON organization_conversation_shares(enterprise_id,owner_id,created_at DESC);
CREATE TABLE organization_conversation_recipients (
  share_id TEXT NOT NULL REFERENCES organization_conversation_shares(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY(share_id,user_id)
);
CREATE INDEX organization_conversation_recipients_user ON organization_conversation_recipients(user_id,share_id);

ALTER TABLE organization_member_notices DROP CONSTRAINT organization_member_notices_kind_check;
ALTER TABLE organization_member_notices ADD CONSTRAINT organization_member_notices_kind_check
  CHECK (kind IN ('role','department','removed','status','resource.approved','resource.rejected','resource.published','project.submitted','project.accepted','conversation.shared'));
ALTER TABLE organization_member_notices ADD COLUMN target_tab TEXT, ADD COLUMN target_id TEXT;
