-- functions/schema.sql
-- Cloudflare D1 数据库模式定义：文章统计系统核心表与高性能索引
-- 浏览量（Views）由客户端 LocalStorage + Cloudflare 边缘缓存与安全 Cookie 协同去重，直写 stats 表，无需临时日志表开销

CREATE TABLE IF NOT EXISTS stats (
  id TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stats_likes_log (
  post_id TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  liked_at INTEGER NOT NULL, -- Unix 秒级时间戳
  PRIMARY KEY (post_id, client_hash)
);
