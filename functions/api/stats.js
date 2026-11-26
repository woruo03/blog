// functions/api/stats.js
// Cloudflare Pages Functions: 基于 D1 数据库的高性能文章浏览量（Views）与点赞（Likes）安全管理接口
// 集成：防爬虫静默旁路、Fetch Metadata 跨站阻断、边缘内存滑动窗口限流、D1 原子级 24h 冷却与点赞唯一性约束、匿名客户端哈希脱敏

const BOT_UA_REGEX =
    /bot|spider|crawl|slurp|curl|wget|python|java|httpclient|axios|scrapy|postman|insomnia|go-http|headless/i;
const VALID_ACTIONS = new Set(["view", "like", "unlike"]);
const DEFAULT_ORIGIN = "https://blog.woruo03.com";
const DEFAULT_SALT = "woruo03-salt";

let hasWarnedMissingSecret = false;

function getViewCookieName(id) {
    return (
        "viewed_" +
        encodeURIComponent(id).replace(
            /[()]/g,
            (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
        )
    );
}

function getViewCookieHeader(cookieName) {
    return `${cookieName}=1; Max-Age=86400; Path=/api/; SameSite=Lax; Secure; HttpOnly`;
}

function isAllowedOrigin(origin, env = {}) {
    if (!origin) return true;
    try {
        const u = new URL(origin);
        if (
            u.hostname === "blog.woruo03.com" ||
            u.hostname === "localhost" ||
            u.hostname === "127.0.0.1" ||
            u.hostname === "blog.pages.dev" ||
            u.hostname.endsWith(".blog.pages.dev")
        ) {
            return true;
        }
        if (env?.ALLOWED_ORIGINS) {
            const extra = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
            if (extra.includes(u.origin) || extra.includes(u.hostname)) {
                return true;
            }
        }
    } catch (_) {}
    return false;
}

function getCorsHeaders(request, env = {}) {
    const origin = request.headers.get("origin") || "";
    const allowOrigin =
        origin && isAllowedOrigin(origin, env) ? origin : DEFAULT_ORIGIN;
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "X-Content-Type-Options": "nosniff",
        Vary: "Origin, Sec-Fetch-Site",
    };
}

function jsonResponse(data, corsHeaders, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            ...extraHeaders,
        },
    });
}

function isValidId(id) {
    if (typeof id !== "string") return false;
    const trimmed = id.trim();
    if (!trimmed || trimmed.length > 200) return false;
    // 杜绝路径穿越、控制字符及非法路径分隔符
    return !/[\/\\]|\.\.|[\x00-\x1F\x7F]/.test(trimmed);
}

function isBotRequest(request) {
    if (request.cf?.verifiedBot) return true;
    const ua = request.headers.get("user-agent") || "";
    return !ua || BOT_UA_REGEX.test(ua);
}

function getSalt(env) {
    const secret = env?.STATS_SECRET;
    if (typeof secret === "string" && secret.trim()) {
        return secret.trim();
    }
    if (!hasWarnedMissingSecret) {
        hasWarnedMissingSecret = true;
        console.warn(
            "[Stats] Warning: STATS_SECRET is not configured. Falling back to default salt.",
        );
    }
    return DEFAULT_SALT;
}

async function sha256Prefix(raw) {
    const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(raw),
    );
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
}

function getClientHash(vid, env) {
    // 解绑动态变化的客户端公网 IP，以设备端持久化匿名指纹 vid 作为核心身份，
    // 确保读者在切换网络或 IPv6 隐私地址轮换时点赞状态稳定不丢失，且杜绝切网重复刷赞
    const cleanVid = (typeof vid === "string" && vid.trim()) || "anonymous";
    return sha256Prefix(`client:${cleanVid}:${getSalt(env)}`);
}

function getIpHash(request, env) {
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    return sha256Prefix(`ip:${ip}:${getSalt(env)}`);
}

// 边缘内存限流：拦截高频刷量脚本，0 磁盘写入，0 数据库往返
// 说明：Map 驻留在单个 Worker Isolate 局部内存，属于轻量边缘缓解层；点赞幂等性由 D1 主键约束强保障
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
            if (ipRateLimits.size > 2000) {
                ipRateLimits.clear();
            }
        }
        return false;
    }
    entry.count++;
    return entry.count > RATE_LIMIT_MAX;
}

let isDbInitialized = false;
let schemaInitPromise = null;

async function ensureDbSchema(db) {
    if (isDbInitialized) return;
    if (!schemaInitPromise) {
        schemaInitPromise = (async () => {
            // D1 的 exec() 以换行作为语句边界，单条 DDL 必须完整写在一行内
            await db.exec(
                "CREATE TABLE IF NOT EXISTS stats (id TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
            );
            await db.exec(
                "CREATE TABLE IF NOT EXISTS stats_likes_log (post_id TEXT NOT NULL, client_hash TEXT NOT NULL, liked_at INTEGER NOT NULL, PRIMARY KEY (post_id, client_hash));",
            );
            isDbInitialized = true;
        })().catch((err) => {
            schemaInitPromise = null;
            throw err;
        });
    }
    return schemaInitPromise;
}

// 仅在初次部署命中缺表异常时惰性建表，消除常规请求的冷启动 DDL 写锁与延迟
async function executeWithSchemaFallback(db, queryFn) {
    try {
        return await queryFn();
    } catch (err) {
        const msg = `${err?.message || ""} ${err?.cause?.message || ""}`;
        if (/no such table/i.test(msg)) {
            isDbInitialized = false;
            schemaInitPromise = null;
            await ensureDbSchema(db);
            return await queryFn();
        }
        throw err;
    }
}

async function readPostStats(db, id, clientHash = null) {
    if (clientHash) {
        const batchRes = await db.batch([
            db.prepare("SELECT views, likes FROM stats WHERE id = ?").bind(id),
            db
                .prepare(
                    "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
                )
                .bind(id, clientHash),
        ]);
        const row = batchRes[0]?.results?.[0];
        return {
            views: row?.views || 0,
            likes: row?.likes || 0,
            userLiked: Boolean(batchRes[1]?.results?.[0]),
        };
    }
    const row = await db
        .prepare("SELECT views, likes FROM stats WHERE id = ?")
        .bind(id)
        .first();
    return {
        views: row?.views || 0,
        likes: row?.likes || 0,
        userLiked: false,
    };
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
    const id = url.searchParams.get("id")?.trim() ?? null;
    const ids = url.searchParams.get("ids");
    const vid = url.searchParams.get("vid");

    // 爬虫与自动化工具直接返回零数据（禁止进入公共 CDN 缓存污染真实用户）
    if (isBotRequest(request)) {
        const payload =
            ids !== null
                ? { data: {} }
                : {
                      id: id || "",
                      views: 0,
                      likes: 0,
                      userLiked: false,
                      botIgnored: true,
                  };
        return jsonResponse(payload, corsHeaders, 200, {
            "Cache-Control": "private, no-store",
        });
    }

    // 1. 批量查询（列表页/首页卡片）
    if (ids !== null) {
        const idList = [
            ...new Set(
                ids
                    .split(",")
                    .map((s) => s.trim())
                    .filter(isValidId),
            ),
        ].slice(0, 50);

        if (idList.length === 0) {
            return jsonResponse({ data: {} }, corsHeaders, 200, {
                "Cache-Control": "public, max-age=60",
            });
        }

        if (!env.DB) {
            return jsonResponse(
                {
                    warning: "Cloudflare D1 database (DB) is not bound yet.",
                    data: {},
                },
                corsHeaders,
                200,
                { "Cache-Control": "no-store" },
            );
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
            for (const row of results) {
                data[row.id] = {
                    views: row.views || 0,
                    likes: row.likes || 0,
                };
            }

            return jsonResponse({ data }, corsHeaders, 200, {
                "Cache-Control":
                    "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
            });
        } catch (_) {
            return jsonResponse(
                { error: "Failed to query stats" },
                corsHeaders,
                500,
            );
        }
    }

    // 2. 单篇查询
    if (id) {
        if (!isValidId(id)) {
            return jsonResponse({ error: "Invalid post id" }, corsHeaders, 400);
        }

        if (!env.DB) {
            return jsonResponse(
                {
                    warning: "Cloudflare D1 database (DB) is not bound yet.",
                    id,
                    views: 0,
                    likes: 0,
                    userLiked: false,
                },
                corsHeaders,
                200,
                { "Cache-Control": "no-store" },
            );
        }

        try {
            const clientHash = vid ? await getClientHash(vid, env) : null;
            const stats = await executeWithSchemaFallback(env.DB, () =>
                readPostStats(env.DB, id, clientHash),
            );
            return jsonResponse({ id, ...stats }, corsHeaders, 200, {
                "Cache-Control": vid
                    ? "private, no-cache"
                    : "public, max-age=15, stale-while-revalidate=30",
            });
        } catch (_) {
            return jsonResponse(
                { error: "Failed to query post stats" },
                corsHeaders,
                500,
            );
        }
    }

    return jsonResponse(
        { error: "Missing required parameter: id or ids" },
        corsHeaders,
        400,
    );
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const corsHeaders = getCorsHeaders(request, env);

    // 1. Fetch Metadata 与 Origin 跨站防护
    if (request.headers.get("sec-fetch-site") === "cross-site") {
        return jsonResponse(
            { error: "Cross-site requests not allowed" },
            corsHeaders,
            403,
        );
    }

    const origin = request.headers.get("origin");
    if (origin && !isAllowedOrigin(origin, env)) {
        return jsonResponse(
            { error: "Disallowed request origin" },
            corsHeaders,
            403,
        );
    }

    if (!env.DB) {
        return jsonResponse(
            {
                warning: "Cloudflare D1 database (DB) is not bound yet.",
                views: 1,
                likes: 0,
                userLiked: false,
            },
            corsHeaders,
        );
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
        return jsonResponse(
            { error: "Unsupported Media Type. Expected application/json" },
            corsHeaders,
            415,
        );
    }

    let body;
    try {
        body = await request.json();
    } catch (_) {
        return jsonResponse(
            { error: "Malformed JSON in request body" },
            corsHeaders,
            400,
        );
    }

    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const action = body?.action || "view";
    const vid = typeof body?.vid === "string" ? body.vid.trim() : "";

    if (!isValidId(id)) {
        return jsonResponse(
            { error: "Invalid or missing post id" },
            corsHeaders,
            400,
        );
    }
    if (!VALID_ACTIONS.has(action)) {
        return jsonResponse({ error: "Invalid action" }, corsHeaders, 400);
    }

    // 2. 爬虫与自动化测试工具静默旁路（0 数据库读写）
    if (isBotRequest(request)) {
        return jsonResponse(
            { id, views: 0, likes: 0, botIgnored: true },
            corsHeaders,
        );
    }

    // 3. 边缘内存限流（0 数据库写事务，防暴力刷量打爆 D1 配额）
    const ipHash = await getIpHash(request, env);
    if (isRateLimited(ipHash)) {
        return jsonResponse(
            { error: "Too many requests. Please slow down." },
            corsHeaders,
            429,
            { "Retry-After": "60" },
        );
    }

    const clientHash = await getClientHash(vid, env);

    try {
        return await executeWithSchemaFallback(env.DB, async () => {
            if (action === "view") {
                return handleViewAction(context, {
                    id,
                    vid,
                    clientHash,
                    ipHash,
                    corsHeaders,
                });
            }
            return handleLikeToggleAction(env.DB, {
                id,
                action,
                clientHash,
                corsHeaders,
            });
        });
    } catch (_) {
        return jsonResponse(
            { error: "Internal server error" },
            corsHeaders,
            500,
        );
    }
}

async function handleViewAction(
    context,
    { id, vid, clientHash, ipHash, corsHeaders },
) {
    const { request, env } = context;
    const cookieHeader = request.headers.get("cookie") || "";
    const viewCookieName = getViewCookieName(id);
    const hasViewCookie = cookieHeader
        .split(";")
        .some((c) => c.trim().startsWith(`${viewCookieName}=`));

    let isCachedView = hasViewCookie;
    let cacheKey = null;

    if (!isCachedView && typeof caches !== "undefined" && caches?.default) {
        let host = "blog.woruo03.com";
        try {
            host = new URL(request.url).host;
        } catch (_) {}
        try {
            // 缺失 vid 时退化到 ipHash，避免所有无 vid 访客共享同一条 Edge Cache 冷却键
            const viewKeyHash = vid ? clientHash : ipHash;
            cacheKey = new Request(
                `https://${host}/__stats_cache/view/${encodeURIComponent(id)}/${viewKeyHash}`,
                { method: "GET" },
            );
            if (await caches.default.match(cacheKey)) {
                isCachedView = true;
            }
        } catch (_) {}
    }

    if (isCachedView) {
        // 24 小时冷却期内：0 D1 写入，单次 batch 只读返回
        const stats = await readPostStats(env.DB, id, clientHash);
        const extraHeaders = { "Cache-Control": "no-store" };
        if (!hasViewCookie) {
            extraHeaders["Set-Cookie"] = getViewCookieHeader(viewCookieName);
        }
        return jsonResponse(
            { id, ...stats, cached: true },
            corsHeaders,
            200,
            extraHeaders,
        );
    }

    // 首次访问或冷却过期：单次 batch 完成主表原子递增与点赞状态查询
    const batchRes = await env.DB.batch([
        env.DB.prepare(
            "INSERT INTO stats (id, views, likes) VALUES (?1, 1, 0) ON CONFLICT(id) DO UPDATE SET views = views + 1, updated_at = CURRENT_TIMESTAMP RETURNING views, likes;",
        ).bind(id),
        env.DB.prepare(
            "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
        ).bind(id, clientHash),
    ]);
    const row = batchRes[0]?.results?.[0];
    const userLiked = Boolean(batchRes[1]?.results?.[0]);

    if (cacheKey && typeof caches !== "undefined" && caches?.default) {
        const cachePutPromise = caches.default
            .put(
                cacheKey,
                new Response("1", {
                    headers: { "Cache-Control": "public, max-age=86400" },
                }),
            )
            .catch(() => {});
        if (context.waitUntil) {
            context.waitUntil(cachePutPromise);
        }
    }

    return jsonResponse(
        {
            id,
            views: row?.views || 1,
            likes: row?.likes || 0,
            userLiked,
        },
        corsHeaders,
        200,
        {
            "Cache-Control": "no-store",
            "Set-Cookie": getViewCookieHeader(viewCookieName),
        },
    );
}

async function handleLikeToggleAction(db, { id, action, clientHash, corsHeaders }) {
    const isLike = action === "like";
    const logRes = isLike
        ? await db
              .prepare(
                  "INSERT OR IGNORE INTO stats_likes_log (post_id, client_hash, liked_at) VALUES (?1, ?2, ?3)",
              )
              .bind(id, clientHash, Math.floor(Date.now() / 1000))
              .run()
        : await db
              .prepare(
                  "DELETE FROM stats_likes_log WHERE post_id = ?1 AND client_hash = ?2",
              )
              .bind(id, clientHash)
              .run();

    const changed = (logRes?.meta?.changes || 0) > 0;
    let row;
    if (changed) {
        const sql = isLike
            ? "INSERT INTO stats (id, views, likes) VALUES (?1, 0, 1) ON CONFLICT(id) DO UPDATE SET likes = likes + 1, updated_at = CURRENT_TIMESTAMP RETURNING views, likes;"
            : "UPDATE stats SET likes = MAX(likes - 1, 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?1 RETURNING views, likes;";
        row = await db.prepare(sql).bind(id).first();
    } else {
        // 幂等重复请求：0 写入，直接只读返回
        row = await db
            .prepare("SELECT views, likes FROM stats WHERE id = ?")
            .bind(id)
            .first();
    }

    const payload = {
        id,
        views: row?.views || 0,
        likes: row?.likes ?? (isLike && changed ? 1 : 0),
        userLiked: isLike,
    };
    if (isLike) {
        payload.duplicate = !changed;
    }

    return jsonResponse(payload, corsHeaders, 200, {
        "Cache-Control": "no-store",
    });
}
