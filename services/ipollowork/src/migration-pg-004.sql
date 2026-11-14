ALTER TABLE service_calls ADD COLUMN billing_snapshot TEXT;
ALTER TABLE service_calls ADD COLUMN cost_micros BIGINT;
ALTER TABLE service_calls ADD COLUMN billing_settled BOOLEAN NOT NULL DEFAULT false;
