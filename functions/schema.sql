-- functions/schema.sql
-- Cloudflare D1 数据库模式定义：文章统计系统核心表与高性能索引

CREATE TABLE IF NOT EXISTS stats (
  id TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stats_updated_at ON stats(updated_at);

CREATE TABLE IF NOT EXISTS stats_views_log (
  post_id TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  viewed_at INTEGER NOT NULL, -- Unix 秒级时间戳
  PRIMARY KEY (post_id, client_hash)
);
CREATE INDEX IF NOT EXISTS idx_views_log_time ON stats_views_log(viewed_at);

CREATE TABLE IF NOT EXISTS stats_likes_log (
  post_id TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  liked_at INTEGER NOT NULL, -- Unix 秒级时间戳
  PRIMARY KEY (post_id, client_hash)
);
