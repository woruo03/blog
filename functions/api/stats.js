// functions/api/stats.js
// Cloudflare Pages Functions: 基于 D1 数据库的文章浏览量（Views）与点赞（Likes）安全管理接口
// 集成：防爬虫静默旁路、Fetch Metadata 跨站阻断、D1 原子级 24h 冷却与点赞唯一性约束、匿名客户端哈希脱敏

const BOT_UA_REGEX =
    /bot|spider|crawl|slurp|curl|wget|python|java|httpclient|axios|scrapy|postman|insomnia|go-http|headless/i;

function isAllowedOrigin(origin) {
    if (!origin) return true;
    try {
        const u = new URL(origin);
        if (u.hostname === "blog.woruo03.com") return true;
        if (u.hostname.endsWith(".pages.dev")) return true;
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    } catch (_) {}
    return false;
}

function getCorsHeaders(request) {
    const origin = request.headers.get("origin") || "";
    const allowOrigin =
        isAllowedOrigin(origin) && origin ? origin : "https://blog.woruo03.com";
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "X-Content-Type-Options": "nosniff",
        Vary: "Origin, Sec-Fetch-Site",
    };
}

function isValidId(id) {
    if (typeof id !== "string") return false;
    const trimmed = id.trim();
    if (!trimmed || trimmed.length > 200) return false;
    // 杜绝路径穿越、控制字符及非法路径分隔符
    if (/[\/\\]|\.\.|[\x00-\x1F\x7F]/.test(trimmed)) return false;
    return true;
}

function isBotRequest(request) {
    if (request.cf?.verifiedBot) return true;
    const ua = request.headers.get("user-agent") || "";
    if (!ua || BOT_UA_REGEX.test(ua)) return true;
    return false;
}

async function getClientHash(request, vid, secret = "woruo03-salt") {
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const raw = `${ip}:${vid || ""}:${secret}`;
    const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(raw),
    );
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
}

async function getIpHash(request, secret = "woruo03-salt") {
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`ip:${ip}:${secret}`),
    );
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
}

async function checkRateLimit(db, ipHash, limit = 30, windowSeconds = 60) {
    const now = Math.floor(Date.now() / 1000);
    try {
        const row = await db
            .prepare(
                "SELECT request_count, window_start FROM stats_rate_limits WHERE ip_hash = ?",
            )
            .bind(ipHash)
            .first();

        if (!row || now - row.window_start >= windowSeconds) {
            await db
                .prepare(
                    `
                INSERT INTO stats_rate_limits (ip_hash, request_count, window_start)
                VALUES (?1, 1, ?2)
                ON CONFLICT(ip_hash) DO UPDATE SET request_count = 1, window_start = excluded.window_start;
            `,
                )
                .bind(ipHash, now)
                .run();
            return true;
        }

        if (row.request_count >= limit) {
            return false;
        }

        await db
            .prepare(
                "UPDATE stats_rate_limits SET request_count = request_count + 1 WHERE ip_hash = ?",
            )
            .bind(ipHash)
            .run();
        return true;
    } catch (_) {
        return true;
    }
}

let isDbInitialized = false;
async function ensureDbSchema(db) {
    if (isDbInitialized) return;
    try {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS stats (
              id TEXT PRIMARY KEY,
              views INTEGER NOT NULL DEFAULT 0,
              likes INTEGER NOT NULL DEFAULT 0,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS stats_views_log (
              post_id TEXT NOT NULL,
              client_hash TEXT NOT NULL,
              viewed_at INTEGER NOT NULL,
              PRIMARY KEY (post_id, client_hash)
            );
            CREATE TABLE IF NOT EXISTS stats_likes_log (
              post_id TEXT NOT NULL,
              client_hash TEXT NOT NULL,
              liked_at INTEGER NOT NULL,
              PRIMARY KEY (post_id, client_hash)
            );
            CREATE TABLE IF NOT EXISTS stats_rate_limits (
              ip_hash TEXT PRIMARY KEY,
              request_count INTEGER NOT NULL DEFAULT 1,
              window_start INTEGER NOT NULL
            );
        `);
        isDbInitialized = true;
    } catch (_) {
        isDbInitialized = true;
    }
}

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: {
            ...getCorsHeaders(context.request),
            "Access-Control-Max-Age": "86400",
        },
    });
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const corsHeaders = getCorsHeaders(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const ids = url.searchParams.get("ids");
    const vid = url.searchParams.get("vid");

    if (!env.DB) {
        return new Response(
            JSON.stringify({
                warning: "Cloudflare D1 database (DB) is not bound yet.",
                views: 0,
                likes: 0,
                data: {},
            }),
            {
                status: 200,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                },
            },
        );
    }

    await ensureDbSchema(env.DB);

    // 1. 批量查询（用于列表页或首页卡片）
    if (ids) {
        const idList = [
            ...new Set(
                ids
                    .split(",")
                    .map((s) => s.trim())
                    .filter(isValidId),
            ),
        ].slice(0, 50);

        if (idList.length === 0) {
            return new Response(JSON.stringify({ data: {} }), {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            });
        }

        try {
            const placeholders = idList.map(() => "?").join(",");
            const query = `SELECT id, views, likes FROM stats WHERE id IN (${placeholders})`;
            const { results } = await env.DB.prepare(query)
                .bind(...idList)
                .all();

            const data = {};
            for (const row of results || []) {
                data[row.id] = {
                    views: row.views || 0,
                    likes: row.likes || 0,
                };
            }

            return new Response(JSON.stringify({ data }), {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "public, max-age=30, s-maxage=60",
                },
            });
        } catch (err) {
            return new Response(
                JSON.stringify({
                    error: err.message || "Failed to query stats",
                }),
                {
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json; charset=utf-8",
                    },
                },
            );
        }
    }

    // 2. 单篇查询
    if (id) {
        if (!isValidId(id)) {
            return new Response(JSON.stringify({ error: "Invalid post id" }), {
                status: 400,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            });
        }

        try {
            const row = await env.DB.prepare(
                "SELECT views, likes FROM stats WHERE id = ?",
            )
                .bind(id)
                .first();

            let userLiked = false;
            if (vid) {
                const clientHash = await getClientHash(
                    request,
                    vid,
                    env.STATS_SECRET,
                );
                const likeRecord = await env.DB.prepare(
                    "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
                )
                    .bind(id, clientHash)
                    .first();
                userLiked = !!likeRecord;
            }

            return new Response(
                JSON.stringify({
                    id,
                    views: row?.views || 0,
                    likes: row?.likes || 0,
                    userLiked,
                }),
                {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                    },
                },
            );
        } catch (err) {
            return new Response(
                JSON.stringify({
                    error: err.message || "Failed to query post stats",
                }),
                {
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json; charset=utf-8",
                    },
                },
            );
        }
    }

    return new Response(
        JSON.stringify({ error: "Missing required parameter: id or ids" }),
        {
            status: 400,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json; charset=utf-8",
            },
        },
    );
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const corsHeaders = getCorsHeaders(request);

    // 1. Fetch Metadata 与 Origin 跨站防护
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (secFetchSite === "cross-site") {
        return new Response(
            JSON.stringify({ error: "Cross-site requests not allowed" }),
            {
                status: 403,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            },
        );
    }

    const origin = request.headers.get("origin");
    if (origin && !isAllowedOrigin(origin)) {
        return new Response(
            JSON.stringify({ error: "Disallowed request origin" }),
            {
                status: 403,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            },
        );
    }

    if (!env.DB) {
        return new Response(
            JSON.stringify({
                warning: "Cloudflare D1 database (DB) is not bound yet.",
                views: 1,
                likes: 0,
                userLiked: false,
            }),
            {
                status: 200,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            },
        );
    }

    await ensureDbSchema(env.DB);

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        return new Response(
            JSON.stringify({
                error: "Unsupported Media Type. Expected application/json",
            }),
            {
                status: 415,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            },
        );
    }

    let body;
    try {
        body = await request.json();
    } catch (_) {
        return new Response(
            JSON.stringify({ error: "Malformed JSON in request body" }),
            {
                status: 400,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            },
        );
    }

    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const action = body?.action || "view"; // "view" | "like" | "unlike"
    const vid = typeof body?.vid === "string" ? body.vid.trim() : "";

    if (!isValidId(id)) {
        return new Response(
            JSON.stringify({ error: "Invalid or missing post id" }),
            {
                status: 400,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            },
        );
    }

    // 2. 爬虫与自动化测试工具静默旁路（Silent Ignore）
    if (isBotRequest(request)) {
        const row = await env.DB.prepare(
            "SELECT views, likes FROM stats WHERE id = ?",
        )
            .bind(id)
            .first();
        return new Response(
            JSON.stringify({
                id,
                views: row?.views || 0,
                likes: row?.likes || 0,
                botIgnored: true,
            }),
            {
                status: 200,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            },
        );
    }

    // 3. 边缘滑动窗口限流（防止攻击脚本高频打爆 D1 写入配额）
    const ipHash = await getIpHash(request, env.STATS_SECRET);
    const withinLimit = await checkRateLimit(env.DB, ipHash, 30, 60);
    if (!withinLimit) {
        return new Response(
            JSON.stringify({
                error: "Too many requests. Please slow down.",
            }),
            {
                status: 429,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                    "Retry-After": "60",
                },
            },
        );
    }

    const clientHash = await getClientHash(request, vid, env.STATS_SECRET);
    const now = Math.floor(Date.now() / 1000);

    // 4. 后台异步维护：5% 概率清理 7 天前过期的临时访问日志与限流记录
    if (context.waitUntil && Math.random() < 0.05) {
        context.waitUntil(
            (async () => {
                try {
                    const sevenDaysAgo = now - 7 * 86400;
                    await env.DB.batch([
                        env.DB.prepare(
                            "DELETE FROM stats_views_log WHERE viewed_at < ?",
                        ).bind(sevenDaysAgo),
                        env.DB.prepare(
                            "DELETE FROM stats_rate_limits WHERE window_start < ?",
                        ).bind(sevenDaysAgo),
                    ]);
                } catch (_) {}
            })(),
        );
    }

    try {
        if (action === "view") {
            // 浏览量：24小时去重与冷却判定
            const existingView = await env.DB.prepare(
                "SELECT viewed_at FROM stats_views_log WHERE post_id = ? AND client_hash = ?",
            )
                .bind(id, clientHash)
                .first();

            let views = 0;
            let likes = 0;

            if (existingView && now - existingView.viewed_at < 86400) {
                // 24小时内同一读者：命中冷却，不累加 views
                const row = await env.DB.prepare(
                    "SELECT views, likes FROM stats WHERE id = ?",
                )
                    .bind(id)
                    .first();
                views = row?.views || 0;
                likes = row?.likes || 0;
            } else {
                // 首次访问或已超24小时冷却：批量写入日志并自增
                const results = await env.DB.batch([
                    env.DB.prepare(
                        `
                        INSERT INTO stats_views_log (post_id, client_hash, viewed_at)
                        VALUES (?1, ?2, ?3)
                        ON CONFLICT(post_id, client_hash) DO UPDATE SET viewed_at = excluded.viewed_at;
                    `,
                    ).bind(id, clientHash, now),
                    env.DB.prepare(
                        `
                        INSERT INTO stats (id, views, likes)
                        VALUES (?1, 1, 0)
                        ON CONFLICT(id) DO UPDATE SET views = views + 1, updated_at = CURRENT_TIMESTAMP
                        RETURNING views, likes;
                    `,
                    ).bind(id),
                ]);
                const updated = results[1]?.results?.[0];
                views = updated?.views || 1;
                likes = updated?.likes || 0;
            }

            // 同步检查该客户端是否已点赞
            const likeRecord = await env.DB.prepare(
                "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
            )
                .bind(id, clientHash)
                .first();

            return new Response(
                JSON.stringify({
                    id,
                    views,
                    likes,
                    userLiked: !!likeRecord,
                }),
                {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store",
                    },
                },
            );
        } else if (action === "like") {
            // 点赞：单用户唯一性检查
            const existingLike = await env.DB.prepare(
                "SELECT liked_at FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
            )
                .bind(id, clientHash)
                .first();

            if (existingLike) {
                // 已点赞：阻止重复自增
                const row = await env.DB.prepare(
                    "SELECT views, likes FROM stats WHERE id = ?",
                )
                    .bind(id)
                    .first();
                return new Response(
                    JSON.stringify({
                        id,
                        views: row?.views || 0,
                        likes: row?.likes || 0,
                        userLiked: true,
                        duplicate: true,
                    }),
                    {
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "application/json; charset=utf-8",
                            "Cache-Control": "no-store",
                        },
                    },
                );
            }

            // 首次点赞：事务记录日志并自增
            const results = await env.DB.batch([
                env.DB.prepare(
                    `
                    INSERT INTO stats_likes_log (post_id, client_hash, liked_at)
                    VALUES (?1, ?2, ?3)
                    ON CONFLICT(post_id, client_hash) DO UPDATE SET liked_at = excluded.liked_at;
                `,
                ).bind(id, clientHash, now),
                env.DB.prepare(
                    `
                    INSERT INTO stats (id, views, likes)
                    VALUES (?1, 0, 1)
                    ON CONFLICT(id) DO UPDATE SET likes = likes + 1, updated_at = CURRENT_TIMESTAMP
                    RETURNING views, likes;
                `,
                ).bind(id),
            ]);
            const updated = results[1]?.results?.[0];
            return new Response(
                JSON.stringify({
                    id,
                    views: updated?.views || 0,
                    likes: updated?.likes || 0,
                    userLiked: true,
                }),
                {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store",
                    },
                },
            );
        } else if (action === "unlike") {
            // 取消点赞：验证确实曾点过赞
            const existingLike = await env.DB.prepare(
                "SELECT liked_at FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
            )
                .bind(id, clientHash)
                .first();

            if (!existingLike) {
                // 未曾点赞：无法取消
                const row = await env.DB.prepare(
                    "SELECT views, likes FROM stats WHERE id = ?",
                )
                    .bind(id)
                    .first();
                return new Response(
                    JSON.stringify({
                        id,
                        views: row?.views || 0,
                        likes: row?.likes || 0,
                        userLiked: false,
                    }),
                    {
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "application/json; charset=utf-8",
                            "Cache-Control": "no-store",
                        },
                    },
                );
            }

            // 存在点赞记录：删除日志并安全扣减
            const results = await env.DB.batch([
                env.DB.prepare(
                    "DELETE FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
                ).bind(id, clientHash),
                env.DB.prepare(
                    `
                    INSERT INTO stats (id, views, likes)
                    VALUES (?1, 0, 0)
                    ON CONFLICT(id) DO UPDATE SET likes = MAX(likes - 1, 0), updated_at = CURRENT_TIMESTAMP
                    RETURNING views, likes;
                `,
                ).bind(id),
            ]);
            const updated = results[1]?.results?.[0];
            return new Response(
                JSON.stringify({
                    id,
                    views: updated?.views || 0,
                    likes: updated?.likes || 0,
                    userLiked: false,
                }),
                {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store",
                    },
                },
            );
        } else {
            return new Response(JSON.stringify({ error: "Invalid action" }), {
                status: 400,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            });
        }
    } catch (err) {
        return new Response(
            JSON.stringify({ error: err.message || "Internal server error" }),
            {
                status: 500,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                },
            },
        );
    }
}
