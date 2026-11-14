ALTER TABLE plans ADD COLUMN daily_points BIGINT CHECK(daily_points>0);
ALTER TABLE plans ADD COLUMN weekly_points BIGINT CHECK(weekly_points>0);
ALTER TABLE plans ADD CONSTRAINT plan_usage_limits CHECK(daily_points IS NULL OR weekly_points IS NULL OR daily_points<=weekly_points);
CREATE INDEX service_calls_user_created ON service_calls(user_id,created_at);
ALTER TABLE orders ADD COLUMN checkout TEXT;
CREATE INDEX orders_wechat_merchant ON orders((replace(id,'-',''))) WHERE provider='wechat';
