-- Cloudflare D1 Database Schema for Blog Views and Likes
-- 存放于 functions/schema.sql，用于在 Cloudflare D1 控制台执行初始化或参考

-- 1. 文章浏览量与点赞主表
CREATE TABLE IF NOT EXISTS stats (
  id TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stats_updated_at ON stats(updated_at);

-- 2. 浏览量防刷与防重日志表（24小时去重与冷却）
CREATE TABLE IF NOT EXISTS stats_views_log (
  post_id TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  viewed_at INTEGER NOT NULL, -- Unix 秒级时间戳
  PRIMARY KEY (post_id, client_hash)
);

CREATE INDEX IF NOT EXISTS idx_views_log_time ON stats_views_log(viewed_at);

-- 3. 点赞去重与状态记录表（单用户单篇唯一性约束）
CREATE TABLE IF NOT EXISTS stats_likes_log (
  post_id TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  liked_at INTEGER NOT NULL, -- Unix 秒级时间戳
  PRIMARY KEY (post_id, client_hash)
);

CREATE INDEX IF NOT EXISTS idx_likes_log_time ON stats_likes_log(liked_at);

-- 4. 边缘 IP 频次限制表（防恶意批量脚本打爆数据库，滑动窗口限流）
CREATE TABLE IF NOT EXISTS stats_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL -- 窗口起始秒级时间戳
);
