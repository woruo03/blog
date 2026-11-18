// functions/api/stats.js
// Cloudflare Pages Functions: 基于 D1 数据库的高性能文章浏览量（Views）与点赞（Likes）安全管理接口
// 集成：防爬虫静默旁路、Fetch Metadata 跨站阻断、边缘内存滑动窗口限流、D1 原子级 24h 冷却与点赞唯一性约束、匿名客户端哈希脱敏

const BOT_UA_REGEX =
    /bot|spider|crawl|slurp|curl|wget|python|java|httpclient|axios|scrapy|postman|insomnia|go-http|headless/i;

function isAllowedOrigin(origin, env = {}) {
    if (!origin) return true;
    try {
        const u = new URL(origin);
        if (u.hostname === "blog.woruo03.com") return true;
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1")
            return true;
        // 精确匹配本项目的 Pages 域名及分支预览环境（*.blog.pages.dev）
        if (
            u.hostname === "blog.pages.dev" ||
            u.hostname.endsWith(".blog.pages.dev")
        )
            return true;
        // 若配置了自定义环境变量 ALLOWED_ORIGINS，则按逗号分隔扩展校验
        if (env?.ALLOWED_ORIGINS) {
            const extra = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
            if (extra.includes(u.origin) || extra.includes(u.hostname))
                return true;
        }
    } catch (_) {}
    return false;
}

function getCorsHeaders(request, env = {}) {
    const origin = request.headers.get("origin") || "";
    const allowOrigin =
        isAllowedOrigin(origin, env) && origin
            ? origin
            : "https://blog.woruo03.com";
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
    const salt =
        (typeof secret === "string" && secret.trim()) || "woruo03-salt";
    const cleanVid = (typeof vid === "string" && vid.trim()) || "anonymous";
    // 解绑动态变化的客户端公网 IP，以设备端持久化匿名指纹 vid 作为核心身份
    // 确保读者在 4G/5G、Wi-Fi、VPN 或 IPv6 隐私扩展地址轮换时，点赞状态稳定不丢失，且杜绝切网络重复刷赞
    const raw = `client:${cleanVid}:${salt}`;
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
    const salt =
        (typeof secret === "string" && secret.trim()) || "woruo03-salt";
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`ip:${ip}:${salt}`),
    );
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
}

// 边缘内存滑动窗口限流：拦截高频暴击脚本，0 磁盘写入，0 数据库往返
const ipRateLimits = new Map();
const RATE_LIMIT_MAX = 30; // 60 秒内最多 30 次写操作
const RATE_LIMIT_WINDOW = 60 * 1000;

function isRateLimited(ipHash) {
    const now = Date.now();
    const entry = ipRateLimits.get(ipHash);
    if (!entry || now - entry.start >= RATE_LIMIT_WINDOW) {
        ipRateLimits.set(ipHash, { count: 1, start: now });
        if (ipRateLimits.size > 2000) {
            for (const [k, v] of ipRateLimits.entries()) {
                if (now - v.start >= RATE_LIMIT_WINDOW) {
                    ipRateLimits.delete(k);
                }
            }
        }
        return false;
    }
    entry.count++;
    return entry.count > RATE_LIMIT_MAX;
}

let isDbInitialized = false;
async function ensureDbSchema(db) {
    if (isDbInitialized) return;
    await db.exec(`
        CREATE TABLE IF NOT EXISTS stats (
          id TEXT PRIMARY KEY,
          views INTEGER NOT NULL DEFAULT 0,
          likes INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_stats_updated_at ON stats(updated_at);
        CREATE TABLE IF NOT EXISTS stats_likes_log (
          post_id TEXT NOT NULL,
          client_hash TEXT NOT NULL,
          liked_at INTEGER NOT NULL,
          PRIMARY KEY (post_id, client_hash)
        );
    `);
    isDbInitialized = true;
}

// 仅在初次部署命中表不存在时触发 DDL，消除正常请求的冷启动元数据写锁与延迟
async function executeWithSchemaFallback(db, queryFn) {
    try {
        return await queryFn();
    } catch (err) {
        if (/no such table/i.test(err?.message || "")) {
            await ensureDbSchema(db);
            return await queryFn();
        }
        throw err;
    }
}

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: {
            ...getCorsHeaders(context.request, context.env),
            "Access-Control-Max-Age": "86400",
        },
    });
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const corsHeaders = getCorsHeaders(request, env);
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
            const results = await executeWithSchemaFallback(
                env.DB,
                async () => {
                    const res = await env.DB.prepare(query)
                        .bind(...idList)
                        .all();
                    return res?.results || [];
                },
            );

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
                    "Cache-Control":
                        "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
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

    // 2. 单篇查询（极速合并往返）
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
            let row = null;
            let userLiked = false;

            if (vid) {
                const clientHash = await getClientHash(
                    request,
                    vid,
                    env.STATS_SECRET,
                );
                const batchRes = await executeWithSchemaFallback(
                    env.DB,
                    async () => {
                        return await env.DB.batch([
                            env.DB.prepare(
                                "SELECT views, likes FROM stats WHERE id = ?",
                            ).bind(id),
                            env.DB.prepare(
                                "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
                            ).bind(id, clientHash),
                        ]);
                    },
                );
                row = batchRes[0]?.results?.[0];
                userLiked = Boolean(batchRes[1]?.results?.[0]);
            } else {
                row = await executeWithSchemaFallback(env.DB, async () => {
                    return await env.DB.prepare(
                        "SELECT views, likes FROM stats WHERE id = ?",
                    )
                        .bind(id)
                        .first();
                });
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
                        "Cache-Control": vid
                            ? "private, no-cache"
                            : "public, max-age=15, stale-while-revalidate=30",
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
    const corsHeaders = getCorsHeaders(request, env);

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
    if (origin && !isAllowedOrigin(origin, env)) {
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
        const row = await executeWithSchemaFallback(env.DB, async () => {
            return await env.DB.prepare(
                "SELECT views, likes FROM stats WHERE id = ?",
            )
                .bind(id)
                .first();
        });
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

    // 3. 边缘内存级极速限流（0 数据库写事务，防暴力刷量打爆 D1 配额）
    const ipHash = await getIpHash(request, env.STATS_SECRET);
    if (isRateLimited(ipHash)) {
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

    // 4. 博主免记模式判定：0 数据库写入，只读返回当前真实统计
    const isAdminBypass =
        request.headers.get("x-admin-bypass") === "1" ||
        body?.adminBypass === true;

    if (isAdminBypass) {
        try {
            return await executeWithSchemaFallback(env.DB, async () => {
                const [row, likeRecord] = await Promise.all([
                    env.DB.prepare(
                        "SELECT views, likes FROM stats WHERE id = ?",
                    )
                        .bind(id)
                        .first(),
                    env.DB.prepare(
                        "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
                    )
                        .bind(id, clientHash)
                        .first(),
                ]);

                return new Response(
                    JSON.stringify({
                        id,
                        views: row?.views || 0,
                        likes: row?.likes || 0,
                        userLiked: !!likeRecord,
                        adminBypassed: true,
                    }),
                    {
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "application/json; charset=utf-8",
                            "Cache-Control": "no-store",
                        },
                    },
                );
            });
        } catch (err) {
            return new Response(
                JSON.stringify({
                    error: err.message || "Internal server error",
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

    try {
        return await executeWithSchemaFallback(env.DB, async () => {
            if (action === "view") {
                // 浏览量：基于 Cookie 与 Edge Cache（caches.default）双重 24h 边缘去重
                // 彻底省除 D1 临时日志表写入与 DELETE 清理开销，单次有效阅读仅 1 次 D1 写入！
                const cookieHeader = request.headers.get("cookie") || "";
                const viewCookieName = `viewed_${encodeURIComponent(id)}`;
                const hasViewCookie = cookieHeader
                    .split(";")
                    .some((c) => c.trim().startsWith(`${viewCookieName}=`));

                let isCachedView = hasViewCookie;
                let cacheKey = null;

                if (
                    !isCachedView &&
                    typeof caches !== "undefined" &&
                    caches?.default
                ) {
                    try {
                        cacheKey = new Request(
                            `https://cache.stats.internal/view/${encodeURIComponent(id)}/${clientHash}`,
                            { method: "GET" },
                        );
                        const match = await caches.default.match(cacheKey);
                        if (match) {
                            isCachedView = true;
                        }
                    } catch (_) {}
                }

                if (isCachedView) {
                    // 24小时冷却期内（命中 Cookie 或 Edge Cache）：0 D1 写入，只读返回
                    const [row, likeRecord] = await Promise.all([
                        env.DB.prepare(
                            "SELECT views, likes FROM stats WHERE id = ?",
                        )
                            .bind(id)
                            .first(),
                        env.DB.prepare(
                            "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
                        )
                            .bind(id, clientHash)
                            .first(),
                    ]);

                    const resHeaders = {
                        ...corsHeaders,
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-store",
                    };
                    if (!hasViewCookie) {
                        resHeaders["Set-Cookie"] =
                            `${viewCookieName}=1; Max-Age=86400; Path=/; SameSite=Lax; Secure`;
                    }

                    return new Response(
                        JSON.stringify({
                            id,
                            views: row?.views || 0,
                            likes: row?.likes || 0,
                            userLiked: !!likeRecord,
                            cached: true,
                        }),
                        { headers: resHeaders },
                    );
                }

                // 首次访问或冷却过期：原子级更新 stats 主表（严格仅 1 次写入）
                const [row, likeRecord] = await Promise.all([
                    env.DB.prepare(
                        `
                        INSERT INTO stats (id, views, likes)
                        VALUES (?1, 1, 0)
                        ON CONFLICT(id) DO UPDATE SET views = views + 1, updated_at = CURRENT_TIMESTAMP
                        RETURNING views, likes;
                    `,
                    )
                        .bind(id)
                        .first(),
                    env.DB.prepare(
                        "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
                    )
                        .bind(id, clientHash)
                        .first(),
                ]);

                // 异步将此访问标记写入 Edge Cache（TTL 24小时），不阻塞当前响应
                if (
                    cacheKey &&
                    typeof caches !== "undefined" &&
                    caches?.default
                ) {
                    const cachePutPromise = caches.default.put(
                        cacheKey,
                        new Response("1", {
                            headers: {
                                "Cache-Control": "public, max-age=86400",
                            },
                        }),
                    );
                    if (context.waitUntil) {
                        context.waitUntil(cachePutPromise);
                    }
                }

                const resHeaders = {
                    ...corsHeaders,
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                    "Set-Cookie": `${viewCookieName}=1; Max-Age=86400; Path=/; SameSite=Lax; Secure`,
                };

                return new Response(
                    JSON.stringify({
                        id,
                        views: row?.views || 1,
                        likes: row?.likes || 0,
                        userLiked: !!likeRecord,
                    }),
                    { headers: resHeaders },
                );
            } else if (action === "like") {
                // 点赞：利用主键冲突优雅防重，杜绝重复递增与多余写锁
                const logRes = await env.DB.prepare(
                    "INSERT OR IGNORE INTO stats_likes_log (post_id, client_hash, liked_at) VALUES (?1, ?2, ?3)",
                )
                    .bind(id, clientHash, now)
                    .run();

                let views = 0;
                let likes = 0;

                if (logRes?.meta?.changes > 0) {
                    // 首次点赞成功：自增主表点赞计数 (1次写入)
                    const row = await env.DB.prepare(
                        `
                        INSERT INTO stats (id, views, likes)
                        VALUES (?1, 0, 1)
                        ON CONFLICT(id) DO UPDATE SET likes = likes + 1, updated_at = CURRENT_TIMESTAMP
                        RETURNING views, likes;
                    `,
                    )
                        .bind(id)
                        .first();
                    views = row?.views || 0;
                    likes = row?.likes || 1;
                } else {
                    // 已经点赞过：0 写入！直接只读返回当前数据
                    const row = await env.DB.prepare(
                        "SELECT views, likes FROM stats WHERE id = ?",
                    )
                        .bind(id)
                        .first();
                    views = row?.views || 0;
                    likes = row?.likes || 0;
                }

                return new Response(
                    JSON.stringify({
                        id,
                        views,
                        likes,
                        userLiked: true,
                        duplicate: logRes?.meta?.changes === 0,
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
                // 取消点赞：当且仅当确实存在点赞记录时才扣减
                const logRes = await env.DB.prepare(
                    "DELETE FROM stats_likes_log WHERE post_id = ?1 AND client_hash = ?2",
                )
                    .bind(id, clientHash)
                    .run();

                let views = 0;
                let likes = 0;

                if (logRes?.meta?.changes > 0) {
                    // 确认删除成功：扣减主表点赞数 (1次写入)
                    const row = await env.DB.prepare(
                        `
                        UPDATE stats SET likes = MAX(likes - 1, 0), updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?1
                        RETURNING views, likes;
                    `,
                    )
                        .bind(id)
                        .first();
                    views = row?.views || 0;
                    likes = row?.likes || 0;
                } else {
                    // 未曾点赞：0 写入！直接只读返回当前数据
                    const row = await env.DB.prepare(
                        "SELECT views, likes FROM stats WHERE id = ?",
                    )
                        .bind(id)
                        .first();
                    views = row?.views || 0;
                    likes = row?.likes || 0;
                }

                return new Response(
                    JSON.stringify({
                        id,
                        views,
                        likes,
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
                return new Response(
                    JSON.stringify({ error: "Invalid action" }),
                    {
                        status: 400,
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "application/json; charset=utf-8",
                        },
                    },
                );
            }
        });
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
