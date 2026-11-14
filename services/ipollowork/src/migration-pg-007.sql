-- Both released schema-six variants converge without replacing their migration history.
DROP INDEX IF EXISTS service_calls_one_running;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS daily_points BIGINT CHECK(daily_points>0);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS weekly_points BIGINT CHECK(weekly_points>0);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='plan_usage_limits' AND conrelid='plans'::regclass) THEN
    ALTER TABLE plans ADD CONSTRAINT plan_usage_limits CHECK(daily_points IS NULL OR weekly_points IS NULL OR daily_points<=weekly_points);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS service_calls_user_created ON service_calls(user_id,created_at);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout TEXT;
CREATE INDEX IF NOT EXISTS orders_wechat_merchant ON orders((replace(id,'-',''))) WHERE provider='wechat';
