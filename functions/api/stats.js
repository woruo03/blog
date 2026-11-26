// functions/api/stats.js
// Cloudflare Pages Functions 路由入口（具体安全校验、D1 访问与业务编排位于 lib/stats/，避免在 functions/ 下暴露多余路由）

import { getCorsHeaders } from "../../lib/stats/security.js";
import { handleGetStats, handlePostStats } from "../../lib/stats/handlers.js";

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
    return handleGetStats(
        context,
        getCorsHeaders(context.request, context.env),
    );
}

export async function onRequestPost(context) {
    return handlePostStats(
        context,
        getCorsHeaders(context.request, context.env),
    );
}
