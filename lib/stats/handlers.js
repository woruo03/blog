// lib/stats/handlers.js
// 文章统计接口 GET / POST 业务处理编排

import {
    VALID_ACTIONS,
    getClientHash,
    getIpHash,
    getViewCookieHeader,
    getViewCookieName,
    isAllowedOrigin,
    isBotRequest,
    isRateLimited,
    isValidId,
    jsonResponse,
} from "./security.js";
import {
    executeWithSchemaFallback,
    incrementViewAndReadLiked,
    queryBatchStats,
    readPostStats,
    toggleLikeInDb,
} from "./db.js";

export async function handleGetStats(context, corsHeaders) {
    const { request, env } = context;
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
            const data = await executeWithSchemaFallback(env.DB, () =>
                queryBatchStats(env.DB, idList),
            );
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

export async function handlePostStats(context, corsHeaders) {
    const { request, env } = context;

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

    // 3. 边缘内存限流
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
            const payload = await toggleLikeInDb(env.DB, {
                id,
                isLike: action === "like",
                clientHash,
            });
            return jsonResponse(payload, corsHeaders, 200, {
                "Cache-Control": "no-store",
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

    const stats = await incrementViewAndReadLiked(env.DB, id, clientHash);

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

    return jsonResponse({ id, ...stats }, corsHeaders, 200, {
        "Cache-Control": "no-store",
        "Set-Cookie": getViewCookieHeader(viewCookieName),
    });
}
