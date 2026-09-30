CREATE TABLE IF NOT EXISTS employees (
 user_id text PRIMARY KEY, username text NOT NULL, ic_name text NOT NULL, hired_by text, hired_by_name text, hired_at timestamptz,
 rank text, plus_count integer NOT NULL DEFAULT 0, minus_count integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'active', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS logs (
 id bigserial PRIMARY KEY, request_id text UNIQUE, category text NOT NULL,
 actor_id text NOT NULL, actor_name text NOT NULL, target_id text, target_name text,
 reason text NOT NULL DEFAULT '', details jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending',
 channel_id text, created_at timestamptz NOT NULL DEFAULT now(), delivered boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS logs_category_date ON logs(category, created_at DESC);
CREATE INDEX IF NOT EXISTS logs_target_date ON logs(target_id, created_at DESC);
CREATE TABLE IF NOT EXISTS leaves (
 id bigserial PRIMARY KEY, user_id text NOT NULL, ic_name text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 reason text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending',
 channel_id text NOT NULL, approved_by text, approved_by_name text,
 old_nick text, applied_nick text, error text, retry_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_leave ON leaves(user_id) WHERE status IN ('pending','scheduled','active','starting','ending');
CREATE TABLE IF NOT EXISTS notifications (
 id bigserial PRIMARY KEY, channel_id text NOT NULL, user_id text, title text NOT NULL,
 body text NOT NULL, delivered boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_reports (cutoff timestamptz PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reported_rewards (log_id bigint PRIMARY KEY REFERENCES logs(id), cutoff timestamptz NOT NULL REFERENCES reward_reports(cutoff));

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS role_id text;

CREATE TABLE IF NOT EXISTS course_reminders (day date PRIMARY KEY);

CREATE TABLE IF NOT EXISTS bot_panels(name text PRIMARY KEY,channel_id text NOT NULL,message_id text NOT NULL);

ALTER TABLE reward_reports ADD COLUMN IF NOT EXISTS settled_at timestamptz;
ALTER TABLE reward_reports ADD COLUMN IF NOT EXISTS settled_by text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reward_cutoff text;
