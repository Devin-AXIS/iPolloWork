-- An employee join code without an expiry still has the same single-use lifecycle.
ALTER TABLE invitations ALTER COLUMN expires_at DROP NOT NULL;
